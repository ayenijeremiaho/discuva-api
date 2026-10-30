import { IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';

export class TwoFactorLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  challengeToken: string;

  // A 6-digit app code or a backup code.
  @IsString()
  @Length(6, 24)
  code: string;
}

export class TwoFactorPasswordDto {
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class TwoFactorCodeDto {
  @IsString()
  @Length(6, 24)
  code: string;
}

export class TwoFactorConfirmDto extends TwoFactorCodeDto {
  @IsString()
  @IsNotEmpty()
  password: string;
}
