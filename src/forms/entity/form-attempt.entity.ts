import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Form } from './form.entity';
import { Member } from '../../member/entity/member.entity';
import { FormSubmission } from './form-submission.entity';

// One row per time-limited QUIZ attempt (Form.timeLimitMinutes set). Created
// by FormAttemptService.startOrGetAttempt when a member starts the quiz,
// consumed (submission set) when they submit. No hard unique constraint on
// (form, member) — a member can accumulate more than one attempt over time
// when Form.oneResponsePerMember is false (retakes allowed); the service,
// not the DB, decides whether to reuse an in-progress attempt or start a
// fresh one. See the "Time-boxing" section of the Quiz/Voting plan for the
// full lifecycle.
@Index('IDX_form_attempts_form_id_member_id', ['form', 'member'])
@Entity({ name: 'form_attempts' })
export class FormAttempt extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // No standalone index here — the (form, member) composite above already
  // serves any form_id-only lookup (including the form-delete cascade); see
  // DropUnusedFormIndexes1797922800000 for why the old standalone index was
  // removed.
  @ManyToOne(() => Form, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'form_id' })
  form: Form;

  // No standalone index here — nothing queries by member_id alone, and a
  // member hard-delete (the only thing that would exercise this FK's
  // CASCADE) is forbidden by CLAUDE.md's Member Deletion Policy; see
  // DropUnusedFormIndexes1797922800000.
  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  // Computed once at start: min(startedAt + timeLimitMinutes, form.closesAt
  // ?? Infinity) — stored rather than recomputed, so a later admin edit to
  // timeLimitMinutes/closesAt never retroactively changes an attempt
  // already in progress.
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  // Set once this attempt is consumed by a real submission — null means
  // still in progress (or expired without ever submitting). Nullable SET
  // NULL rather than CASCADE: a submission being edited/removed shouldn't
  // silently resurrect an attempt as "in progress" again.
  @Index('IDX_form_attempts_submission_id')
  @ManyToOne(() => FormSubmission, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'submission_id' })
  submission: FormSubmission | null;
}
