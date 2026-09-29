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

export enum NotificationChannel {
  PUSH = 'PUSH',
  EMAIL = 'EMAIL',
}

// A church's own wording for one catalogue notification; missing fields fall back to the default.
@Entity({ name: 'notification_template_overrides' })
@Index(
  'UQ_notification_template_overrides_channel_template_key',
  ['channel', 'templateKey'],
  {
    unique: true,
  },
)
export class NotificationTemplateOverride extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  channel: NotificationChannel;

  @Column({ type: 'varchar' })
  templateKey: string;

  @Column({ type: 'varchar', nullable: true })
  title: string | null;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by_id' })
  updatedBy: Member | null;
}
