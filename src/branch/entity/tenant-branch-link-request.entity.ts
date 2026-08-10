import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';

export enum BranchLinkRequestStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  REVOKED = 'revoked',
}

// Control-plane table — lives in `public`, never a `search_path` target.
// Sibling of TenantBranchInvite (docs/MULTI_TENANT_MIGRATION.md §11.1), but
// for the case TenantBranchInvite can't cover: both churches already exist
// as separate onboarded tenants, so there's no signup step to attach a
// token to — this is a negotiation between two existing tenants instead,
// requiring accept/decline on the target's own side rather than a one-way
// invite code.
@Entity({ name: 'tenant_branch_link_requests' })
export class TenantBranchLinkRequest extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  parentTenantId: string;

  @Index()
  @Column()
  targetTenantId: string;

  @Column({ type: 'varchar', default: BranchLinkRequestStatus.PENDING })
  status: BranchLinkRequestStatus;

  // Same meaning as TenantBranchInvite.sponsorPlan — if true and the parent
  // is on a paid plan when the target accepts, the target's existing
  // subscription is switched onto the parent's plan, sponsored
  // (Subscription.sponsoredByTenantId) rather than left as-is.
  @Column({ default: false })
  sponsorPlan: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  respondedAt: Date | null;
}
