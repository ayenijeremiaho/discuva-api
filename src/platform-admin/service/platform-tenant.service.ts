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
import { SetModuleRolloutDto } from '../dto/set-module-rollout.dto';
import { DiscountType } from '../../billing/enum/discount-type.enum';
import { KNOWN_MODULES } from '../../church-settings/constants/known-modules.constant';
import { RELEASED_FEATURES_KEY } from '../../billing/service/plan-feature-resolver.service';

export interface TenantAdminContact {
  name: string;
  email: string;
  phoneNumber: string | null;
  role: string | null;
  lastSignInAt: Date | null;
}

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
  planStartedAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  autoRenews: boolean;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountReason: string | null;
  discountExpiresAt: Date | null;
  memberCount: number | null;
  eventCount: number | null;
  adminCount: number | null;
  lastAdminSignInAt: Date | null;
  lastMemberSignInAt: Date | null;
  membersActiveLast30Days: number | null;
  lastEventOn: string | null;
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
    tenant.activatedAt = new Date();
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

  // Who to call or email at a church: its active admins, most recently signed in first.
  async getTenantAdminContacts(
    tenantId: string,
  ): Promise<TenantAdminContact[]> {
    const tenant = await this.findTenantOrThrow(tenantId);
    if (!/^[a-z_][a-z0-9_]*$/.test(tenant.schemaName)) return [];
    const s = tenant.schemaName;
    const rows: {
      firstname: string;
      lastname: string;
      email: string;
      phone_number: string | null;
      role: string | null;
      last_login: Date | null;
    }[] = await this.dataSource.query(
      `SELECT m.firstname, m.lastname, m.email, m.phone_number, r.name AS role, ms.last_login
         FROM "${s}".admins a
         JOIN "${s}".members m ON m.id = a.member_id
         LEFT JOIN "${s}".admin_roles r ON r.id = a.admin_role_id
         LEFT JOIN "${s}".member_sessions ms ON ms.member_id = m.id AND ms.surface = $1
        WHERE a.is_active
        ORDER BY ms.last_login DESC NULLS LAST, m.firstname`,
      [SessionSurface.ADMIN],
    );
    return rows.map((r) => ({
      name: `${r.firstname} ${r.lastname}`.trim(),
      email: r.email,
      phoneNumber: r.phone_number,
      role: r.role,
      lastSignInAt: r.last_login,
    }));
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
    this.delTenantCache(tenant.id, `tenant-branding:${tenant.id}`);
    return this.toHealthShape(saved);
  }

  async suspendTenant(
    id: string,
    dto: SuspendTenantDto,
  ): Promise<TenantWithHealth> {
    const tenant = await this.findTenantOrThrow(id);
    const reactivating = !tenant.isActive && dto.suspend === false;
    // Catch up on anything deployed while it was off, before its admins and members are let back in.
    if (
      reactivating &&
      tenant.onboardingStatus === TenantOnboardingStatus.ACTIVE
    ) {
      await this.provisioningService.runTenantMigrations(tenant.schemaName);
    }
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
    await this.delTenantCache(tenant.id, `plan-features:${tenant.id}`);
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
    await this.delTenantCache(tenant.id, `plan-features:${tenant.id}`);
    return this.toHealthShape(saved);
  }

  // The single control surface for a module's early-access rollout: a
  // platform admin doesn't reason about Plan.features vs
  // Tenant.moduleOverrides separately — they pick a toggle + an optional
  // searchable list of churches, and this method decides which underlying
  // mechanism to write. "Enabled for all" (empty tenantIds) goes through
  // Plan.features so it's forward-looking — a tenant created next week is
  // covered automatically, same as any other plan-included module.
  // "Enabled for specific accounts" goes through Tenant.moduleOverrides
  // instead, since Plan.features can't express a curated allowlist. The two
  // are kept mutually exclusive: going from "all" back to "specific" strips
  // the plan grant so it doesn't leak access to unselected tenants, and
  // going from "specific" to "all" clears every override so a
  // previously-excluded tenant doesn't stay excluded. Shared by every
  // module that goes through this same pre-GA lifecycle (Social Media,
  // Pages, ...) rather than one copy of this logic per module.
  private async setModuleRollout(
    moduleKey: string,
    dto: SetModuleRolloutDto,
  ): Promise<{ enabled: boolean; tenantIds: string[] }> {
    if (!dto.enabled) {
      await this.removeModuleFromAllPlans(moduleKey);
      await this.clearAllOverridesFor(moduleKey);
      await this.invalidateAllTenantCaches();
      return { enabled: false, tenantIds: [] };
    }

    if (dto.tenantIds.length === 0) {
      await this.addModuleToAllPlans(moduleKey);
      await this.clearAllOverridesFor(moduleKey);
      await this.invalidateAllTenantCaches();
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
    }
    // Every plan just lost `moduleKey` (the removeModuleFromAllPlans call
    // above), which affects any tenant on one of those plans — not just the
    // ones whose override changed in the loop above — so every tenant's
    // cached resolution needs invalidating, not just `affected`.
    await this.invalidateAllTenantCaches();
    return { enabled: true, tenantIds: dto.tenantIds };
  }

  // A plan's `features` gaining or losing a module key (via the rollout
  // above, or a direct Plan edit in updatePlan()) changes what every tenant
  // on that plan resolves to — but PlanFeatureResolverService.resolve()
  // caches per tenant, keyed by tenant id, with no reverse index from plan
  // to its subscribed tenants. Rather than query which tenants are
  // currently on the affected plan(s) (subscriptions can also be mid-change
  // concurrently), invalidate every tenant's cache — a full table scan plus
  // a Redis DEL per tenant, cheap at this platform's tenant counts and
  // simplest to reason about as correct.
  private async invalidateAllTenantCaches(): Promise<void> {
    const tenants = await this.tenantRepo.find();
    await Promise.all(
      tenants.map((t) => this.delTenantCache(t.id, `plan-features:${t.id}`)),
    );
  }

  // CacheService.scopedKey() reads the tenant id out of CLS, defaulting to
  // 'global' when absent — which is every request into this service, since
  // platform-admin routes are excluded from TenantMiddleware. Every key this
  // service invalidates was SET from inside an actual tenant-scoped request
  // (e.g. PlanFeatureResolverService.resolve() inside ModuleEnabledGuard),
  // so a bare `cacheService.del()` call here computes `tenant:global:...`
  // and silently misses the real `tenant:${tenantId}:...` entry every
  // time — the change never takes visible effect until the entry's own TTL
  // expires on its own. Re-entering the target tenant's CLS context for the
  // duration of the del() call is the fix; every cache invalidation in this
  // file must go through this rather than calling cacheService.del() bare.
  private async delTenantCache(tenantId: string, key: string): Promise<void> {
    await this.cls.runWith({ tenantId } as AppClsStore, () =>
      this.cacheService.del(key),
    );
  }

  private async getModuleRollout(moduleKey: string): Promise<{
    enabled: boolean;
    tenantIds: string[];
  }> {
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

  async setSocialMediaRollout(
    dto: SetModuleRolloutDto,
  ): Promise<{ enabled: boolean; tenantIds: string[] }> {
    return this.setModuleRollout('social_media', dto);
  }

  async getSocialMediaRollout(): Promise<{
    enabled: boolean;
    tenantIds: string[];
  }> {
    return this.getModuleRollout('social_media');
  }

  async setPagesRollout(
    dto: SetModuleRolloutDto,
  ): Promise<{ enabled: boolean; tenantIds: string[] }> {
    return this.setModuleRollout('pages', dto);
  }

  async getPagesRollout(): Promise<{
    enabled: boolean;
    tenantIds: string[];
  }> {
    return this.getModuleRollout('pages');
  }

  private async removeModuleFromAllPlans(moduleKey: string): Promise<void> {
    const plans = await this.planRepo.find();
    const affected = plans.filter((p) => p.features.includes(moduleKey));
    if (!affected.length) return;
    for (const plan of affected) {
      plan.features = plan.features.filter((f) => f !== moduleKey);
    }
    await this.planRepo.save(affected);
    this.cacheService.delGlobal(RELEASED_FEATURES_KEY).catch(() => undefined);
  }

  private async addModuleToAllPlans(moduleKey: string): Promise<void> {
    const plans = await this.planRepo.find();
    const affected = plans.filter((p) => !p.features.includes(moduleKey));
    if (!affected.length) return;
    for (const plan of affected) {
      plan.features = [...plan.features, moduleKey];
    }
    await this.planRepo.save(affected);
    this.cacheService.delGlobal(RELEASED_FEATURES_KEY).catch(() => undefined);
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
      affected.map((t) => this.delTenantCache(t.id, `plan-features:${t.id}`)),
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

  // Deliberately narrower than suspend: only a signup that never became a
  // real church (PENDING — still queued/never provisioned; AWAITING_APPROVAL
  // — held for review, this is also how a platform admin rejects one; or
  // FAILED — provisioning blew up) can be hard-deleted. An ACTIVE tenant,
  // even one later suspended, is refused here — that's real data (members,
  // giving records, attendance) and would need its own, more deliberate
  // deletion path with stronger confirmation, not this one. DROP SCHEMA IF
  // EXISTS handles every case correctly: neither a PENDING nor an
  // AWAITING_APPROVAL tenant has ever reached provision() (no-op), a FAILED
  // one may have a partial schema from an attempt that died partway through
  // — either way, nothing worth keeping survives in it. The tenants row
  // delete that follows cascades onboarding events/subscriptions/etc. via
  // existing FKs.
  private static readonly DELETABLE_STATUSES: ReadonlySet<TenantOnboardingStatus> =
    new Set([
      TenantOnboardingStatus.PENDING,
      TenantOnboardingStatus.AWAITING_APPROVAL,
      TenantOnboardingStatus.FAILED,
    ]);

  async deleteTenant(id: string): Promise<void> {
    const tenant = await this.findTenantOrThrow(id);
    if (
      !PlatformTenantService.DELETABLE_STATUSES.has(tenant.onboardingStatus)
    ) {
      throw new ConflictException(
        'Only a PENDING, AWAITING_APPROVAL, or FAILED signup can be deleted — an active tenant must be suspended instead.',
      );
    }

    await this.dataSource.query(
      `DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`,
    );
    await this.tenantRepo.remove(tenant);
  }

  // Releases a held self-serve signup — reconstructs the provisioning job
  // payload from Tenant.pendingSignupParams (see its own comment for why
  // this can't just be the transient job payload the non-gated flow uses)
  // and enqueues it exactly like SignupController would have, had approval
  // not been required. Stays async (queued, not run inline like
  // createTenant()) — this is still fundamentally a self-serve signup being
  // released, not a platform admin directly creating a tenant.
  async approveTenant(id: string, actorId: string): Promise<TenantWithHealth> {
    const tenant = await this.findTenantOrThrow(id);
    if (tenant.onboardingStatus !== TenantOnboardingStatus.AWAITING_APPROVAL) {
      throw new ConflictException(
        'Only a signup awaiting approval can be approved.',
      );
    }
    const pending = tenant.pendingSignupParams as {
      adminFirstname: string;
      adminLastname: string;
      adminEmail: string;
      planId?: string;
      parentTenantId?: string;
      sponsoredPlanId?: string;
      branchInviteToken?: string;
    } | null;
    if (!pending) {
      throw new ConflictException(
        'This signup has no pending provisioning data to approve.',
      );
    }

    await this.provisioningService.recordEvent(
      tenant.id,
      'APPROVED',
      TenantOnboardingActorType.PLATFORM_ADMIN,
      { actorId },
    );
    await this.provisioningService.enqueueProvisioning({
      tenantId: tenant.id,
      subdomain: tenant.subdomain,
      churchName: tenant.name,
      ...pending,
      actorType: TenantOnboardingActorType.SELF_SERVE,
    });

    return this.toHealthShape(tenant);
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
    const [memberCount, eventCount, activity] = await Promise.all([
      this.safeSchemaCount(tenant.schemaName, 'members'),
      this.safeSchemaCount(tenant.schemaName, 'events'),
      this.safeActivity(tenant.schemaName),
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
      planStartedAt: sub?.planStartedAt ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      autoRenews:
        !!sub?.billingProviderSubscriptionId && !sub?.cancelAtPeriodEnd,
      discountType: sub?.discountType ?? null,
      discountValue: sub?.discountValue ?? null,
      discountReason: sub?.discountReason ?? null,
      discountExpiresAt: sub?.discountExpiresAt ?? null,
      memberCount,
      eventCount,
      ...activity,
      moduleOverrides: tenant.moduleOverrides,
    };
  }

  private async findTenantOrThrow(id: string): Promise<Tenant> {
    const tenant = await this.tenantRepo.findOneBy({ id });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  // Sign-ins come from member_sessions, which every sign-in and token refresh already updates (one row per person per app).
  private async safeActivity(
    schemaName: string,
  ): Promise<
    Pick<
      TenantWithHealth,
      | 'adminCount'
      | 'lastAdminSignInAt'
      | 'lastMemberSignInAt'
      | 'membersActiveLast30Days'
      | 'lastEventOn'
    >
  > {
    try {
      const [row] = await this.dataSource.query(
        `SELECT
           (SELECT count(*)::int FROM "${schemaName}".admins WHERE is_active) AS admin_count,
           (SELECT max(last_login) FROM "${schemaName}".member_sessions WHERE surface = $1) AS last_admin,
           (SELECT max(last_login) FROM "${schemaName}".member_sessions WHERE surface = $2) AS last_member,
           (SELECT count(*)::int FROM "${schemaName}".member_sessions
             WHERE surface = $2 AND last_login > now() - interval '30 days') AS active_30d,
           (SELECT max(event_date)::text FROM "${schemaName}".events WHERE event_date <= current_date) AS last_event`,
        [SessionSurface.ADMIN, SessionSurface.MEMBER],
      );
      return {
        adminCount: row?.admin_count ?? null,
        lastAdminSignInAt: row?.last_admin ?? null,
        lastMemberSignInAt: row?.last_member ?? null,
        membersActiveLast30Days: row?.active_30d ?? null,
        lastEventOn: row?.last_event ?? null,
      };
    } catch {
      return {
        adminCount: null,
        lastAdminSignInAt: null,
        lastMemberSignInAt: null,
        membersActiveLast30Days: null,
        lastEventOn: null,
      };
    }
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
