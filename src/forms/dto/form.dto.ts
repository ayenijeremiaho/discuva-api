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
