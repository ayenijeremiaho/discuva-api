import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { Subscription } from '../../billing/entity/subscription.entity';
import { Plan } from '../../billing/entity/plan.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { TenantProvisioningService } from '../../tenant/service/tenant-provisioning.service';
import { CacheService } from '../../utility/service/cache.service';
import { SessionSurface } from '../../auth/enum/session-surface.enum';
import { JwtPayload } from '../../auth/interface/auth.interface';
import { CreateTenantDto } from '../dto/create-tenant.dto';
import { UpdateTenantDto } from '../dto/update-tenant.dto';
import { SuspendTenantDto } from '../dto/suspend-tenant.dto';
import { ChangeTenantPlanDto } from '../dto/change-tenant-plan.dto';

export interface TenantWithHealth {
  id: string;
  subdomain: string;
  name: string;
  logoUrl: string | null;
  tagline: string | null;
  address: string | null;
  supportEmail: string | null;
  currency: string;
  timezone: string;
  isActive: boolean;
  createdAt: Date;
  planId: string | null;
  subscriptionStatus: string | null;
  memberCount: number | null;
  eventCount: number | null;
}

@Injectable()
export class PlatformTenantService {
  // Deliberately its own JwtService instance, not the app's DI-provided
  // one — AuthModule only exports AuthService, and injecting a second
  // JwtModule.registerAsync(jwtConfig...) into this module would shadow
  // PlatformAdminModule's own (differently-secreted) JwtModule registration
  // under the same JwtService token. Signs with the identical tenant
  // JWT_SECRET/JWT_EXPIRY_IN a normal admin login uses, so the token
  // validates against the same JwtStrategy once issued.
  private readonly tenantJwtService: JwtService;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,
    private readonly provisioningService: TenantProvisioningService,
    private readonly cacheService: CacheService,
    private readonly configService: ConfigService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {
    this.tenantJwtService = new JwtService({
      secret: this.configService.get<string>('JWT_SECRET'),
      signOptions: {
        expiresIn: this.configService.get<string>('JWT_EXPIRY_IN'),
      },
    });
  }

  // memberCount/eventCount are live per-tenant reads (schema-qualified, so
  // no search_path ambiguity — unlike writes, a qualified read needs no
  // CLS/transaction dance at all). "Last login" from §7's health-stats list
  // is deliberately not included yet — no single existing column captures
  // it cleanly across both member and admin sessions; a real answer needs
  // its own design pass, not a guess bolted on here.
  async listTenants(): Promise<TenantWithHealth[]> {
    const [tenants, subscriptions] = await Promise.all([
      this.tenantRepo.find({ order: { createdAt: 'DESC' } }),
      this.subscriptionRepo.find(),
    ]);
    const subByTenant = new Map(subscriptions.map((s) => [s.tenantId, s]));

    return Promise.all(
      tenants.map((tenant) =>
        this.toHealthShape(tenant, subByTenant.get(tenant.id)),
      ),
    );
  }

  // No adminPassword collected here — the platform admin isn't the one
  // logging in as this tenant's first admin, so there's nobody present to
  // choose one. provisioningService.provision() generates a random
  // password internally (never revealed) and emails the new admin a
  // set-password link instead (docs/MULTI_TENANT_MIGRATION.md §9 Phase 9e).
  async createTenant(dto: CreateTenantDto): Promise<TenantWithHealth> {
    const tenant = await this.provisioningService.provision({
      subdomain: dto.subdomain,
      churchName: dto.churchName,
      adminFirstname: dto.adminFirstname,
      adminLastname: dto.adminLastname,
      adminEmail: dto.adminEmail,
      planId: dto.planId ?? 'free',
    });
    return this.toHealthShape(tenant);
  }

  async updateTenant(
    id: string,
    dto: UpdateTenantDto,
  ): Promise<TenantWithHealth> {
    const tenant = await this.findTenantOrThrow(id);
    Object.assign(tenant, dto);
    const saved = await this.tenantRepo.save(tenant);
    return this.toHealthShape(saved);
  }

  async suspendTenant(
    id: string,
    dto: SuspendTenantDto,
  ): Promise<TenantWithHealth> {
    const tenant = await this.findTenantOrThrow(id);
    tenant.isActive = dto.suspend === false;
    const saved = await this.tenantRepo.save(tenant);
    return this.toHealthShape(saved);
  }

