import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';

// A mute past its end date is simply ignored, so nothing needs to clear it.
@Entity({ name: 'community_mutes' })
export class CommunityMute extends BaseEntity {
  @PrimaryColumn({ type: 'uuid', name: 'member_id' })
  memberId: string;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({ type: 'timestamptz' })
  until: Date;

  @Column({ type: 'varchar', length: 300, nullable: true })
  reason: string | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'muted_by_id' })
  mutedBy: Member | null;
}
