import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AttendanceStatusEnum } from '../enums/check-in.enum';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';

export class AttendanceHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsEnum(AttendanceStatusEnum)
  status?: AttendanceStatusEnum;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class AdminAttendanceHistoryQueryDto extends AttendanceHistoryQueryDto {
  @IsOptional()
  @IsUUID()
  memberId?: string;

  @IsOptional()
  @IsUUID()
  slotId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  // Filters on the role snapshotted at check-in time (Attendance.
  // roleAtCheckin), not the member's current role — a worker who was
  // later demoted still shows under "Worker" for a check-in they made
  // while a worker, matching how the record was actually captured.
  @IsOptional()
  @IsEnum(MemberRoleEnum)
  role?: MemberRoleEnum;
}
