import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { PlatformAdminAuth } from '../interface/platform-admin-auth.interface';

export const CurrentPlatformAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PlatformAdminAuth => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
