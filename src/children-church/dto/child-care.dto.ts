import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  IsNormalizedPhone,
  NormalizePhone,
} from '../../utility/decorators/normalize-phone.decorator';
import { ChildNoteKind } from '../enums/child-note-kind.enum';

export class UpdateChildCareDto {
  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  // One entry per note; stored one per line.
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  @IsOptional()
  specialNotes?: string[];

  @IsString()
  @MaxLength(120)
  @IsOptional()
  emergencyContactName?: string | null;

  @IsString()
  @MaxLength(60)
  @IsOptional()
  emergencyContactRelationship?: string | null;

  @IsOptional()
  @NormalizePhone()
  @IsNormalizedPhone()
  emergencyContactPhone?: string | null;

  @IsString()
  @MaxLength(120)
  @IsOptional()
  doctorName?: string | null;

  @IsOptional()
  @NormalizePhone()
  @IsNormalizedPhone()
  doctorPhone?: string | null;
}

export class SetAwayDto {
  @IsUUID('4')
  collectorGuardianId: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  message?: string;
}

export class ParentReplyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  text: string;
}

export class AddCheckInNoteDto {
  @IsEnum([
    ChildNoteKind.FEEDBACK,
    ChildNoteKind.MEAL,
    ChildNoteKind.INCIDENT,
    ChildNoteKind.TEAM_ONLY,
  ])
  kind: ChildNoteKind;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  text: string;

  @IsBoolean()
  @IsOptional()
  shareWithParents?: boolean;
}

export class LinkGuardianDto {
  @IsUUID('4')
  @IsOptional()
  memberId?: string | null;
}
