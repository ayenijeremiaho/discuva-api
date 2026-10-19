import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';
import { TeamSpace } from './team-space.entity';

// When a member last opened a space: drives unread counts and keeps read items out of the daily digest.
@Entity({ name: 'team_space_reads' })
@Unique(['member', 'space'])
export class TeamSpaceRead extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Index()
  @ManyToOne(() => TeamSpace, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'space_id' })
  space: TeamSpace;

  @Column({ type: 'timestamptz' })
  lastReadAt: Date;
}
