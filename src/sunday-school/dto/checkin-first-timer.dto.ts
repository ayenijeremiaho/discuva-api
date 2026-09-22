import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Deliberately slimmer than CreateFirstTimerDto — a teacher checking someone
// in mid-class has name and phone, not the fuller front-desk intake fields
// (source is forced server-side, wantsToJoinChurch/enjoyedAboutChurch/etc.
// aren't asked here). SundaySchoolService maps this onto CreateFirstTimerDto
// before calling FollowUpService.
export class CheckInFirstTimerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstname: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastname: string;

  @IsString()
  @MinLength(7)
  @MaxLength(20)
  phone: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
