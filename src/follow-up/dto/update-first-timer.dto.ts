import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

// Same as create-first-timer.dto.ts — @IsOptional() only skips
// undefined/null, not "".
const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

// source is deliberately not editable here — it's forced server-side at
// creation (ONLINE/SUNDAY_SCHOOL/APP_SIGNUP/WALK_IN) to stay
// not-spoofable, and changing it after the fact would corrupt that
// attribution. convertedAt/inviteSentAt have their own dedicated
// endpoints.
export class UpdateFirstTimerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstname?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastname?: string;

  @IsOptional()
  @IsString()
  @MinLength(7)
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEmail()
  email?: string;

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
