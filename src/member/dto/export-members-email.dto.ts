import { MEMBER_EXPORT_FIELD_KEYS } from '../utility/member-csv';
import {
  IsBoolean,
  IsArray,
  IsIn,
  ArrayMaxSize,
  ArrayUnique,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { MemberRoleEnum } from '../enums/member-role.enum';
import { MemberStatusEnum } from '../enums/member-status.enum';
import { WorkerStatusEnum } from '../enums/worker-status.enum';

class ExportPeopleEmailDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @ArrayUnique()
  @IsIn(MEMBER_EXPORT_FIELD_KEYS, { each: true })
  fields?: string[];

  @IsOptional()
  @IsEmail()
  recipientEmail?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class ExportMembersEmailDto extends ExportPeopleEmailDto {
  @IsOptional()
  @IsEnum(MemberRoleEnum)
  role?: MemberRoleEnum;

  @IsOptional()
  @IsEnum(MemberStatusEnum)
  status?: MemberStatusEnum;

  @IsOptional()
  @IsBoolean()
  wantsToServe?: boolean;
}

export class ExportWorkersEmailDto extends ExportPeopleEmailDto {
  @IsOptional()
  @IsEnum(WorkerStatusEnum)
  status?: WorkerStatusEnum;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsBoolean()
  isTrainee?: boolean;
}
