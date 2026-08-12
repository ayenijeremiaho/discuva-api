import * as path from 'node:path';
import { randomInt } from 'node:crypto';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { ConfigService } from '@nestjs/config';
import dbConfig from '../../config/db.config';
import { Tenant } from '../entity/tenant.entity';
import { Subscription } from '../../billing/entity/subscription.entity';
import { Member } from '../../member/entity/member.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { AdminRole } from '../../admin/entity/admin-role.entity';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { PasswordResetOtp } from '../../auth/entity/password-reset-otp.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { AppClsStore } from '../interface/tenant-cls-store.interface';
import { RESERVED_SUBDOMAINS } from '../utility/extract-subdomain';
import { GENERIC_OR_ABUSE_PRONE_SUBDOMAINS } from '../constants/blocked-signup-subdomains.constant';
import { subdomainToSchemaName } from '../utility/schema-name';
import { buildAdminUrl } from '../utility/tenant-url';
import { TenantOnboardingStatus } from '../enum/tenant-onboarding-status.enum';
import { TenantOnboardingActorType } from '../enum/tenant-onboarding-actor-type.enum';
import {
  TenantOnboardingEvent,
  TenantOnboardingEventType,
} from '../entity/tenant-onboarding-event.entity';

// How long a provisioning-time welcome OTP stays valid — deliberately much
// longer than OTP_TTL_SECONDS' normal 15-minute forgot-password window,
// since the first admin of a brand-new tenant may not open the email the
// same day. The tradeoff (a 6-digit code living for days is more
// brute-forceable than one living for minutes) is offset by adding
// rate-limiting to POST /auth/reset-password itself, not by shortening this
// past the point of being useless for its purpose.
const WELCOME_OTP_TTL_HOURS = 48;

export interface ProvisionTenantParams {
  subdomain: string;
  churchName: string;
  adminFirstname: string;
  adminLastname: string;
  adminEmail: string;
  // Omit entirely when nobody was present to type in their own password —
  // platform-admin-initiated provisioning (§9 Phase 9e). seedTenantAdmin
  // then generates one internally (never revealed to anyone) and emails
  // the new admin a welcome message with a set-password link instead. Set
  // this when the admin themselves supplied a password directly (POST
  // /signup, branch invite) — behavior is unchanged for those callers.
  adminPasswordHash?: string;
  planId?: string;
  // Set only when this signup is completing a branch invite
  // (docs/MULTI_TENANT_MIGRATION.md §11.1) — already validated by the
  // caller (SignupController, via BranchInviteService.resolveInvite)
  // before provision() is ever called.
  parentTenantId?: string;
  // Set only when the invite's sponsorPlan was true and the parent has a
  // paid plan to sponsor onto — overrides planId, and stamps
  // Subscription.sponsoredByTenantId so PlatformAnalyticsService's MRR
  // calculation correctly excludes it.
  sponsoredPlanId?: string;
  // See ensurePendingTenant's identical param — only ever set true by
  // PlatformTenantService.createTenant.
  allowGenericSubdomain?: boolean;
}

// Shared by POST /signup and the provision:tenant CLI script — one
// implementation, not two to keep in sync (docs/MULTI_TENANT_MIGRATION.md
// §4.8). Every step checks existing state before acting, so calling
// provision() again for a tenant that crashed partway through resumes
// rather than erroring or double-creating.
@Injectable()
export class TenantProvisioningService {
  private readonly logger = new Logger(TenantProvisioningService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(TenantOnboardingEvent)
    private readonly eventRepo: Repository<TenantOnboardingEvent>,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly utilityService: UtilityService,
    private readonly configService: ConfigService,
  ) {}

  // Find-or-create the Tenant row only — split out of provision() so the
  // two HTTP callers (SignupController, PlatformTenantService.createTenant)
  // can get a real tenant.id + onboardingStatus back immediately, before
  // handing the rest of provisioning off to TenantProvisioningProcessor.
  // Safe to call again for the same subdomain — provision() already relies
  // on this being idempotent (resuming a crashed partial provision).
  async ensurePendingTenant(
    subdomain: string,
    churchName: string,
    parentTenantId?: string,
    // Set only by PlatformTenantService.createTenant — a trusted,
    // authenticated platform admin deliberately choosing a generic/reserved-
    // looking word (e.g. a real "demo" tenant for sales). Never bypasses
    // RESERVED_SUBDOMAINS itself — those would actually break routing for
    // anyone, admin-created or not.
    allowGenericSubdomain = false,
  ): Promise<Tenant> {
    const normalized = subdomain.toLowerCase();
    if (RESERVED_SUBDOMAINS.has(normalized)) {
      throw new ConflictException(
        `"${normalized}" is a reserved subdomain and can't be used.`,
      );
    }
    if (
      !allowGenericSubdomain &&
      GENERIC_OR_ABUSE_PRONE_SUBDOMAINS.has(normalized)
    ) {
      throw new ConflictException(
        `"${normalized}" isn't available as a subdomain — please choose something specific to your church.`,
      );
    }

    const existing = await this.tenantRepo.findOneBy({
      subdomain: normalized,
    });
    if (existing?.isActive) {
      throw new ConflictException('This subdomain is already in use.');
    }
    if (existing) return existing;

    const tenant = await this.tenantRepo.save(
      this.tenantRepo.create({
        subdomain: normalized,
        schemaName: subdomainToSchemaName(normalized),
        name: churchName,
        isActive: false,
        onboardingStatus: TenantOnboardingStatus.PENDING,
        parentTenantId: parentTenantId ?? null,
      }),
    );
    this.logger.log(
      `Tenant row created for "${normalized}" (schema ${tenant.schemaName}), not yet active`,
    );
    return tenant;
  }

