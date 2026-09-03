import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  FIELD_TYPES_REQUIRING_OPTIONS,
  FormFieldAutoFill,
  FormFieldType,
  FormFieldVisibilityOperator,
  FormVisibility,
} from '../enum/form.enum';

// A raw fieldId string, not a relation — the referenced field must already
// exist among the request's own `fields` (validated in
// FormService.assertValidVisibilityRules, since that depends on sibling
// data a decorator alone can't see).
export class FormFieldVisibilityRuleDto {
  @IsUUID()
  fieldId: string;

  @IsEnum(FormFieldVisibilityOperator)
  operator: FormFieldVisibilityOperator;

  @IsString()
  value: string;
}

export class FormFieldDto {
  // Present when updating an existing field (keeps its answers linkage
  // stable across edits); omitted when adding a new one.
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @IsNotEmpty()
  label: string;

  // Optional helper text shown under the label while filling out the
  // form — e.g. "Enter your legal name as it appears on your ID".
  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(FormFieldType)
  fieldType: FormFieldType;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ValidateIf((f) => FIELD_TYPES_REQUIRING_OPTIONS.has(f.fieldType))
  @IsArray()
  @ArrayMinSize(1, {
    message: 'DROPDOWN and CHECKBOX fields need at least one option',
  })
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  // Which page of a multi-page form this field appears on — grouping only,
  // no backend pagination logic (PaginatedFormFillFields on the frontend
  // does the grouping/rendering). Omitted defaults to 0, same as the
  // entity's own default.
  @IsOptional()
  @IsInt()
  @Min(0)
  pageIndex?: number;

  @IsOptional()
  @IsEnum(FormFieldAutoFill)
  autoFillKey?: FormFieldAutoFill;

  // Per-option {url, description}, keyed by option value. Deep-validated
  // in FormService (every key must be one of this field's own `options`,
  // any url must be a real URL) rather than via decorators, since that
  // check depends on the sibling `options` array.
  @IsOptional()
  @IsObject()
  optionMetadata?: Record<string, { url?: string; description?: string }>;

  // Bound checks — each only valid for its matching fieldType (NUMBER for
  // min/maxValue, TEXT/TEXTAREA for min/maxLength, CHECKBOX for
  // min/maxSelections), enforced in FormService.assertValidFieldConstraints
  // since that depends on the sibling `fieldType`. Omitted = unbounded on
  // that side.
  @IsOptional()
  @IsNumber()
  minValue?: number;

  @IsOptional()
  @IsNumber()
  maxValue?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minLength?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxLength?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minSelections?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxSelections?: number;

  // TEXT/TEXTAREA only. Syntax + fieldType validated in
  // FormService.assertValidFieldPattern (a raw regex source string can't be
  // checked by a decorator alone — needs `new RegExp()` to catch a syntax
  // error). MaxLength is defense-in-depth against a pathological
  // catastrophic-backtracking pattern — this is admin-authored, not
  // visitor input, but the length cap costs nothing and narrows the blast
  // radius regardless.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  validationRegex?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  validationMessage?: string;

  // Conditional visibility — see FormFieldVisibilityRuleDto and the
  // entity column's own comment. Omitted = always visible.
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FormFieldVisibilityRuleDto)
  visibilityRule?: FormFieldVisibilityRuleDto;
}

export class CreateFormDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(FormVisibility)
  visibility: FormVisibility;

  @IsOptional()
  @IsUUID()
  eventId?: string;

  // Requires visibility=PUBLIC and at least one field each carrying
  // autoFillKey FIRST_NAME/LAST_NAME/PHONE_NUMBER — validated in
  // FormService, not here, since it depends on the sibling `fields` array.
  @IsOptional()
  @IsBoolean()
  createsFirstTimers?: boolean;

  // Emails every admin with FORMS_WRITE on each member/public submission —
  // see Form.notifyOnSubmission.
  @IsOptional()
  @IsBoolean()
  notifyOnSubmission?: boolean;

  // Admin kill-switch for a member editing their own submission after the
  // fact — see Form.editableAfterSubmit. Defaults true (same as the
  // entity's own column default) when omitted.
  @IsOptional()
  @IsBoolean()
  editableAfterSubmit?: boolean;

  // Restricts a MEMBERS-visibility form to members of this Group ("Contact
  // List"). Rejected in FormService if set alongside PUBLIC/ADMIN_ONLY
  // visibility — there's no member identity to check against there.
  @IsOptional()
  @IsUUID()
  audienceGroupId?: string;

  // Must match an id among the incoming `fields` — validated in
  // FormService, not here, same as autoFillKey's cross-field dependency.
  @IsOptional()
  @IsUUID()
  dedupFieldId?: string;

  // Must reference a DROPDOWN field among `fields` — validated in
  // FormService.
  @IsOptional()
  @IsUUID()
  nextStepsFieldId?: string;

  @IsOptional()
  @IsString()
  postSubmitMessage?: string;

  // Always-shown second call-to-action on the post-submission screen —
  // e.g. "Join the Main Volunteer Group" — independent of any field/option.
  // Both must be present together or both absent; validated in FormService.
  @IsOptional()
  @IsString()
  generalActionUrl?: string;

  @IsOptional()
  @IsString()
  generalActionLabel?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'A form needs at least one field' })
  @ValidateNested({ each: true })
  @Type(() => FormFieldDto)
  fields: FormFieldDto[];
}

