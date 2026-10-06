import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ConvertStatusEnum } from '../enum/convert-status.enum';
import {
  IsNormalizedPhone,
  NormalizePhone,
} from '../../utility/decorators/normalize-phone.decorator';

export const CONVERT_STAGES = ['open', 'with_follow_up', 'joined'] as const;
export type ConvertStageFilter = (typeof CONVERT_STAGES)[number];

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true';

export class CreateConvertDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @NormalizePhone()
  @IsNormalizedPhone()
  phone?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(ConvertStatusEnum)
  status?: ConvertStatusEnum;

  @IsOptional()
  @IsUUID()
  outreachId?: string;

  @IsOptional()
  @IsBoolean()
  allowDuplicate?: boolean;
}

export class LogFollowUpDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateConvertStatusDto {
  @IsEnum(ConvertStatusEnum)
  status: ConvertStatusEnum;
}

export class ReassignConvertDto {
  @IsUUID()
  workerProfileId: string;
}

export class BulkReassignConvertsDto {
  @IsUUID()
  toWorkerProfileId: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  convertIds?: string[];

  @IsOptional()
  @IsUUID()
  fromWorkerProfileId?: string;
}

export class LinkConvertToMemberDto {
  @IsUUID()
  memberId: string;
}

export class MoveConvertOutreachDto {
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  outreachId: string | null;
}

export class CreateOutreachDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  date?: string;

  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  teamMemberIds: string[];
}

export class UpdateOutreachTeamDto {
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  teamMemberIds: string[];
}

export class UpdateEvangelismSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  overdueDays?: number;

  @IsOptional()
  @IsBoolean()
  autoAssign?: boolean;
}

export const CONVERT_SCOPES = ['mine', 'team'] as const;
export type ConvertScope = (typeof CONVERT_SCOPES)[number];

export class ConvertListQueryDto {
  @IsOptional()
  @IsEnum(ConvertStatusEnum)
  status?: ConvertStatusEnum;

  // workerProfileId, 'unassigned', or 'me' (member routes only).
  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  overdue?: boolean;

  @IsOptional()
  @IsUUID()
  outreachId?: string;

  // open = still Evangelism's; with_follow_up = visited church, Follow-Up owns it; joined = now a member.
  @IsOptional()
  @IsIn(CONVERT_STAGES)
  stage?: ConvertStageFilter;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class MemberConvertListQueryDto extends ConvertListQueryDto {
  @IsOptional()
  @IsIn(CONVERT_SCOPES)
  scope?: ConvertScope;
}

export class ReportRangeQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

export const EXPORT_TYPES = ['converts', 'workers', 'outreaches'] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];

export class ExportQueryDto extends ConvertListQueryDto {
  @IsIn(EXPORT_TYPES)
  type: ExportType;
}
