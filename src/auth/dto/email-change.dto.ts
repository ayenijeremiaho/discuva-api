import { IsEmail, IsString, Matches } from 'class-validator';
import { NormalizeEmail } from '../../utility/decorators/normalize-email.decorator';

export class RequestEmailChangeDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'Invalid email format' })
  newEmail: string;
}

export class ConfirmEmailChangeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'OTP must be exactly 6 digits' })
  otp: string;
}
