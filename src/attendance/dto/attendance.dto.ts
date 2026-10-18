import { IsOptional, IsInt, Max, Min } from 'class-validator';
import {
  ONLINE_WINDOW_MAX_MINUTES,
  ONLINE_WINDOW_MIN_MINUTES,
} from '../util/online-window';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { AttendanceStatusEnum } from '../enums/check-in.enum';
import { Exclude, Expose } from 'class-transformer';
import { ToDateString } from '../../utility/dto/date-converter';

export class UndoCheckinDto {
  @IsString()
  @IsNotEmpty({ message: 'Give a reason for undoing this check-in.' })
  @MaxLength(500)
  reason: string;
}

export class CorrectAttendanceDto {
  @IsEnum(AttendanceStatusEnum)
  status: AttendanceStatusEnum;
}

export class UpdateEnforceDistanceCheckDto {
  @IsBoolean()
  @IsNotEmpty()
  enabled: boolean;
}

export class AdminMarkAttendanceDto {
  @IsUUID()
  memberId: string;

  @IsUUID()
  serviceSlotId: string;

  // Left out: worked out from the time, as self check-in does (a worker past the late time is LATE).
  @IsOptional()
  @IsEnum(AttendanceStatusEnum)
  status?: AttendanceStatusEnum;
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

export class UpdateOnlineWindowDto {
  @IsInt()
  @Min(ONLINE_WINDOW_MIN_MINUTES)
  @Max(ONLINE_WINDOW_MAX_MINUTES)
  minutes: number;
}
