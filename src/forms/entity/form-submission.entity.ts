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
import { Form } from './form.entity';

// FormSubmissionService.getMySubmission looks up by (form, member) together
// — the "you already submitted this form, want to edit it?" lookup.
@Index('IDX_form_submissions_form_id_member_id', ['form', 'member'])
@Entity({ name: 'form_submissions' })
export class FormSubmission extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_form_submissions_form_id')
  @ManyToOne(() => Form, (form) => form.submissions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'form_id' })
  form: Form;

  // Null for a public/anonymous submission — never a rejected write, just
  // no identity to attach. Deliberately SET NULL rather than CASCADE on
  // member deletion: member deletion isn't exposed anywhere in this API
  // (only deactivation), but a prior member's submissions should survive
  // regardless of what happens to the member record.
  @Index('IDX_form_submissions_member_id')
  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'member_id' })
  member: Member | null;

  // Map of FormField.id -> submitted value. Keyed by field id rather than
  // a normalized per-field-answer table so a field can be edited or removed
  // later without needing to migrate every past submission — a removed
  // field just leaves a harmless orphaned key behind.
  @Column({ type: 'jsonb' })
  answers: Record<string, unknown>;

  // Normalized value of Form.dedupField's submitted answer, set only when
  // the form designates a dedup field. Paired with a partial unique index
  // (form_id, dedup_value_normalized) WHERE NOT NULL — enforced at the DB
  // level so a race between two near-simultaneous duplicate submissions
  // can't both slip through an application-level check alone.
  @Column({ name: 'dedup_value_normalized', nullable: true })
  dedupValueNormalized: string | null;
}
