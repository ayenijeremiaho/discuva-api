import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { AttendanceStatusEnum } from '../enums/check-in.enum';

export class ExportAttendanceEmailDto {
  @IsEmail()
  @IsOptional()
  recipientEmail?: string;

  @IsUUID()
  @IsOptional()
  memberId?: string;

  @IsUUID()
  @IsOptional()
  slotId?: string;

  @IsEnum(AttendanceStatusEnum)
  @IsOptional()
  status?: AttendanceStatusEnum;

  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;

  @IsString()
  @IsOptional()
  search?: string;
}
