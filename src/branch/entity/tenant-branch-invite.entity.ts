import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';

export enum BranchInviteStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REVOKED = 'revoked',
}

// Control-plane table — lives in `public`, never a `search_path` target.
// Has to live here rather than in the parent's tenant schema because the
// invited church has no tenant/schema of its own yet at invite-creation
// time — the very thing this row exists to eventually create
// (docs/MULTI_TENANT_MIGRATION.md §11.1).
@Entity({ name: 'tenant_branch_invites' })
export class TenantBranchInvite extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  parentTenantId: string;

  @Column()
  email: string;

  @Index({ unique: true })
  @Column()
  token: string;

  @Column({ type: 'varchar', default: BranchInviteStatus.PENDING })
  status: BranchInviteStatus;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ nullable: true })
  acceptedTenantId: string | null;

  // The parent's stated intent at invite-creation time — if true, the
  // branch is provisioned onto the parent's current plan at no independent
  // cost, sponsored by the parent (Subscription.sponsoredByTenantId), rather
  // than starting on Free like a normal signup.
  @Column({ default: false })
  sponsorPlan: boolean;
}
