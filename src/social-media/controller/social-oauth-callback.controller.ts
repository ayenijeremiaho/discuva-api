import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../../auth/decorator/public.decorator';
import { SocialPlatform } from '../enum/social-media.enum';
import { SocialOAuthConnectService } from '../service/social-oauth-connect.service';

// Called directly by Meta/Google/X's redirect — no Host header carrying a
// tenant subdomain (this is a browser redirect, not an authenticated app
// request), so `state` (decoded in SocialOAuthConnectService) is the only
// way to know which tenant/account this is for. Excluded from
// TenantMiddleware entirely (see src/tenant/tenant.module.ts exclude list —
// same reasoning as webhooks/giving/:tenantId and the YouTube WebSub
// callback: forgetting the exclude means this silently 404s in production).
@Controller('integrations/social')
export class SocialOAuthCallbackController {
  constructor(
    private readonly oauthConnectService: SocialOAuthConnectService,
  ) {}

  @Public()
  @Get(':platform/oauth/callback')
  async handleCallback(
    @Param('platform') platform: SocialPlatform,
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ): Promise<void> {
    const redirectUrl = await this.oauthConnectService.handleCallback(
      platform,
      code,
      state,
    );
    res.redirect(redirectUrl);
  }
}
