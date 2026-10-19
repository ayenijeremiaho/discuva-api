import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { TeamPost } from './team-post.entity';

export interface PollOption {
  id: string;
  text: string;
}

// A poll is a post in the space; the question is the post body.
@Entity({ name: 'team_polls' })
export class TeamPoll extends BaseEntity {
  @PrimaryColumn('uuid', { name: 'post_id' })
  postId: string;

  @OneToOne(() => TeamPost, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'post_id' })
  post: TeamPost;

  @Column({ type: 'jsonb' })
  options: PollOption[];

  @Column({ default: false })
  multiple: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  closesAt: Date | null;
}
