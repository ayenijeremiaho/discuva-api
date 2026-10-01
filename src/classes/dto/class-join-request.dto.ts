import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateClassJoinRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

export class DeclineClassJoinRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
