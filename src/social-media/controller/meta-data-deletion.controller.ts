import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Public } from '../../auth/decorator/public.decorator';
import { MetaDataDeletionService } from '../service/meta-data-deletion.service';

// Called directly by Meta when a user removes/deauthorizes the app from
// their Facebook settings — no Host header carrying a tenant subdomain
// (same reasoning as SocialOAuthCallbackController), and no admin session
// either. Registered as the "Data Deletion Request URL" in the Meta App
// dashboard's Advanced settings.
@Controller('integrations/social/meta')
export class MetaDataDeletionController {
  constructor(private readonly deletionService: MetaDataDeletionService) {}

  // Meta POSTs application/x-www-form-urlencoded with a single
  // `signed_request` field — not JSON. Must respond with exactly
  // {url, confirmation_code}; anything else is treated as a failed
  // integration by Meta's own validator.
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('data-deletion')
  async handleDataDeletion(
    @Body('signed_request') signedRequest: string,
    @Req() req: Request,
  ) {
    if (!signedRequest) {
      throw new BadRequestException('Missing signed_request.');
    }
    const { userId, platform } =
      await this.deletionService.verifySignedRequest(signedRequest);

    const requestHost = `${req.protocol}://${req.get('host')}`;
    const { confirmationCode, statusUrl } =
      await this.deletionService.recordRequest(userId, platform, requestHost);

    return { url: statusUrl, confirmation_code: confirmationCode };
  }

  // The human-readable status page Meta's response contract requires a
  // user be able to reach — plain HTML, not JSON, since a person may
  // actually open this link.
  @Public()
  @Get('data-deletion/status/:code')
  async getStatus(@Param('code') code: string, @Res() res: Response) {
    const request = await this.deletionService.getStatus(code);
    if (!request) {
      throw new NotFoundException('Unknown confirmation code.');
    }

    res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Data Deletion Status</title></head>
<body style="font-family: sans-serif; max-width: 640px; margin: 60px auto; padding: 0 20px; color: #121212;">
<h2>Data Deletion Request — Completed</h2>
<p>Confirmation code: <code>${request.confirmationCode}</code></p>
<p>Discuva does not store any personal data associated with your Facebook
account beyond what is necessary to operate a church's connected Page —
your individual Facebook user identity is not retained in our systems.
This request has been recorded and requires no further action.</p>
</body></html>`);
  }
}
