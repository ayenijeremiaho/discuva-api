import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NormalizeEmail } from '../../utility/decorators/normalize-email.decorator';

export class SignupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  churchName: string;

  // Same format TenantMiddleware/extractSubdomain expects — reserved words
  // (www/api/admin/platform/app) are rejected in the service, not here,
  // since that list lives with the resolution logic it protects.
  @IsString()
  @Matches(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, {
    message: 'subdomain must be lowercase letters, numbers, and hyphens only',
  })
  subdomain: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  adminFirstname: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  adminLastname: string;

  @NormalizeEmail()
  @IsEmail({}, { message: 'Invalid email format' })
  adminEmail: string;

  @IsNotEmpty()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @Matches(/[A-Z]/, {
    message: 'Password must contain at least one uppercase letter',
  })
  @Matches(/\d/, { message: 'Password must contain at least one number' })
  @Matches(/[@$!%*?&]/, {
    message: 'Password must contain at least one special character',
  })
  adminPassword: string;
}
