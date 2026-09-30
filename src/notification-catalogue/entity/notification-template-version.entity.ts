import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';
import { NotificationChannel } from './notification-template-override.entity';

export enum NotificationTemplateAction {
  SAVED = 'SAVED',
  RESET = 'RESET',
  RESTORED = 'RESTORED',
}

// Snapshot of the full wording in effect after each change, kept for history and restore.
@Entity({ name: 'notification_template_versions' })
@Index('IDX_notification_template_versions_channel_template_key', [
  'channel',
  'templateKey',
])
export class NotificationTemplateVersion extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  channel: NotificationChannel;

  @Column({ type: 'varchar' })
  templateKey: string;

  @Column({ type: 'varchar' })
  action: NotificationTemplateAction;

  @Column({ type: 'jsonb' })
  content: Record<string, string>;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: Member | null;
}
