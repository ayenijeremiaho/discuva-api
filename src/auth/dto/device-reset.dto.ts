import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { NormalizeEmail } from '../../utility/decorators/normalize-email.decorator';

export class RequestDeviceResetDto {
  @NormalizeEmail()
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  newDeviceId: string;
}

export class VerifyDeviceResetDto {
  @NormalizeEmail()
  @IsEmail()
  email: string;

  @IsString()
  otp: string;

  // The device that asked for the code. Optional so older app versions keep working.
  @IsOptional()
  @IsString()
  @MinLength(8)
  deviceId?: string;
}
