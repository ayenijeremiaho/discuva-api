import { IsEmail, IsString, Matches, MinLength } from 'class-validator';
import { NormalizeEmail } from '../../utility/decorators/normalize-email.decorator';

// Mirrors auth/dto/forgot-password.dto.ts + reset-password.dto.ts exactly —
// kept as its own pair rather than reused directly, consistent with
// PlatformAdminPermission staying disjoint from AdminPermission even where
// the shape looks identical (§4.10's two identity systems never share
// validation surface, so one can change independently of the other).
export class PlatformAdminForgotPasswordDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;
}

export class PlatformAdminResetPasswordDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'OTP must be exactly 6 digits' })
  otp: string;

  @IsString()
  @MinLength(8, { message: 'New password must be at least 8 characters long' })
  @Matches(/[A-Z]/, {
    message: 'New password must contain at least one uppercase letter',
  })
  @Matches(/\d/, { message: 'New password must contain at least one number' })
  @Matches(/[@$!%*?&]/, {
    message:
      'New password must contain at least one special character (@$!%*?&)',
  })
  newPassword: string;
}
