import { IsEnum, IsUUID } from 'class-validator';
import { AttendanceStatusEnum } from '../enums/check-in.enum';
import { Exclude, Expose } from 'class-transformer';
import { ToDateString } from '../../utility/dto/date-converter';

export class CorrectAttendanceDto {
  @IsEnum(AttendanceStatusEnum)
  status: AttendanceStatusEnum;
}

export class AdminMarkAttendanceDto {
  @IsUUID()
  memberId: string;

  @IsUUID()
  serviceSlotId: string;

  @IsEnum(AttendanceStatusEnum)
  status: AttendanceStatusEnum;
}

@Exclude()
export class AttendanceDto {
  @Expose()
  id: string;

  @Expose()
  serviceSlotId: string;

  @Expose()
  memberId: string;

  @Expose()
  @ToDateString()
  checkinTime: Date;

  @Expose()
  status: AttendanceStatusEnum;

  @Expose()
  location: { longitude: number; latitude: number } | null;

  @Expose()
  @ToDateString()
  createdAt: Date;

  @Expose()
  @ToDateString()
  updatedAt: Date;
}
