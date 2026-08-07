import {
  ForbiddenException,
  Injectable,
  Logger,
  NestMiddleware,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NextFunction, Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Tenant } from '../entity/tenant.entity';
import { AppClsStore } from '../interface/tenant-cls-store.interface';
import { extractSubdomain } from '../utility/extract-subdomain';
import { TenantOnboardingStatus } from '../enum/tenant-onboarding-status.enum';

const VALID_SCHEMA_NAME = /^[a-z_][a-z0-9_]*$/;

// Thrown inside the withTransaction callback purely to signal "roll back,
// don't commit" once a >=400 response has already gone out to the client —
// by that point res.on('finish') has already fired, so there's nothing
// left to respond with. Caught and swallowed in use(), never rethrown.
class RollbackSignal extends Error {}

// Resolves the tenant from the Host header, writes it into CLS, AND wraps
// the entire rest of the request — guards, interceptors, handler, all of
// it — in one transaction with SET LOCAL search_path.
//
// That last part has to happen here, in middleware, not in an interceptor
// (which is what the first version of this did, via
// TenantTransactionInterceptor — now retired). NestJS's request lifecycle
// runs Guards BEFORE Interceptors; a transaction opened at the interceptor
// layer never covers guard-level DB access. Confirmed empirically: real
// tenant admin login always failed against a freshly provisioned tenant,
// because LocalAuthGuard's credential lookup ran before SET LOCAL
// search_path was ever issued, so it queried `public` (no such member
// there) instead of the tenant's own schema.
//
// Express middleware has no built-in "wrap everything downstream" hook the
// way an interceptor's Observable does, so this uses the res.on('finish')
// trick: call next() to run the rest of the pipeline, then await a promise
// that resolves when the response actually completes, keeping the
// transaction open for that whole span. A response status >= 400 rolls
// back — a 401/404/500 means nothing should have committed.
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);

  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly config: ConfigService,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const baseDomain = this.config.get<string>('APP_BASE_DOMAIN');
    const subdomain = extractSubdomain(req.hostname, baseDomain);

    if (!subdomain) {
      throw new NotFoundException('Tenant not found');
    }

    // Not filtered by isActive here — a row that exists but isn't active
    // yet needs a different response than one that never existed at all
    // (see the branches below), which a single findOneBy({ isActive: true })
    // can't distinguish: both would 404 identically otherwise.
    const tenant = await this.tenantRepository.findOneBy({ subdomain });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    if (tenant.onboardingStatus !== TenantOnboardingStatus.ACTIVE) {
      if (
        tenant.onboardingStatus === TenantOnboardingStatus.PENDING ||
        tenant.onboardingStatus === TenantOnboardingStatus.PROVISIONING
      ) {
        throw new ServiceUnavailableException(
          'This workspace is still being set up. Please check back in a moment.',
        );
      }
      // FAILED — a genuine setup problem, not something a visitor can fix
      // by waiting. Deliberately no technical detail here; that's what
      // GET /platform/tenants/:id/onboarding-events is for.
      throw new ServiceUnavailableException(
        'There was a problem setting up this workspace. Please contact support.',
      );
    }

    // onboardingStatus reaching ACTIVE never reverts — a previously-active
    // tenant with isActive now false was suspended by a platform admin
    // (PlatformTenantService.suspendTenant), a distinct case from "still
    // provisioning" that deserves its own message, not a generic 404.
    if (!tenant.isActive) {
      throw new ForbiddenException(
        'This account has been suspended. Please contact support.',
      );
    }

    if (!VALID_SCHEMA_NAME.test(tenant.schemaName)) {
      throw new NotFoundException('Tenant not found');
    }

    this.cls.set('tenantId', tenant.id);
    this.cls.set('schemaName', tenant.schemaName);
    this.cls.set('clusterId', tenant.clusterId);

    try {
      await this.txHost.withTransaction(async () => {
        await this.txHost.tx.query(
          `SET LOCAL search_path TO "${tenant.schemaName}", public`,
        );

        await new Promise<void>((resolve, reject) => {
          res.once('finish', () => {
            if (res.statusCode >= 400) {
              reject(
                new RollbackSignal(
                  `Request completed with status ${res.statusCode}`,
                ),
              );
            } else {
              resolve();
            }
          });
          res.once('close', resolve);
          next();
        });
      });
    } catch (err) {
      // The response has already been fully sent by the time either of
      // these fire (res.on('finish')/('close') only fire post-response) —
      // nothing left to do but decide commit vs rollback, which
      // withTransaction already did before this catch runs. A
      // RollbackSignal is expected and silent; anything else (a genuine
      // error inside the SET LOCAL query itself, say) gets logged since
      // there's no exception filter left downstream to report it.
      if (!(err instanceof RollbackSignal)) {
        this.logger.error(
          `Unexpected error in tenant-scoped transaction: ${(err as Error).message}`,
        );
      }
    }
  }
}
