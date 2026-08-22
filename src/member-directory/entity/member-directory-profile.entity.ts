import {
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';

// Deliberately a separate entity from Member rather than columns bolted
// onto it — this is an optional module (KNOWN_MODULES 'member_directory'),
// and keeping it separate means the whole feature is cleanly removable via
// one migration rather than schema debt on the core Member table.
@Entity({ name: 'member_directory_profiles' })
export class MemberDirectoryProfile extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({ nullable: true })
  occupation: string | null;

  // Separate from occupation — "I'm an accountant" and "I run Adaeze's
  // Catering" are different facts a member may want to share independently.
  @Column({ nullable: true })
  businessName: string | null;

  // Free text, comma-separated — kept plain (not a Postgres array column)
  // so it stays searchable with the same LOWER(...) LIKE pattern as every
  // other field here, no new query technique needed.
  @Column({ nullable: true })
  skills: string | null;

  @Column({ nullable: true, type: 'text' })
  bio: string | null;

  // The submitter's own opt-in flag, no separate publish/moderation step —
  // same convention as Testimony.isPublic.
  @Index()
  @Column({ default: false })
  isVisible: boolean;

  // Separate from isVisible — surfacing contact info is a materially
  // bigger privacy step than showing an opted-in occupation/business/bio.
  @Column({ default: false })
  showPhone: boolean;

  @Column({ default: false })
  showEmail: boolean;
}
