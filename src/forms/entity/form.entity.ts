import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Event } from '../../event/entity/event.entity';
import { Group } from '../../group/entity/group.entity';
import { FormVisibility } from '../enum/form.enum';
import { FormField } from './form-field.entity';
import { FormSubmission } from './form-submission.entity';

@Entity({ name: 'forms' })
export class Form extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ nullable: true })
  description: string | null;

  @Index()
  @Column({ default: FormVisibility.MEMBERS })
  visibility: FormVisibility;

  @Index('IDX_forms_event_id')
  @ManyToOne(() => Event, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'event_id' })
  event: Event | null;

  @Index()
  @Column({ default: true })
  isActive: boolean;

  // When true, a public submission to this form also creates a FirstTimer
  // record (source=ONLINE) — the online-intake counterpart to a physical
  // walk-in, reachable via a QR code/shared link rather than someone at
  // the door. Only meaningful on a PUBLIC-visibility form; enforced at
  // create/update time (see FormService).
  @Column({ name: 'creates_first_timers', default: false })
  createsFirstTimers: boolean;

  @Column({ name: 'cover_image_url', nullable: true })
  coverImageUrl: string | null;

  @Column({ name: 'cover_image_public_id', nullable: true })
  coverImagePublicId: string | null;

  @Column({ name: 'logo_url', nullable: true })
  logoUrl: string | null;

  @Column({ name: 'logo_public_id', nullable: true })
  logoPublicId: string | null;

  // Restricts a MEMBERS-visibility form to members of this Group ("Contact
  // List") — e.g. an admin builds a "HODs" group via the existing Contact
  // Lists feature, then points a form at it. Null means unrestricted
  // (every member sees it, today's behaviour). Never applies to PUBLIC
  // forms, which have no member identity to check against.
  @Index('IDX_forms_audience_group_id')
  @ManyToOne(() => Group, { nullable: true, onDelete: 'SET NULL', eager: true })
  @JoinColumn({ name: 'audience_group_id' })
  audienceGroup: Group | null;

  // The field whose (normalized) submitted value must be unique per form —
  // e.g. a phone-number field, to stop the same volunteer registering
  // twice. Null means no dedup. SET NULL rather than a hard block on field
  // removal, matching this module's existing tolerance for a designated
  // field being deleted later (see FormSubmission.answers' own comment).
  @ManyToOne(() => FormField, {
    nullable: true,
    onDelete: 'SET NULL',
    eager: true,
  })
  @JoinColumn({ name: 'dedup_field_id' })
  dedupField: FormField | null;

  // The DROPDOWN field whose selected option's optionMetadata (url +
  // description) drives the dynamic post-submission response. Restricted
  // to DROPDOWN at the service layer — CHECKBOX's multi-value answers
  // don't map to "one selected option's metadata".
  @ManyToOne(() => FormField, {
    nullable: true,
    onDelete: 'SET NULL',
    eager: true,
  })
  @JoinColumn({ name: 'next_steps_field_id' })
  nextStepsField: FormField | null;

  @Column({ name: 'post_submit_message', nullable: true })
  postSubmitMessage: string | null;

  // Always-shown second call-to-action on the post-submission screen —
  // e.g. "Join the Main Volunteer Group" — distinct from nextStepsField's
  // per-selected-option link. Both are independent and optional; a form
  // can have either, both, or neither.
  @Column({ name: 'general_action_url', nullable: true })
  generalActionUrl: string | null;

  @Column({ name: 'general_action_label', nullable: true })
  generalActionLabel: string | null;

  // Deliberately no `cascade: true` here — Form also has two other
  // relations to FormField (dedupField/nextStepsField below). Cascading
  // `fields` while ANY other relation on this same entity also targets
  // FormField makes TypeORM's SubjectTopologicalSorter throw "Cyclic
  // dependency: FormField" on save, even when dedupField/nextStepsField are
  // completely unset — a metadata-level limitation, not a runtime-value
  // one (confirmed by isolating each relation independently against a real
  // Postgres instance). FormService persists `fields` as its own explicit
  // `fieldRepo.save()` call instead of relying on cascade.
  @OneToMany(() => FormField, (field) => field.form, {
    eager: true,
  })
  fields: FormField[];

  @OneToMany(() => FormSubmission, (submission) => submission.form)
  submissions: FormSubmission[];
}
