import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { PrayerRequestStatusEnum } from '../enum/prayer-request-status.enum';
import { PregnancyCaseStatusEnum } from '../enum/pregnancy-case-status.enum';

export class SubmitPrayerRequestDto {
  @IsNotEmpty()
  @IsString()
  content: string;
}

export class SubmitTestimonyDto {
  @IsNotEmpty()
  @IsString()
  content: string;

  @IsOptional()
  @IsUUID()
  prayerRequestId?: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

export class UpdatePrayerRequestStatusDto {
  @IsEnum(PrayerRequestStatusEnum)
  status: PrayerRequestStatusEnum;
}

export class CreatePregnancyCaseDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsDateString()
  edd: string;

  @IsOptional()
  @IsString()
  details?: string;

  @IsOptional()
  @IsUUID()
  memberId?: string;
}

export class LogPregnancyVisitDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdatePregnancyCaseStatusDto {
  @IsEnum(PregnancyCaseStatusEnum)
  status: PregnancyCaseStatusEnum;
}
