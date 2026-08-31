import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
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
import type { StringValue } from 'ms';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { Subscription } from '../../billing/entity/subscription.entity';
import { SubscriptionStatus } from '../../billing/enum/subscription-status.enum';
import { Plan } from '../../billing/entity/plan.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { TenantProvisioningService } from '../../tenant/service/tenant-provisioning.service';
import { TenantOnboardingStatus } from '../../tenant/enum/tenant-onboarding-status.enum';
import { TenantOnboardingActorType } from '../../tenant/enum/tenant-onboarding-actor-type.enum';
import { TenantOnboardingEvent } from '../../tenant/entity/tenant-onboarding-event.entity';
import { CacheService } from '../../utility/service/cache.service';
import { SessionSurface } from '../../auth/enum/session-surface.enum';
import { JwtPayload } from '../../auth/interface/auth.interface';
import { CreateTenantDto } from '../dto/create-tenant.dto';
import { UpdateTenantDto } from '../dto/update-tenant.dto';
import { SuspendTenantDto } from '../dto/suspend-tenant.dto';
import { ChangeTenantPlanDto } from '../dto/change-tenant-plan.dto';
import { ApplyDiscountDto } from '../dto/apply-discount.dto';
import { SetTenantModuleOverrideDto } from '../dto/set-tenant-module-override.dto';
import { SetSocialMediaRolloutDto } from '../dto/set-social-media-rollout.dto';
import { DiscountType } from '../../billing/enum/discount-type.enum';
import { KNOWN_MODULES } from '../../church-settings/constants/known-modules.constant';

