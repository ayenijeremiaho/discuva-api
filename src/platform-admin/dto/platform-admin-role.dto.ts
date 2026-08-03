import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { PlatformAdminPermission } from '../enum/platform-admin-permission.enum';

export class CreatePlatformAdminRoleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @IsEnum(PlatformAdminPermission, { each: true })
  permissions: PlatformAdminPermission[];
}

export class UpdatePlatformAdminRoleDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(PlatformAdminPermission, { each: true })
  permissions?: PlatformAdminPermission[];
}