  // Records a platform-level onboarding-lifecycle event — distinct from
  // AuditLogService (tenant-scoped, lives in each church's own schema),
  // since these events happen before/independent of any tenant schema
  // existing. See TenantOnboardingEvent's own class comment.
  async recordEvent(
    tenantId: string,
    event: TenantOnboardingEventType,
    actorType: TenantOnboardingActorType,
    options: { actorId?: string; metadata?: Record<string, unknown> } = {},
  ): Promise<void> {
    await this.eventRepo.save(
      this.eventRepo.create({
        tenant: { id: tenantId } as Tenant,
        event,
        actorType,
        actorId: options.actorId ?? null,
        metadata: options.metadata ?? null,
      }),
    );
  }

  async provision(params: ProvisionTenantParams): Promise<Tenant> {
    let tenant = await this.ensurePendingTenant(
      params.subdomain,
      params.churchName,
      params.parentTenantId,
      params.allowGenericSubdomain,
    );

    await this.ensureSchemaExists(tenant.schemaName);
    await this.runTenantMigrations(tenant.schemaName);
    const welcomeOtp = await this.seedTenantAdmin(tenant, params);
    await this.ensureSubscription(
      tenant.id,
      params.sponsoredPlanId ?? params.planId ?? 'free',
      params.sponsoredPlanId ? params.parentTenantId : undefined,
    );

    if (!tenant.isActive) {
      tenant.isActive = true;
      tenant = await this.tenantRepo.save(tenant);
    }

    if (welcomeOtp) {
      this.sendWelcomeEmail(tenant, params, welcomeOtp);
    }

    this.logger.log(`Tenant "${tenant.subdomain}" provisioned and activated`);
    return tenant;
  }

  private async ensureSchemaExists(schemaName: string): Promise<void> {
    await this.dataSource.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
  }

  // A short-lived, single-connection DataSource scoped to the new schema.
  // Two things have to point at that schema, not one: the `schema` option
  // (so TypeORM's own migrations-tracking bookkeeping lands there) AND the
  // `-c search_path=...` connection startup parameter (so the migration
  // file's own raw, unqualified SQL resolves there too) — confirmed
  // empirically that setting only one or the other leaves the migrations
  // table or the actual tables in the wrong schema. A single connection
  // (poolSize 1) avoids a race where a second pooled connection picks up
  // work before its own startup parameter has taken effect.
  //
  // Points at src/migrations/tenant/, not src/migrations/ — that directory
  // holds a schema-agnostic twin of the (public.-hardcoded, and therefore
  // schema-portability-broken) Baseline migration, built specifically for
  // this. See src/migrations/tenant/1790726400000-TenantSchemaGenesis.ts.
  //
  // Public: also called directly by migrate-all-tenants.ts (§4.9) — a
  // schema already provisioned just needs pending migrations applied, not
  // the rest of provision()'s work re-run.
  async runTenantMigrations(schemaName: string): Promise<void> {
    const baseConfig = dbConfig();
    const tenantDataSource = new DataSource({
      ...baseConfig,
      schema: schemaName,
      migrations: [
        path.resolve(__dirname, '../../migrations/tenant') + '/*{.ts,.js}',
      ],
      migrationsRun: false,
      poolSize: 1,
      extra: {
        ...(baseConfig.extra as object),
        max: 1,
        min: 1,
        options: `-c search_path=${schemaName},public`,
      },
    });
    await tenantDataSource.initialize();
    try {
      await tenantDataSource.runMigrations();
    } finally {
      await tenantDataSource.destroy();
    }
  }

