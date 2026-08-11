import {
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  Column,
} from 'typeorm';
import { Member } from './member.entity';
import { ClergyTitle } from '../../clergy-title/entity/clergy-title.entity';
import { BaseEntity } from '../../utility/entity/base.entity';

// Independent of WorkerProfile/Department on purpose — a clergy member may
// have no department (e.g. a Lead Pastor) or may separately also be an HOD.
@Entity({ name: 'clergy' })
export class Clergy extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  // Tenant-configurable title (Lead Pastor, Priest, Bishop, ...) — see
  // ClergyTitle. RESTRICT, not CASCADE/SET NULL: ClergyTitleService.delete
  // already blocks deleting an in-use title, this is the DB-level backstop.
  @Index()
  @ManyToOne(() => ClergyTitle, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'clergy_title_id' })
  title: ClergyTitle;

  // Independent of `title` on purpose — holding a title (a promotion/
  // recognition) does NOT automatically grant the ability to see and
  // respond to every department's Pastor Feedback reports. An admin sets
  // this explicitly, separate from assigning/changing the title. Defaults
  // true so existing clergy don't lose access on rollout of this column.
  @Column({ name: 'can_review_feedback', default: true })
  canReviewFeedback: boolean;
}
