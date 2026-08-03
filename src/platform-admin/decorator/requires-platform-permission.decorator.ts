import { SetMetadata } from '@nestjs/common';
import { PlatformAdminPermission } from '../enum/platform-admin-permission.enum';

export const REQUIRES_PLATFORM_PERMISSION_KEY = 'requires_platform_permission';

export const RequiresPlatformPermission = (
  permission: PlatformAdminPermission,
) => SetMetadata(REQUIRES_PLATFORM_PERMISSION_KEY, permission);