export class UpdateFormDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsEnum(FormVisibility)
  visibility?: FormVisibility;

  @IsOptional()
  @IsUUID()
  eventId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  createsFirstTimers?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnSubmission?: boolean;

  @IsOptional()
  @IsBoolean()
  editableAfterSubmit?: boolean;

  // Explicit null clears the restriction (form becomes unrestricted again);
  // omitted leaves the current value untouched, same convention as eventId
  // above.
  @IsOptional()
  @IsUUID()
  audienceGroupId?: string | null;

  @IsOptional()
  @IsUUID()
  dedupFieldId?: string | null;

  @IsOptional()
  @IsUUID()
  nextStepsFieldId?: string | null;

  @IsOptional()
  @IsString()
  postSubmitMessage?: string | null;

  @IsOptional()
  @IsString()
  generalActionUrl?: string | null;

  @IsOptional()
  @IsString()
  generalActionLabel?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'A form needs at least one field' })
  @ValidateNested({ each: true })
  @Type(() => FormFieldDto)
  fields?: FormFieldDto[];
}

// Every field except `title` follows the same "omitted = inherited from
// source, explicit null = cleared, value = override" convention as
// UpdateFormDto's own nullable fields (PrayerConfigService.cloneProgram's
// simpler "omitted = inherited" convention doesn't need a clear case since
// PrayerProgram has no nullable FKs to clear). Deliberately carries no
// `fields` — FormService.cloneForm always deep-copies the source's fields
// verbatim (with fresh ids); a clone's fields are edited afterwards via the
// normal PATCH, not at clone time.
export class CloneFormDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsEnum(FormVisibility)
  visibility?: FormVisibility;

  @IsOptional()
  @IsUUID()
  eventId?: string | null;

  @IsOptional()
  @IsBoolean()
  createsFirstTimers?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnSubmission?: boolean;

  @IsOptional()
  @IsBoolean()
  editableAfterSubmit?: boolean;

  @IsOptional()
  @IsUUID()
  audienceGroupId?: string | null;

  @IsOptional()
  @IsString()
  postSubmitMessage?: string | null;

  @IsOptional()
  @IsString()
  generalActionUrl?: string | null;

  @IsOptional()
  @IsString()
  generalActionLabel?: string | null;
}

export class SubmitFormDto {
  // Keyed by FormField.id — validated against the form's actual fields in
  // the service, not here, since the DTO can't know a given form's schema
  // at compile time.
  @IsObject()
  answers: Record<string, unknown>;
}

export class AdminSubmitFormDto extends SubmitFormDto {
  // Links the record to an existing member (e.g. documenting an existing
  // member's baptism) — omitted for a subject with no member account (e.g.
  // a newborn being named), same as a public submission's null member.
  @IsOptional()
  @IsUUID()
  memberId?: string;
}

// Returned by every submit endpoint. `selectedOption` carries ONLY the
// metadata for the option the visitor actually picked, never the other
// options' urls/descriptions. `generalAction` is the form's own always-shown
// second call-to-action, independent of what was answered — e.g. "Join the
// Main Volunteer Group" alongside a department-specific `selectedOption`
// link.
export interface FormSubmitResponseDto {
  submissionId: string;
  nextSteps: {
    message: string | null;
    generalAction: { label: string; url: string } | null;
    selectedOption: {
      value: string;
      url: string | null;
      description: string | null;
    } | null;
  };
}

// What GET forms/public/:id and the member-facing list/fetch return —
// same shape as Form/FormField but with optionMetadata stripped from
// every field, so no option's url/description is ever visible before it's
// actually selected and submitted.
export interface PublicFormFieldDto {
  id: string;
  label: string;
  description: string | null;
  fieldType: FormFieldType;
  required: boolean;
  options: string[] | null;
  order: number;
  pageIndex: number;
  autoFillKey: FormFieldAutoFill | null;
  // Browser-level hinting only (native input min/max/minLength/maxLength
  // attributes) — the real enforcement is server-side, in
  // FormSubmissionService.validateAnswers.
  minValue: number | null;
  maxValue: number | null;
  minLength: number | null;
  maxLength: number | null;
  minSelections: number | null;
  maxSelections: number | null;
  validationRegex: string | null;
  validationMessage: string | null;
  // Evaluated client-side against the visitor's in-progress answers to
  // decide whether to render this field at all — real enforcement is
  // still server-side (FormSubmissionService.validateAnswers skips a
  // hidden field's checks entirely, so it never blocks submission).
  visibilityRule: {
    fieldId: string;
    operator: FormFieldVisibilityOperator;
    value: string;
  } | null;
}

export interface PublicFormDto {
  id: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  logoUrl: string | null;
  fields: PublicFormFieldDto[];
}
