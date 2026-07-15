import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateAccessGrantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  // When a non-revoked grant for this name already exists, the request is
  // rejected with 409 unless the caller explicitly confirms the replace.
  @IsOptional()
  @IsBoolean()
  replaceExisting?: boolean;
}
