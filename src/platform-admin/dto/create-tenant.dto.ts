import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { NormalizeEmail } from '../../utility/decorators/normalize-email.decorator';

// Deliberately its own DTO, not extending SignupDto — a platform admin
// provisioning a tenant on a church's behalf was never present to choose
// that first admin's password, unlike POST /signup's caller. Omitting
// adminPassword here (rather than making SignupDto's version optional)
// makes TenantProvisioningService.provision() generate one internally and
// email the new admin a set-password link instead (docs/MULTI_TENANT_MIGRATION.md
// §9 Phase 9e).
export class CreateTenantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  churchName: string;

  // Same format TenantMiddleware/extractSubdomain expects — reserved words
  // are rejected in the service, not here (see SignupDto for the identical
  // rule, kept duplicated rather than shared since these two DTOs no
  // longer share a base class).
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

  @IsOptional()
  @IsString()
  planId?: string;
}
