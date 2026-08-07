import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { randomUUID } from 'node:crypto';
import { GivingProvider } from '../entity/giving-provider.entity';
import { TenantGivingProviderConfig } from '../entity/tenant-giving-provider-config.entity';
import {
  GivingCheckoutSession,
  GivingCheckoutStatus,
} from '../entity/giving-checkout-session.entity';
import { GivingProviderRegistryService } from './giving-provider-registry.service';
import { EncryptionService } from '../../utility/service/encryption.service';
import { CacheService } from '../../utility/service/cache.service';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { Member } from '../../member/entity/member.entity';
import { TitheAccount } from '../../tithe/entity/tithe-account.entity';
import { TitheRecord } from '../../tithe/entity/tithe-record.entity';
import { TitheSource } from '../../finance/enum/finance.enum';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';
import { InitiateGivingCheckoutDto } from '../dto/initiate-giving-checkout.dto';

export interface ActiveGivingProvider {
  providerId: string;
  providerName: string;
}

interface ResolvedGivingConfig {
  providerId: string;
  credentials: Record<string, string>;
}

// Member-facing checkout initiation + the provider webhook that completes
// it. Pure BYOK, mirroring SmsCredentialResolverService/SmsService's
// resolve-or-403 shape — a tenant with no active giving provider simply
// can't be given to via checkout; there is no platform fallback merchant
// account (giving BYOK is money going straight to the church, not the
// platform, so a platform fallback wouldn't even make sense the way SMS's
// briefly did before it was removed).
@Injectable()
export class GivingCheckoutService {
  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly configService: ConfigService,
    private readonly encryptionService: EncryptionService,
    private readonly cacheService: CacheService,
    private readonly givingProviderRegistry: GivingProviderRegistryService,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(GivingProvider)
    private readonly providerRepo: Repository<GivingProvider>,
    @InjectRepository(TenantGivingProviderConfig)
    private readonly configRepo: Repository<TenantGivingProviderConfig>,
    @InjectRepository(GivingCheckoutSession)
    private readonly checkoutRepo: Repository<GivingCheckoutSession>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    @InjectRepository(TitheAccount)
    private readonly titheAccountRepo: Repository<TitheAccount>,
  ) {}

  private currentTenantId(): string {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) {
      throw new ForbiddenException('No tenant context for this request.');
    }
    return tenantId;
  }

  private cacheKey(tenantId: string): string {
    return `giving-provider-config:${tenantId}`;
  }

  // Cached 300s per tenant, invalidated immediately on write by
  // TenantGivingProviderService — same pattern as
  // SmsCredentialResolverService.resolveConfig(). Explicit `tenantId` param
  // (not read from CLS) because the webhook path calls this with no CLS
  // tenant context at all — only the request path's convenience wrapper
  // below reads it from CLS.
  private async resolveActiveConfig(
    tenantId: string,
  ): Promise<ResolvedGivingConfig | undefined> {
    return this.cacheService
      .getOrSet(
        this.cacheKey(tenantId),
        async () => {
          const config = await this.configRepo
            .createQueryBuilder('config')
            .addSelect('config.credentialsEncrypted')
            .where('config.tenantId = :tenantId', { tenantId })
            .andWhere('config.isActive = true')
            .getOne();

          if (!config) return null;
          return {
            providerId: config.providerId,
            credentials: this.encryptionService.decryptFields(
              config.credentialsEncrypted as Record<string, string>,
            ),
          };
        },
        300,
      )
      .then((cached) => cached ?? undefined);
  }

  // Member-app-facing — whether to show a "Give via Checkout" option at
  // all. Never returns credentials.
  async getActiveProvider(): Promise<ActiveGivingProvider | null> {
    const tenantId = this.currentTenantId();
    const config = await this.resolveActiveConfig(tenantId);
    if (!config) return null;

    const provider = await this.providerRepo.findOneBy({
      id: config.providerId,
    });
    return {
      providerId: config.providerId,
      providerName: provider?.name ?? config.providerId,
    };
  }

  async initiateCheckout(
    memberId: string,
    dto: InitiateGivingCheckoutDto,
  ): Promise<{ checkoutUrl: string }> {
    const tenantId = this.currentTenantId();
    const config = await this.resolveActiveConfig(tenantId);
    if (!config) {
      throw new ForbiddenException({
        message:
          'No giving provider configured. Set up a giving provider under Giving Providers before accepting checkout gifts.',
        code: 'GIVING_PROVIDER_NOT_CONFIGURED',
      });
    }

    const member = await this.memberRepo.findOneByOrFail({ id: memberId });

    let currency = this.configService.get<string>('CURRENCY_CODE', 'NGN');
    if (dto.titheAccountId) {
      const titheAccount = await this.titheAccountRepo.findOne({
        where: { id: dto.titheAccountId, isActive: true },
      });
      if (!titheAccount) {
        throw new NotFoundException('Tithe account not found or inactive.');
      }
      currency = titheAccount.currency;
    }

    const provider = this.givingProviderRegistry.get(config.providerId);
    const reference = `giving_${randomUUID()}`;

    const session = await provider.createCheckoutSession({
      amountCents: dto.amountCents,
      currency,
      payerEmail: member.email,
      payerName: `${member.firstname} ${member.lastname}`.trim(),
      reference,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
      credentials: config.credentials,
    });

    await this.checkoutRepo.save(
      this.checkoutRepo.create({
        id: reference,
        tenantId,
        memberId,
        titheAccountId: dto.titheAccountId ?? null,
        amountCents: dto.amountCents,
        currency,
        provider: config.providerId,
        status: GivingCheckoutStatus.PENDING,
      }),
    );

    return { checkoutUrl: session.checkoutUrl };
  }

  // Entry point for GivingWebhookController. No CLS/tenant context exists
  // yet — `tenantId` comes straight from the :tenantId path param, verified
  // by resolving that tenant's own stored credentials before anything else
  // trusts the request. Mirrors CheckoutService.handleWebhookEvent's
  // never-trust-the-payload discipline: identity/amount always come from
  // the GivingCheckoutSession row this service itself wrote at initiation,
  // never from the webhook body.
  async handleWebhook(
    tenantId: string,
    providerId: string,
    rawBody: Buffer,
    signature: string,
  ): Promise<void> {
    const config = await this.configRepo
      .createQueryBuilder('config')
      .addSelect('config.credentialsEncrypted')
      .where('config.tenantId = :tenantId', { tenantId })
      .andWhere('config.providerId = :providerId', { providerId })
      .andWhere('config.isActive = true')
      .getOne();

    if (!config) {
      throw new NotFoundException(
        `No active "${providerId}" giving provider configured for this tenant.`,
      );
    }

    const credentials = this.encryptionService.decryptFields(
      config.credentialsEncrypted as Record<string, string>,
    );
    const provider = this.givingProviderRegistry.get(providerId);
    const event = provider.verifyAndParseWebhook(
      rawBody,
      signature,
      credentials,
    );

    if (event.type !== 'charge.succeeded' || !event.providerReference) {
      if (event.providerReference) {
        await this.checkoutRepo.update(
          { id: event.providerReference, status: GivingCheckoutStatus.PENDING },
          { status: GivingCheckoutStatus.FAILED },
        );
      }
      return;
    }

    let completedSession: GivingCheckoutSession | undefined;

    await this.dataSource.transaction(async (manager) => {
      // Row-locked + status=PENDING guard makes this idempotent against
      // webhook redelivery — a second delivery for an already-completed
      // session finds nothing to lock and is a safe no-op.
      const session = await manager.findOne(GivingCheckoutSession, {
        where: {
          id: event.providerReference,
          status: GivingCheckoutStatus.PENDING,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) return;

      session.status = GivingCheckoutStatus.COMPLETED;
      session.completedAt = new Date();
      await manager.save(session);
      completedSession = session;
    });

    if (!completedSession) return;

    const tenant = await this.tenantRepo.findOneByOrFail({ id: tenantId });

    await runInTenantContext(
      this.cls,
      this.txHost,
      { tenantId, schemaName: tenant.schemaName },
      async () => {
        const manager = this.txHost.tx;
        await manager.save(
          TitheRecord,
          manager.create(TitheRecord, {
            member: { id: completedSession!.memberId },
            batch: null,
            amount: completedSession!.amountCents / 100,
            paymentDate: new Date().toISOString().slice(0, 10),
            source: TitheSource.PAYMENT_GATEWAY,
            externalReference: completedSession!.id,
            paymentChannel: completedSession!.provider,
          }),
        );
      },
    );
  }
}
