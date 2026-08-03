import {
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Post,
  Query,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { Public } from '../../../auth/decorator/public.decorator';
import { YoutubeLiveDetectionService } from '../service/youtube-live-detection.service';

// Matches the <yt:videoId>...</yt:videoId> and <yt:channelId>...</yt:channelId>
// elements in the Atom feed notification body — regexes are enough here
// since these are the two fixed fields we need (channelId is what makes a
// notification tenant-resolvable at all, see YoutubeLiveDetectionService),
// and pulling in an XML parser dependency for just two fields isn't worth it.
const VIDEO_ID_PATTERN = /<yt:videoId>([^<]+)<\/yt:videoId>/;
const CHANNEL_ID_PATTERN = /<yt:channelId>([^<]+)<\/yt:channelId>/;

@Controller('integrations/youtube')
export class YoutubeWebhookController {
  private readonly logger = new Logger(YoutubeWebhookController.name);

  constructor(
    private readonly youtubeLiveDetectionService: YoutubeLiveDetectionService,
    private readonly configService: ConfigService,
  ) {}

  // WebSub verification handshake — the hub calls this with hub.challenge
  // whenever a subscribe/unsubscribe request is confirmed, and expects the
  // challenge echoed back verbatim.
  @Public()
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
  // throws back to the hub. Signature-verified when a secret is configured
  // (see YoutubeSubscriptionService.subscribe, which registers the same
  // secret as hub.secret) — otherwise this endpoint would accept a forged
  // POST from anyone who discovers the public callback URL and trigger a
  // fake "we're live" push to every member.
  @Public()
  @Post('callback')
  @HttpCode(HttpStatus.NO_CONTENT)
  handleNotification(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature') signature?: string,
  ): void {
    const body = req.rawBody?.toString('utf-8') ?? '';
    if (!this.isSignatureValid(body, signature)) {
      this.logger.warn(
        'Rejected YouTube WebSub notification with invalid or missing signature',
      );
      return;
    }
    const videoId = VIDEO_ID_PATTERN.exec(body)?.[1] ?? null;
    const channelId = CHANNEL_ID_PATTERN.exec(body)?.[1] ?? null;
    this.youtubeLiveDetectionService.handleNotification(videoId, channelId);
  }

  private isSignatureValid(body: string, signatureHeader?: string): boolean {
    const secret = this.configService.get<string>('YOUTUBE_WEBSUB_SECRET');
    if (!secret) return false;

    const [algo, receivedHex] = (signatureHeader ?? '').split('=');
    if (algo !== 'sha1' || !receivedHex) return false;

    const expectedHex = createHmac('sha1', secret).update(body).digest('hex');
    const expected = Buffer.from(expectedHex, 'hex');
    const received = Buffer.from(receivedHex, 'hex');
    if (expected.length !== received.length) return false;
    return timingSafeEqual(expected, received);
  }
}
