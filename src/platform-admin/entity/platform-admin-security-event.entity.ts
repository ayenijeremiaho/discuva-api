import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { PlatformAdmin } from './platform-admin.entity';

// The tenant audit log needs a church schema, so platform admin security changes are kept here.
@Entity({ name: 'platform_admin_security_events' })
@Index('IDX_platform_admin_security_events_admin_created', [
  'platformAdminId',
  'createdAt',
])
export class PlatformAdminSecurityEvent extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'platform_admin_id' })
  platformAdminId: string;

  @ManyToOne(() => PlatformAdmin, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'platform_admin_id' })
  platformAdmin: PlatformAdmin;

  @Index('IDX_platform_admin_security_events_actor')
  @Column({ type: 'uuid', name: 'actor_id', nullable: true })
  actorId: string | null;

  @ManyToOne(() => PlatformAdmin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_id' })
  actor: PlatformAdmin | null;

  @Column()
  action: string;
}
