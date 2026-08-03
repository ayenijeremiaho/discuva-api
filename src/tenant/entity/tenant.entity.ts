import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';

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

  @Column({ default: 'NGN' })
  currency: string;

  @Column({ default: 'UTC' })
  timezone: string;

  @Column({ default: true })
  isActive: boolean;

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
}
