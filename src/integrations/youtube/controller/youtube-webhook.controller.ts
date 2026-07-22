import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { YoutubeLiveDetectionService } from '../service/youtube-live-detection.service';

// Matches the <yt:videoId>...</yt:videoId> element in the Atom feed
// notification body — a regex is enough here since this is the one fixed
// field we need, and pulling in an XML parser dependency for that alone
// isn't worth it.
const VIDEO_ID_PATTERN = /<yt:videoId>([^<]+)<\/yt:videoId>/;

@Controller('integrations/youtube')
export class YoutubeWebhookController {
  constructor(
    private readonly youtubeLiveDetectionService: YoutubeLiveDetectionService,
  ) {}

  // WebSub verification handshake — the hub calls this with hub.challenge
  // whenever a subscribe/unsubscribe request is confirmed, and expects the
  // challenge echoed back verbatim.
  @Get('callback')
  @Header('Content-Type', 'text/plain')
  verifyCallback(
    @Query('hub.challenge') challenge?: string,
    @Query('hub.mode') mode?: string,
  ): string {
    if (!challenge || (mode !== 'subscribe' && mode !== 'unsubscribe')) {
      throw new NotFoundException();
    }
    return challenge;
  }

  // The actual "new video published" notification — an Atom XML body. WebSub
  // expects a fast 2xx ack regardless of what we do with it, so this never
  // throws back to the hub.
  @Post('callback')
  @HttpCode(HttpStatus.NO_CONTENT)
  handleNotification(@Req() req: RawBodyRequest<Request>): void {
    const body = req.rawBody?.toString('utf-8') ?? '';
    const videoId = VIDEO_ID_PATTERN.exec(body)?.[1] ?? null;
    this.youtubeLiveDetectionService.handleNotification(videoId);
  }
}
