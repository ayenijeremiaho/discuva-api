import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class PlatformAdminRefreshJwtAuthGuard extends AuthGuard(
  'platform-admin-refresh-jwt',
) {}
