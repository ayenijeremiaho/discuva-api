import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsUUID,
} from 'class-validator';

// No password field — nobody onboarding a new platform admin is that
// admin, so there's nobody present to choose one (same reasoning as
// CreateTenantDto). PlatformAdminManagementService.create() generates a
// random password internally and emails a set-password link instead.
export class CreatePlatformAdminDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsUUID()
  platformAdminRoleId: string;
}

export class UpdatePlatformAdminDto {
  @IsOptional()
  @IsUUID()
  platformAdminRoleId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