export interface TenantWithHealth {
  id: string;
  subdomain: string;
  name: string;
  logoUrl: string | null;
  tagline: string | null;
  address: string | null;
  supportEmail: string | null;
  pwaShortName: string | null;
  currency: string;
  timezone: string;
  isActive: boolean;
  onboardingStatus: TenantOnboardingStatus;
  createdAt: Date;
  planId: string | null;
  subscriptionStatus: string | null;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountReason: string | null;
  discountExpiresAt: Date | null;
  memberCount: number | null;
  eventCount: number | null;
  moduleOverrides: Record<string, boolean> | null;
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
    @InjectRepository(TenantOnboardingEvent)
    private readonly onboardingEventRepo: Repository<TenantOnboardingEvent>,
    private readonly provisioningService: TenantProvisioningService,
    private readonly cacheService: CacheService,
    private readonly configService: ConfigService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {
    this.tenantJwtService = new JwtService({
      secret: this.configService.get<string>('JWT_SECRET'),
      signOptions: {
        expiresIn: this.configService.get<string>(
          'JWT_EXPIRY_IN',
        ) as StringValue,
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
  // choose one. TenantProvisioningService generates a random password
  // internally (never revealed) and emails the new admin a set-password
  // link instead (docs/MULTI_TENANT_MIGRATION.md §9 Phase 9e).
  //
  // Runs inline, not on the queue — unlike self-serve signup, this is a
  // deliberate action by a trusted, authenticated platform admin, not a
  // public unauthenticated form. There's no fraud-review gate that would
  // block a not-yet-provisioned tenant from going further, and CREATE
  // SCHEMA + migrations + seeding is fast enough that the admin can just
  // wait for the response.
  async createTenant(
    dto: CreateTenantDto,
    actorId: string,
  ): Promise<TenantWithHealth> {
    const pending = await this.provisioningService.ensurePendingTenant(
      dto.subdomain,
      dto.churchName,
      undefined,
      true,
    );

    await this.provisioningService.recordEvent(
      pending.id,
      'PLATFORM_ADMIN_INITIATED',
      TenantOnboardingActorType.PLATFORM_ADMIN,
      { actorId },
    );

    let tenant: Tenant;
    try {
      tenant = await this.provisioningService.provision({
        subdomain: dto.subdomain,
        churchName: dto.churchName,
        adminFirstname: dto.adminFirstname,
        adminLastname: dto.adminLastname,
        adminEmail: dto.adminEmail,
        planId: dto.planId ?? 'free',
        allowGenericSubdomain: true,
      });
    } catch (err) {
      await this.tenantRepo.update(pending.id, {
        onboardingStatus: TenantOnboardingStatus.FAILED,
      });
      await this.provisioningService.recordEvent(
        pending.id,
        'PROVISIONING_FAILED',
        TenantOnboardingActorType.PLATFORM_ADMIN,
        { actorId, metadata: { error: (err as Error).message } },
      );
      throw err;
    }

    tenant.onboardingStatus = TenantOnboardingStatus.ACTIVE;
    tenant = await this.tenantRepo.save(tenant);
    await this.provisioningService.recordEvent(
      tenant.id,
      'PROVISIONING_COMPLETED',
      TenantOnboardingActorType.PLATFORM_ADMIN,
      { actorId },
    );

    return this.toHealthShape(tenant);
  }

  async getOnboardingEvents(
    tenantId: string,
  ): Promise<TenantOnboardingEvent[]> {
    await this.findTenantOrThrow(tenantId);
    return this.onboardingEventRepo.find({
      where: { tenant: { id: tenantId } },
      order: { createdAt: 'ASC' },
    });
  }

  async updateTenant(
    id: string,
    dto: UpdateTenantDto,
  ): Promise<TenantWithHealth> {
    const tenant = await this.findTenantOrThrow(id);
    Object.assign(tenant, dto);
    const saved = await this.tenantRepo.save(tenant);
    // EmailQueueService caches this tenant's branding under the same key —
    // an admin edit here must invalidate it or emails keep the old
    // name/logo/address for up to the cache TTL.
    this.cacheService.del(`tenant-branding:${tenant.id}`);
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
        status: SubscriptionStatus.ACTIVE,
      });
    } else {
      subscription.planId = dto.planId;
      // A platform admin overriding the plan is a deliberate grant of
      // access — a tenant stuck CANCELED/PAST_DUE from a lapsed provider
      // subscription must regain access immediately, not stay locked out
      // until the next billing-provider webhook happens to fire.
      subscription.status = SubscriptionStatus.ACTIVE;
    }
    const saved = await this.subscriptionRepo.save(subscription);

    // PlanGuard caches resolved features under this exact key (§4.11) — a
    // manual plan change has to invalidate it or the tenant keeps the old
    // plan's access for up to the cache TTL.
    await this.cacheService.del(`plan-features:${tenant.id}`);
    return saved;
  }

  // Internal comp only — never touches checkout or a payment provider (see
  // subscription.entity.ts's discountType comment). Requires an existing
  // subscription row; changeTenantPlan (or provisioning, which always
  // creates one) must run first.
  async applyDiscount(
    id: string,
    dto: ApplyDiscountDto,
  ): Promise<Subscription> {
    const tenant = await this.findTenantOrThrow(id);
    if (
      dto.discountType === DiscountType.PERCENTAGE &&
      dto.discountValue > 100
    ) {
      throw new BadRequestException('A percentage discount cannot exceed 100.');
    }

    const subscription = await this.subscriptionRepo.findOneBy({
      tenantId: tenant.id,
    });
    if (!subscription) {
      throw new NotFoundException(
        'Tenant has no subscription to apply a discount to.',
      );
    }

    subscription.discountType = dto.discountType;
    subscription.discountValue = dto.discountValue;
    subscription.discountReason = dto.discountReason ?? null;
    subscription.discountExpiresAt = dto.discountExpiresAt
      ? new Date(dto.discountExpiresAt)
      : null;
    return this.subscriptionRepo.save(subscription);
  }

  // See Tenant.moduleOverrides' own comment for the "why not just change
  // their plan" reasoning. `enabled: null` clears the override for this
  // one moduleKey (leaves any other overrides on the tenant untouched)
  // rather than wiping the whole map, since a platform admin comping
  // Social Media shouldn't accidentally revert an unrelated override on
  // the same tenant.
  async setModuleOverride(
    id: string,
    dto: SetTenantModuleOverrideDto,
  ): Promise<TenantWithHealth> {
    if (!KNOWN_MODULES.some((m) => m.key === dto.moduleKey)) {
      throw new BadRequestException(`Unknown module key: ${dto.moduleKey}`);
    }

    const tenant = await this.findTenantOrThrow(id);
    const overrides = { ...tenant.moduleOverrides };
    if (dto.enabled === null) {
      delete overrides[dto.moduleKey];
    } else {
      overrides[dto.moduleKey] = dto.enabled;
    }
    tenant.moduleOverrides = Object.keys(overrides).length ? overrides : null;

    const saved = await this.tenantRepo.save(tenant);
    // PlanFeatureResolverService caches resolved overrides under this exact
    // key alongside plan features — same reasoning changeTenantPlan already
    // documents for its own cache invalidation.
    await this.cacheService.del(`plan-features:${tenant.id}`);
    return this.toHealthShape(saved);
  }

  // The single control surface for the Social Media rollout: a platform
  // admin doesn't reason about Plan.features vs Tenant.moduleOverrides
  // separately — they pick a toggle + an optional searchable list of
  // churches, and this method decides which underlying mechanism to write.
  // "Enabled for all" (empty tenantIds) goes through Plan.features so it's
  // forward-looking — a tenant created next week is covered automatically,
  // same as any other plan-included module. "Enabled for specific accounts"
  // goes through Tenant.moduleOverrides instead, since Plan.features can't
  // express a curated allowlist. The two are kept mutually exclusive: going
  // from "all" back to "specific" strips the plan grant so it doesn't leak
  // access to unselected tenants, and going from "specific" to "all" clears
  // every override so a previously-excluded tenant doesn't stay excluded.
  async setSocialMediaRollout(
    dto: SetSocialMediaRolloutDto,
  ): Promise<{ enabled: boolean; tenantIds: string[] }> {
    const moduleKey = 'social_media';

    if (!dto.enabled) {
      await this.removeModuleFromAllPlans(moduleKey);
      await this.clearAllOverridesFor(moduleKey);
      return { enabled: false, tenantIds: [] };
    }

    if (dto.tenantIds.length === 0) {
      await this.addModuleToAllPlans(moduleKey);
      await this.clearAllOverridesFor(moduleKey);
      return { enabled: true, tenantIds: [] };
    }

    await this.removeModuleFromAllPlans(moduleKey);

    const tenants = await this.tenantRepo.find();
    const selected = new Set(dto.tenantIds);
    const affected: Tenant[] = [];
    for (const tenant of tenants) {
      const current = tenant.moduleOverrides ?? {};
      const shouldHave = selected.has(tenant.id);
      const has = current[moduleKey] === true;
      if (shouldHave === has) continue;

      const overrides = { ...current };
      if (shouldHave) overrides[moduleKey] = true;
      else delete overrides[moduleKey];
      tenant.moduleOverrides = Object.keys(overrides).length ? overrides : null;
      affected.push(tenant);
    }
    if (affected.length) {
      await this.tenantRepo.save(affected);
      await Promise.all(
        affected.map((t) => this.cacheService.del(`plan-features:${t.id}`)),
      );
    }
    return { enabled: true, tenantIds: dto.tenantIds };
  }

  async getSocialMediaRollout(): Promise<{
    enabled: boolean;
    tenantIds: string[];
  }> {
    const moduleKey = 'social_media';
    const plans = await this.planRepo.find();
    if (plans.some((p) => p.features.includes(moduleKey))) {
      return { enabled: true, tenantIds: [] };
    }

    const tenants = await this.tenantRepo.find();
    const tenantIds = tenants
      .filter((t) => t.moduleOverrides?.[moduleKey] === true)
      .map((t) => t.id);
    return { enabled: tenantIds.length > 0, tenantIds };
  }

  private async removeModuleFromAllPlans(moduleKey: string): Promise<void> {
    const plans = await this.planRepo.find();
    const affected = plans.filter((p) => p.features.includes(moduleKey));
    if (!affected.length) return;
    for (const plan of affected) {
      plan.features = plan.features.filter((f) => f !== moduleKey);
    }
    await this.planRepo.save(affected);
  }

  private async addModuleToAllPlans(moduleKey: string): Promise<void> {
    const plans = await this.planRepo.find();
    const affected = plans.filter((p) => !p.features.includes(moduleKey));
    if (!affected.length) return;
    for (const plan of affected) {
      plan.features = [...plan.features, moduleKey];
    }
    await this.planRepo.save(affected);
  }

  private async clearAllOverridesFor(moduleKey: string): Promise<void> {
    const tenants = await this.tenantRepo.find();
    const affected = tenants.filter(
      (t) => t.moduleOverrides?.[moduleKey] !== undefined,
    );
    if (!affected.length) return;

    for (const tenant of affected) {
      const overrides = { ...tenant.moduleOverrides };
      delete overrides[moduleKey];
      tenant.moduleOverrides = Object.keys(overrides).length ? overrides : null;
    }
    await this.tenantRepo.save(affected);
    await Promise.all(
      affected.map((t) => this.cacheService.del(`plan-features:${t.id}`)),
    );
  }

  async removeDiscount(id: string): Promise<Subscription> {
    const tenant = await this.findTenantOrThrow(id);
    const subscription = await this.subscriptionRepo.findOneBy({
      tenantId: tenant.id,
    });
    if (!subscription) {
      throw new NotFoundException('Tenant has no subscription.');
    }

    subscription.discountType = null;
    subscription.discountValue = null;
    subscription.discountReason = null;
    subscription.discountExpiresAt = null;
    return this.subscriptionRepo.save(subscription);
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
      pwaShortName: tenant.pwaShortName,
      currency: tenant.currency,
      timezone: tenant.timezone,
      isActive: tenant.isActive,
      onboardingStatus: tenant.onboardingStatus,
      createdAt: tenant.createdAt,
      planId: sub?.planId ?? null,
      subscriptionStatus: sub?.status ?? null,
      discountType: sub?.discountType ?? null,
      discountValue: sub?.discountValue ?? null,
      discountReason: sub?.discountReason ?? null,
      discountExpiresAt: sub?.discountExpiresAt ?? null,
      memberCount,
      eventCount,
      moduleOverrides: tenant.moduleOverrides,
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
