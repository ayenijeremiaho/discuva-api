import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { TenantOnboardingStatus } from '../enum/tenant-onboarding-status.enum';
import { ChurchThemePreset } from '../enum/church-theme-preset.enum';

// Control-plane table — lives in `public`, never a `search_path` target.
// See docs/MULTI_TENANT_MIGRATION.md §4.1.
@Entity({ name: 'tenants' })
export class Tenant extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  subdomain: string;

  @Index({ unique: true })
  @Column()
  schemaName: string;

  @Column({ default: 'default' })
  clusterId: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  logoUrl: string | null;

  // Cloudinary asset id backing logoUrl — needed to delete the previous
  // asset when replaced, or the asset itself when removed. Never exposed
  // via the API, only logoUrl is.
  @Column({ nullable: true })
  logoPublicId: string | null;

  @Column({ nullable: true })
  tagline: string | null;

  @Column({ nullable: true })
  address: string | null;

  @Column({ nullable: true })
  supportEmail: string | null;

  // Home-screen label a member sees after installing the PWA (Android's
  // manifest short_name / iOS's apple-mobile-web-app-title) — deliberately
  // separate from `name`, which is often too long (formal church names) for
  // the ~10-13 characters that survive truncation on a real home screen.
  // Falls back to `name` itself when unset — see discuva-member's
  // app/manifest.ts and context/tenant-context.tsx.
  @Column({ nullable: true, length: 20 })
  pwaShortName: string | null;

  @Column({ type: 'varchar', default: ChurchThemePreset.CLASSIC })
  themePreset: ChurchThemePreset;

  @Column({ type: 'varchar', nullable: true })
  previousThemePreset: ChurchThemePreset | null;

  @Column({ default: 'NGN' })
  currency: string;

  @Column({ default: 'UTC' })
  timezone: string;

  @Column({ default: true })
  isActive: boolean;

  // Orthogonal to isActive — isActive means "currently allowed to serve
  // live traffic" (also flipped by platform-admin suspend/reactivate, see
  // PlatformTenantService.suspendTenant); this only ever moves forward
  // once through the provisioning lifecycle and never changes on
  // suspend/reactivate. See TenantProvisioningProcessor.
  @Column({ default: TenantOnboardingStatus.PENDING })
  onboardingStatus: TenantOnboardingStatus;

  // Only ever set while onboardingStatus is AWAITING_APPROVAL — the signup
  // details `provision()` needs (admin name/email, plan, branch-invite
  // linkage) that ensurePendingTenant() itself never persists, stashed here
  // because approval can happen an unpredictable amount of time after
  // signup (unlike the normal flow, where they only ever live transiently
  // in the queue job payload). Cleared implicitly once approveTenant()
  // enqueues real provisioning — nothing reads this once ACTIVE.
  @Column({ type: 'jsonb', nullable: true })
  pendingSignupParams: Record<string, unknown> | null;

  // Set exactly once, the moment onboardingStatus first reaches ACTIVE
  // (TenantProvisioningProcessor.handle() for the async path,
  // PlatformTenantService.createTenant() for the inline one) — distinct from
  // createdAt, which is when the PENDING row was first created and can be
  // days earlier for a signup that sat AWAITING_APPROVAL a while.
  // FounderWelcomeEmailScheduler's "1 day after activation" threshold reads
  // this, not createdAt, for exactly that reason.
  @Column({ nullable: true })
  activatedAt: Date | null;

  // Set once FounderWelcomeEmailScheduler successfully sends the founder's
  // personal welcome note — the guard against sending it twice, and against
  // ever sending it again on a later scheduler run for a tenant already
  // handled. Null (not just "activatedAt is old") is the actual signal a
  // send is still due, since a failed attempt must stay null to retry on the
  // next day's run.
  @Column({ nullable: true })
  founderWelcomeEmailSentAt: Date | null;

  // Self-referencing and nullable — a flat parent -> branch model, though
  // only one level is used today; a multi-level hierarchy (branch-of-a-
  // branch) is representable with zero further schema change
  // (docs/MULTI_TENANT_MIGRATION.md §11.1). Set at provisioning time
  // (accepting a branch invite) or nulled later by BranchRollupService's
  // unlinkBranch/leaveParent.
  @Index()
  @Column({ nullable: true })
  parentTenantId: string | null;

  // Self-service, settable only by this tenant's own admin — never the
  // parent. Gates BranchRollupService.getOverview()'s per-branch visibility,
  // not computation: a branch's own tenant_rollups row is always computed
  // regardless, this only controls what a parent is shown.
  @Column({ default: true })
  shareDataWithParent: boolean;

  // Giving stays opt-in even when shareDataWithParent is on — deliberately
  // separate flag, given how sensitive individual church finances are
  // treated everywhere else in this codebase.
  @Column({ default: false })
  shareGivingWithParent: boolean;

  // Platform-admin-only manual override, per KNOWN_MODULES key, layered on
  // top of ModuleEnabledGuard's existing tenant-self-toggle + plan-features
  // check: `true` grants the module regardless of what the tenant's plan
  // includes (e.g. a beta tester, or comping a specific church ahead of a
  // real paid tier existing for it), `false` blocks it regardless of plan
  // (e.g. pulling access from one tenant without touching their plan or
  // every other tenant on it). A key simply absent from this map means
  // "no override — fall through to the plan check," not "denied." Free-form
  // jsonb map rather than one column per module, same reasoning
  // Plan.featureLimits documents for its own shape: any current or future
  // module becomes overridable from the Tenant edit UI with no migration.
  @Column({ type: 'jsonb', nullable: true })
  moduleOverrides: Record<string, boolean> | null;
}
