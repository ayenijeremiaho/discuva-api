import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import {
  FormFieldAutoFill,
  FormFieldType,
  FormFieldVisibilityOperator,
} from '../enum/form.enum';
import { Form } from './form.entity';

export interface FormFieldVisibilityRule {
  fieldId: string;
  operator: FormFieldVisibilityOperator;
  value: string;
}

@Entity({ name: 'form_fields' })
export class FormField extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_form_fields_form_id')
  @ManyToOne(() => Form, (form) => form.fields, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'form_id' })
  form: Form;

  @Column()
  label: string;

  // Optional helper text shown under the label while filling out the
  // form — e.g. "Enter your legal name as it appears on your ID". Distinct
  // from Form.description, which introduces the form as a whole.
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ default: FormFieldType.TEXT })
  fieldType: FormFieldType;

  @Column({ default: false })
  required: boolean;

  // Choices for DROPDOWN/CHECKBOX — null for every other field type.
  @Column({ type: 'text', array: true, nullable: true })
  options: string[] | null;

  // Per-option url/description, keyed by the option's own string value —
  // e.g. {"Media/Sound": {"url": "...", "description": "..."}}. Only
  // ever surfaced to a visitor for the option they actually chose, via
  // Form.nextStepsField — never returned in full on the public GET.
  @Column({ name: 'option_metadata', type: 'jsonb', nullable: true })
  optionMetadata: Record<string, { url?: string; description?: string }> | null;

  @Column({ type: 'smallint', default: 0 })
  order: number;

  @Column({ nullable: true })
  autoFillKey: FormFieldAutoFill | null;

  // Bound checks enforced in FormSubmissionService.validateAnswers, on top
  // of that same method's EMAIL/NUMBER/DATE format checks — a bound only
  // applies to its matching fieldType (enforced at create/update time by
  // FormService.assertValidFieldConstraints), null means unbounded on that
  // side. NUMBER only:
  @Column({ name: 'min_value', type: 'double precision', nullable: true })
  minValue: number | null;

  @Column({ name: 'max_value', type: 'double precision', nullable: true })
  maxValue: number | null;

  // TEXT/TEXTAREA only — character count.
  @Column({ name: 'min_length', type: 'smallint', nullable: true })
  minLength: number | null;

  @Column({ name: 'max_length', type: 'smallint', nullable: true })
  maxLength: number | null;

  // CHECKBOX only — count of selected options.
  @Column({ name: 'min_selections', type: 'smallint', nullable: true })
  minSelections: number | null;

  @Column({ name: 'max_selections', type: 'smallint', nullable: true })
  maxSelections: number | null;

  // TEXT/TEXTAREA only — a submitted answer must match this regex
  // (`new RegExp(validationRegex).test(value)`), checked in
  // FormSubmissionService.validateFieldPattern. Syntax + fieldType are
  // checked at create/update time by FormService.assertValidFieldPattern.
  // `validationMessage` is shown instead of the generic "doesn't match the
  // required format" error when set — e.g. "Must be an 11-digit NIN".
  // Admin-authored (create/update requires AdminGuard + FORMS_WRITE), not
  // visitor input — still length-capped at the DTO level as defense-in-
  // depth against a pathological catastrophic-backtracking pattern.
  @Column({ name: 'validation_regex', nullable: true })
  validationRegex: string | null;

  @Column({ name: 'validation_message', nullable: true })
  validationMessage: string | null;

  // Per-field conditional visibility, evaluated against the submitted (or,
  // on the frontend, the in-progress) answers — `fieldId` references
  // another FormField on the SAME form by id (validated at create/update
  // time by FormService.assertValidVisibilityRules). Plain jsonb, not a
  // relation — deliberately mirrors optionMetadata's shape rather than
  // dedupField/nextStepsField's `@ManyToOne` one, since a jsonb column
  // carries no relation semantics for TypeORM's topological sorter to see
  // — this sidesteps the Form.fields cyclic-dependency class of bug
  // entirely rather than needing its `.update()`-not-`.save()` workaround.
  // `null` means always visible (every existing field is unaffected).
  // FormSubmissionService.validateAnswers evaluates this *before* a
  // field's `required` check, so a conditionally-hidden field never blocks
  // submission regardless of what the client rendered.
  @Column({ name: 'visibility_rule', type: 'jsonb', nullable: true })
  visibilityRule: FormFieldVisibilityRule | null;

  // Which page of a multi-page form this field appears on — a plain
  // grouping key, not a relation to a first-class "page" entity (per
  // design choice). Default 0 means every field lands on the same single
  // page unless a form builder explicitly opts into pagination, so an
  // older form with no pageIndex set is unaffected. Grouping/rendering is
  // entirely a frontend concern (PaginatedFormFillFields) — no backend
  // pagination logic; a submission is still one atomic final POST.
  @Column({ name: 'page_index', type: 'smallint', default: 0 })
  pageIndex: number;
}