  // Runs inside a CLS context scoped to the new tenant, same SET LOCAL
  // search_path mechanism TenantMiddleware uses for live requests (§4.4).
  // Uses this.txHost.tx (the transactional EntityManager) directly for
  // every read/write rather than @InjectRepository()-injected repositories
  // or AdminRoleService — confirmed empirically that those do NOT pick up
  // this method's manually-entered transaction the way they do inside a
  // real HTTP request going through TenantMiddleware: they kept resolving
  // against `public` regardless of the SET LOCAL, seeding the live
  // deployment's actual admins table instead of the new tenant schema (a
  // duplicate-key error on a second run was what surfaced it). Mirrors
  // DefaultAdminSeed's/AdminRoleService's own logic, but seeds the signup
  // form's real admin instead of an env-var placeholder.
  // Returns the plaintext welcome OTP when one was generated (brand-new
  // member, no adminPasswordHash supplied), so provision() can email it
  // once this transaction has committed — null for every other case
  // (resuming a partial provision, a pre-existing member, or a caller who
  // supplied their own password) since there's nothing new to tell anyone.
  private async seedTenantAdmin(
    tenant: Tenant,
    params: ProvisionTenantParams,
  ): Promise<string | null> {
    return this.cls.runWith(
      { tenantId: tenant.id, schemaName: tenant.schemaName } as AppClsStore,
      () =>
        this.txHost.withTransaction(async () => {
          const tx = this.txHost.tx;
          await tx.query(
            `SET LOCAL search_path TO "${tenant.schemaName}", public`,
          );

          const [{ c: adminCount }] = await tx.query(
            'SELECT count(*)::int AS c FROM admins',
          );
          if (adminCount > 0) return null;

          let superAdminRole = await tx.findOneBy(AdminRole, {
            name: 'SuperAdmin',
          });
          if (!superAdminRole) {
            superAdminRole = await tx.save(
              tx.create(AdminRole, {
                name: 'SuperAdmin',
                description: 'Full access to all admin features.',
                permissions: Object.values(AdminPermission),
              }),
            );
          }

          let member = await tx.findOneBy(Member, {
            email: params.adminEmail,
          });
          let welcomeOtp: string | null = null;
          if (!member) {
            const hasCallerPassword = !!params.adminPasswordHash;
            const passwordHash = hasCallerPassword
              ? params.adminPasswordHash
              : await UtilityService.hashValue(
                  UtilityService.generateRandomPassword(),
                );

            member = await tx.save(
              tx.create(Member, {
                firstname: params.adminFirstname,
                lastname: params.adminLastname,
                email: params.adminEmail,
                password: passwordHash,
                role: MemberRoleEnum.MEMBER,
                status: MemberStatusEnum.ACTIVE,
                changedPassword: hasCallerPassword,
              }),
            );

            if (!hasCallerPassword) {
              welcomeOtp = randomInt(0, 1000000).toString().padStart(6, '0');
              await tx.save(
                tx.create(PasswordResetOtp, {
                  memberId: member.id,
                  otpHash: await UtilityService.hashValue(welcomeOtp),
                  expiresAt: new Date(
                    Date.now() + WELCOME_OTP_TTL_HOURS * 60 * 60 * 1000,
                  ),
                  usedAt: null,
                }),
              );
            }
          }

          await tx.save(
            tx.create(Admin, {
              member,
              adminRole: superAdminRole,
              isActive: true,
            }),
          );
          this.logger.log(
            `Seeded SuperAdmin ${params.adminEmail} for tenant "${tenant.subdomain}"`,
          );
          return welcomeOtp;
        }),
    );
  }

  // Fire-and-forget per this codebase's queue convention (§Redis/Cache
  // Conventions) — the admin/OTP rows are already durably committed by the
  // time this is called, the email is a best-effort notification on top.
  private sendWelcomeEmail(
    tenant: Tenant,
    params: ProvisionTenantParams,
    otp: string,
  ): void {
    const firstName = UtilityService.capitalizeFirstLetter(
      params.adminFirstname,
    );
    // discuva-admin has no per-tenant subdomain of its own to encode this
    // in (fixed host — see buildAdminUrl's own doc comment); `subdomain`
    // rides as a query param instead, which the set-password page reads to
    // pre-fill its "Church Subdomain" field the same way it already
    // pre-fills email/otp.
    const productName = this.configService.get<string>('PRODUCT_NAME');
    const setPasswordUrl = buildAdminUrl(
      this.configService.get<string>('ADMIN_LOGIN_URL'),
      '/set-password',
      { email: params.adminEmail, otp, subdomain: tenant.subdomain },
    );

    this.utilityService.sendEmailWithTemplate(
      params.adminEmail,
      `Welcome to ${params.churchName}'s new ${productName} workspace`,
      'tenant-welcome',
      {
        name: firstName,
        church_name: params.churchName,
        email: params.adminEmail,
        otp,
        expiresHours: WELCOME_OTP_TTL_HOURS.toString(),
        set_password_url: setPasswordUrl,
      },
    );
  }

  private async ensureSubscription(
    tenantId: string,
    planId: string,
    sponsoredByTenantId?: string,
  ): Promise<void> {
    const existing = await this.subscriptionRepo.findOneBy({ tenantId });
    if (existing) return;
    await this.subscriptionRepo.save(
      this.subscriptionRepo.create({
        tenantId,
        planId,
        sponsoredByTenantId: sponsoredByTenantId ?? null,
      }),
    );
  }
}
