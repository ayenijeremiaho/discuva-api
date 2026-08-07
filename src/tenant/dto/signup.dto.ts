import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { NormalizeEmail } from '../../utility/decorators/normalize-email.decorator';

// No password field, deliberately — the first admin never types a password
// at signup. TenantProvisioningService generates one internally and emails
// a set-password link once provisioning completes (the same mechanism
// PlatformTenantService.createTenant already used), which doubles as email
// verification: nobody can ever log in without proving control of the
// inbox behind adminEmail. A password field here would let anyone submit
// an email they don't own.
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

  // Present only when this signup is completing a branch invite
  // (docs/MULTI_TENANT_MIGRATION.md §11.1) — the code emailed to the
  // invited church by BranchInviteService.createInvite. Omitted entirely
  // for a normal, non-branch signup.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  branchInviteToken?: string;
}