  async changeTenantPlan(
    id: string,
    dto: ChangeTenantPlanDto,
  ): Promise<Subscription> {
    const tenant = await this.findTenantOrThrow(id);
    const plan = await this.planRepo.findOneBy({ id: dto.planId });
    if (!plan) throw new NotFoundException('Plan not found');

    let subscription = await this.subscriptionRepo.findOneBy({
      tenantId: tenant.id,
    });
    if (!subscription) {
      subscription = this.subscriptionRepo.create({
        tenantId: tenant.id,
        planId: dto.planId,
      });
    } else {
      subscription.planId = dto.planId;
    }
    const saved = await this.subscriptionRepo.save(subscription);

    // PlanGuard caches resolved features under this exact key (§4.11) — a
    // manual plan change has to invalidate it or the tenant keeps the old
    // plan's access for up to the cache TTL.
    await this.cacheService.del(`plan-features:${tenant.id}`);
    return saved;
  }

  // Issues a short-lived, ACCESS-TOKEN-ONLY JWT scoped to this tenant's
  // schema — deliberately not routed through AuthService.adminLogin().
  // First attempt did exactly that and it looked right (same as
  // TenantProvisioningService's own admin lookup, correctly scoped via
  // txHost.tx) but failed empirically: adminLogin() internally calls
  // AdminService/MemberSessionService, which use THEIR OWN
  // @InjectRepository()-injected repos and don't pick up this method's
  // manually entered CLS transaction either — the exact same class of bug
  // §4.8 found, just one layer further down the call stack. Signing the
  // token directly here (this.tenantJwtService, real JWT_SECRET) with the
  // same payload shape AuthService uses avoids the problem entirely: no
  // session bookkeeping, no second repository chain to get wrong. No
  // refresh token either — a support tool issuing indefinitely-renewable
  // access is a bigger footgun than one that expires and needs re-issuing.
  //
  // TenantMiddleware is live (§9 Phase 8), so this token routes to the
  // right tenant schema like any other tenant-facing request.
  async impersonateTenant(id: string): Promise<{ access_token: string }> {
    const tenant = await this.findTenantOrThrow(id);
    if (!tenant.isActive) {
      throw new ConflictException('Cannot impersonate a suspended tenant.');
    }

    const admin = await this.cls.runWith(
      { tenantId: tenant.id, schemaName: tenant.schemaName } as AppClsStore,
      () =>
        this.txHost.withTransaction(async () => {
          await this.txHost.tx.query(
            `SET LOCAL search_path TO "${tenant.schemaName}", public`,
          );
          return this.txHost.tx.findOne(Admin, {
            where: { isActive: true },
            relations: ['member'],
            order: { createdAt: 'ASC' },
          });
        }),
    );
    if (!admin) {
      throw new NotFoundException('No admin account exists for this tenant.');
    }

    const payload: JwtPayload = {
      sub: admin.member.id,
      role: admin.member.role,
      aud: SessionSurface.ADMIN,
      jti: randomUUID(),
    };
    return {
      access_token: await this.tenantJwtService.signAsync(payload),
    };
  }

  // The single source of what a tenant looks like on the wire — every
  // method that returns a tenant to a platform-admin caller goes through
  // this, so none of them can drift into leaking raw Tenant columns
  // (schemaName, clusterId, parentTenantId, sharing-consent flags, ...)
  // that have no business being visible outside this service.
  private async toHealthShape(
    tenant: Tenant,
    subscription?: Subscription,
  ): Promise<TenantWithHealth> {
    const sub =
      subscription ??
      (await this.subscriptionRepo.findOneBy({ tenantId: tenant.id }));
    const [memberCount, eventCount] = await Promise.all([
      this.safeSchemaCount(tenant.schemaName, 'members'),
      this.safeSchemaCount(tenant.schemaName, 'events'),
    ]);
    return {
      id: tenant.id,
      subdomain: tenant.subdomain,
      name: tenant.name,
      logoUrl: tenant.logoUrl,
      tagline: tenant.tagline,
      address: tenant.address,
      supportEmail: tenant.supportEmail,
      currency: tenant.currency,
      timezone: tenant.timezone,
      isActive: tenant.isActive,
      createdAt: tenant.createdAt,
      planId: sub?.planId ?? null,
      subscriptionStatus: sub?.status ?? null,
      memberCount,
      eventCount,
    };
  }

  private async findTenantOrThrow(id: string): Promise<Tenant> {
    const tenant = await this.tenantRepo.findOneBy({ id });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  private async safeSchemaCount(
    schemaName: string,
    table: string,
  ): Promise<number | null> {
    try {
      const [{ c }] = await this.dataSource.query(
        `SELECT count(*)::int AS c FROM "${schemaName}"."${table}"`,
      );
      return c;
    } catch {
      return null;
    }
  }
}
