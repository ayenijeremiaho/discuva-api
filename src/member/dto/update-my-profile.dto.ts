import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { GenderEnum } from '../enums/gender.enum';
import { MaritalStatusEnum } from '../enums/marital-status.enum';

// Deliberately excludes email (handled via the OTP-gated email-change flow)
// and church-record fields (dateJoinedChurch, yearBornAgain, yearBaptized,
// baptizedWithHolyGhost) — those stay admin-managed.
export class UpdateMyProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  firstname?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  lastname?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?\d{7,20}$/, {
    message: 'phoneNumber must be 7–20 digits, optionally prefixed with +',
  })
  @MaxLength(20)
  phoneNumber?: string;

  @IsOptional()
  @IsEnum(GenderEnum)
  gender?: GenderEnum;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  birthDay?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  birthMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  birthYear?: number;

  @IsOptional()
  @IsEnum(MaritalStatusEnum)
  maritalStatus?: MaritalStatusEnum;
}
