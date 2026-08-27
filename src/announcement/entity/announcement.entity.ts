import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AnnouncementAudienceEnum } from '../enum/announcement-audience.enum';
import { Member } from '../../member/entity/member.entity';
import { Department } from '../../department/entity/department.entity';
import { Group } from '../../group/entity/group.entity';
import { ChurchClass } from '../../classes/entity/church-class.entity';
import { BaseEntity } from '../../utility/entity/base.entity';

@Entity('announcements')
export class Announcement extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ type: 'text' })
  body: string;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  author: Member | null;

  @Index()
  @Column({ default: AnnouncementAudienceEnum.ALL })
  audience: AnnouncementAudienceEnum;

  @Index()
  @ManyToOne(() => Department, { nullable: true, onDelete: 'SET NULL' })
  department: Department | null;

  @Index()
  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  targetMember: Member | null;

  @Index()
  @ManyToOne(() => Group, { nullable: true, onDelete: 'SET NULL' })
  group: Group | null;

  // Column is `class_id` (not the SnakeNamingStrategy default of
  // `church_class_id`) — matches AddClassAudienceToAnnouncements exactly.
  @Index()
  @ManyToOne(() => ChurchClass, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'class_id' })
  churchClass: ChurchClass | null;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ default: false })
  sendViaSms: boolean;

  // Deliberately separate from `body` — the announcement body is often
  // long-form and meant for in-app reading, whereas SMS is billed per
  // segment, so admins compose a distinct, short message for it.
  @Column({ type: 'text', nullable: true })
  smsBody: string | null;
}
