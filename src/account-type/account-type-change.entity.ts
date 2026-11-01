import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../utility/entity/base.entity';
import { PlatformAdmin } from '../platform-admin/entity/platform-admin.entity';

// The tenant audit log needs a church schema and a member, and these changes have neither.
@Entity({ name: 'account_type_changes' })
@Index('IDX_account_type_changes_type_created', ['accountType', 'createdAt'])
export class AccountTypeChange extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'account_type', type: 'varchar' })
  accountType: string;

  @Column({ type: 'uuid', name: 'actor_id', nullable: true })
  actorId: string | null;

  @ManyToOne(() => PlatformAdmin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_id' })
  actor: PlatformAdmin | null;

  @Column({ type: 'jsonb' })
  changes: Record<string, unknown>;
}
