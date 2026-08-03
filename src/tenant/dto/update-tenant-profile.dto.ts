import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

// Tenant self-service counterpart to platform-admin's UpdateTenantDto
// (src/platform-admin/dto/update-tenant.dto.ts) — same fields, kept as a
// separate class rather than imported/reused so src/tenant/ doesn't take a
// dependency on src/platform-admin/. Deliberately excludes subdomain,
// schemaName, clusterId, and isActive — those are platform-controlled, not
// something a church admin can change about their own tenant.
export class UpdateTenantProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  tagline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsEmail()
  supportEmail?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  timezone?: string;
}
