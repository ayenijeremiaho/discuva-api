import {
  IsArray,
  IsDateString,
  IsEnum,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SmallGroupAttendanceStatusEnum } from '../enum/small-group-attendance-status.enum';

export class AttendanceRecordEntryDto {
  @IsUUID()
  memberId: string;

  @IsEnum(SmallGroupAttendanceStatusEnum)
  status: SmallGroupAttendanceStatusEnum;
}

export class RecordAttendanceDto {
  @IsDateString()
  meetingDate: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttendanceRecordEntryDto)
  records: AttendanceRecordEntryDto[];
}
