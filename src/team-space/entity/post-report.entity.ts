import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';
import { TeamPost } from './team-post.entity';
import { TeamPostReply } from './team-post-reply.entity';

export enum ReportOutcomeEnum {
  KEPT = 'KEPT',
  REMOVED = 'REMOVED',
}

@Entity({ name: 'post_reports' })
export class PostReport extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => TeamPost, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'post_id' })
  post: TeamPost;

  @ManyToOne(() => TeamPostReply, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reply_id' })
  reply: TeamPostReply | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reporter_id' })
  reporter: Member | null;

  @Column({ type: 'varchar', length: 300 })
  reason: string;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resolved_by_id' })
  resolvedBy: Member | null;

  @Column({ type: 'varchar', nullable: true })
  outcome: ReportOutcomeEnum | null;
}
