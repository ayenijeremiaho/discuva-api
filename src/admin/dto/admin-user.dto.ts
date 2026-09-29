import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class GrantAdminDto {
  @IsUUID()
  @IsNotEmpty()
  memberId: string;

  @IsUUID()
  @IsNotEmpty()
  adminRoleId: string;
}

export class UpdateAdminUserDto {
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
