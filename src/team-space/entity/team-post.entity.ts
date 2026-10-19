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
import { TeamSpace } from './team-space.entity';

export enum TeamPostTypeEnum {
  POST = 'POST',
  MEETING = 'MEETING',
  POLL = 'POLL',
}

@Entity({ name: 'team_posts' })
export class TeamPost extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => TeamSpace, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'space_id' })
  space: TeamSpace;

  @Index()
  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'author_id' })
  author: Member | null;

  @Column({ type: 'varchar', default: TeamPostTypeEnum.POST })
  type: TeamPostTypeEnum;

  @Column({ type: 'text' })
  body: string;

  @Column({ default: false })
  pinned: boolean;

  @Column({ type: 'int', default: 0 })
  replyCount: number;

  // Moves with each reply, so the feed shows active conversations first.
  @Column({ type: 'timestamptz' })
  lastActivityAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  editedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  removedAt: Date | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'removed_by_id' })
  removedBy: Member | null;
}
