import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Tenant } from './tenant.entity';
import { TenantOnboardingActorType } from '../enum/tenant-onboarding-actor-type.enum';

export type TenantOnboardingEventType =
  | 'SIGNUP_INITIATED'
  | 'PLATFORM_ADMIN_INITIATED'
  // Self-serve only, and only when PlatformSettingKey.SELF_SERVE_REQUIRES_APPROVAL
  // is on — recorded instead of enqueueing provisioning immediately.
  | 'AWAITING_APPROVAL'
  | 'AWAITING_CONFIRMATION'
  // A platform admin released a held signup — actorType is always
  // PLATFORM_ADMIN here, distinct from PLATFORM_ADMIN_INITIATED (that one
  // means the admin created the tenant themselves; this one means they
  // approved someone else's self-serve signup).
  | 'APPROVED'
  | 'PROVISIONING_STARTED'
  | 'PROVISIONING_COMPLETED'
  | 'PROVISIONING_FAILED';

// Control-plane table — lives in `public`, alongside `tenants` itself. A
// platform-level audit trail for the onboarding lifecycle, distinct from
// AuditLogService (tenant-scoped, lives in each church's own schema, actor
// FKs to that tenant's own Member) — these events happen before/independent
// of any tenant schema existing, so they can't go through that mechanism.
@Entity({ name: 'tenant_onboarding_events' })
export class TenantOnboardingEvent extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column()
  event: TenantOnboardingEventType;

  @Column()
  actorType: TenantOnboardingActorType;

  // Platform admin id when actorType is PLATFORM_ADMIN, null otherwise.
  @Column({ nullable: true })
  actorId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;
}
