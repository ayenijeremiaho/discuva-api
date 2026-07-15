import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AnnouncementAudienceEnum } from '../enum/announcement-audience.enum';
import { Member } from '../../member/entity/member.entity';
import { Department } from '../../department/entity/department.entity';
import { Group } from '../../group/entity/group.entity';
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

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;
}
