import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  FIELD_TYPES_REQUIRING_OPTIONS,
  FormFieldAutoFill,
  FormFieldType,
  FormVisibility,
} from '../enum/form.enum';

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
  autoFillKey: FormFieldAutoFill | null;
}

export interface PublicFormDto {
  id: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  logoUrl: string | null;
  fields: PublicFormFieldDto[];
}
