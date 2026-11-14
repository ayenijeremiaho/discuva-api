import {
  ArrayMaxSize,
  ArrayUnique,
  IsEnum,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  ValidateIf,
  Matches,
  MaxLength,
} from 'class-validator';

import { AdminPermission } from '../enum/admin-permission.enum';

class AdditionalPermissionsDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(Object.values(AdminPermission).length)
  @IsEnum(AdminPermission, { each: true })
  additionalPermissions?: AdminPermission[];
}

export class GrantAdminDto extends AdditionalPermissionsDto {
  @IsUUID()
  @IsNotEmpty()
  memberId: string;

  @IsUUID()
  @IsNotEmpty()
  adminRoleId: string;
}

export class UpdateAdminUserDto extends AdditionalPermissionsDto {
  @IsUUID()
  @IsOptional()
  adminRoleId?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export const MAX_FAVOURITE_PAGES = 12;

export class UpdateFavouritePagesDto {
  @IsArray()
  @ArrayMaxSize(MAX_FAVOURITE_PAGES)
  @MaxLength(100, { each: true })
  @Matches(/^\/[a-z0-9\-/]*$/, {
    each: true,
    message: 'each page must be an admin-portal path like /members',
  })
  pages: string[];
}
