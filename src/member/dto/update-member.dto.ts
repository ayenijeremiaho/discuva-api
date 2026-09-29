import {
  IsBoolean,
  IsEmail,
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
import { NormalizeEmail } from '../../utility/decorators/normalize-email.decorator';
import {
  IsNormalizedPhone,
  NormalizePhone,
} from '../../utility/decorators/normalize-phone.decorator';

export class UpdateMemberDto {
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
  @NormalizeEmail()
  @IsEmail()
  email?: string;

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
  @Matches(/^\d{4}$/, { message: 'yearBornAgain must be a 4-digit year' })
  yearBornAgain?: string;

  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'yearBaptized must be a 4-digit year' })
  yearBaptized?: string;

  @IsOptional()
  @IsBoolean()
  baptizedWithHolyGhost?: boolean;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dateJoinedChurch must be YYYY-MM-DD',
  })
  dateJoinedChurch?: string;
}
