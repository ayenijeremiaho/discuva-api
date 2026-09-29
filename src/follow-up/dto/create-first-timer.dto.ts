import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { FirstTimerSourceEnum } from '../enums/follow-up.enum';
import {
  IsNormalizedPhone,
  NormalizePhone,
} from '../../utility/decorators/normalize-phone.decorator';

// @IsOptional() only skips undefined/null, not "" — a picker cleared back to
// its empty state sends "" over the wire, which would otherwise fail
// @IsUUID().
const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

export class CreateFirstTimerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstname: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastname: string;

  @NormalizePhone()
  @IsNormalizedPhone()
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(FirstTimerSourceEnum)
  source?: FirstTimerSourceEnum;

  @IsOptional()
  @IsBoolean()
  wantsToJoinChurch?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  enjoyedAboutChurch?: string;

  @IsOptional()
  @IsBoolean()
  wantsToJoinWorkforce?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  visitedEventId?: string;
}
