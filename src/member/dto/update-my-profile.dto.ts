import {
  IsBoolean,
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
import {
  IsNormalizedPhone,
  NormalizePhone,
} from '../../utility/decorators/normalize-phone.decorator';

// Excludes email — changed via the OTP-gated email-change flow. Church-journey fields accept null to clear.
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
  @NormalizePhone({ clearable: true })
  @IsNormalizedPhone()
  phoneNumber?: string | null;

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

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dateJoinedChurch must be YYYY-MM-DD',
  })
  dateJoinedChurch?: string | null;

  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'yearBornAgain must be a 4-digit year' })
  yearBornAgain?: string | null;

  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'yearBaptized must be a 4-digit year' })
  yearBaptized?: string | null;

  @IsOptional()
  @IsBoolean()
  baptizedWithHolyGhost?: boolean;

  // Workers only; ignored for members without a worker profile.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  profession?: string | null;

  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'yearJoinedWorkforce must be a 4-digit year' })
  yearJoinedWorkforce?: string | null;
}
