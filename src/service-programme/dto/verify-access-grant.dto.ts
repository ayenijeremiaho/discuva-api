import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class VerifyAccessGrantDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'pin must be a 6-digit code' })
  pin: string;
}
