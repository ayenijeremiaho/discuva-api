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

// An emoji reaction on a post (reply null) or on a reply. Uniqueness is per member, emoji and target (partial indexes).
@Entity({ name: 'team_post_reactions' })
export class TeamPostReaction extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => TeamPost, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'post_id' })
  post: TeamPost;

  @ManyToOne(() => TeamPostReply, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reply_id' })
  reply: TeamPostReply | null;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({ type: 'varchar', length: 16 })
  emoji: string;
}
