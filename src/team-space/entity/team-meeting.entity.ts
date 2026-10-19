import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';
import { TeamPost } from './team-post.entity';
import { TeamSpace } from './team-space.entity';

// A meeting is a post in the space, so it gets replies, pinning and unread counts for free. The agenda is the post body.
@Entity({ name: 'team_meetings' })
export class TeamMeeting extends BaseEntity {
  @PrimaryColumn('uuid', { name: 'post_id' })
  postId: string;

  @OneToOne(() => TeamPost, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'post_id' })
  post: TeamPost;

  @ManyToOne(() => TeamSpace, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'space_id' })
  space: TeamSpace;

  @Column()
  title: string;

  @Column({ type: 'timestamptz' })
  startsAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  endsAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  location: string | null;

  @Column({ type: 'varchar', nullable: true })
  onlineLink: string | null;

  @Column({ type: 'text', nullable: true })
  minutes: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  minutesUpdatedAt: Date | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'minutes_by_id' })
  minutesBy: Member | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;
}
