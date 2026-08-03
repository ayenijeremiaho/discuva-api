import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';

// AnnouncementService (imported transitively via YoutubeLiveDetectionService)
// pulls in SanitizationService -> jsdom, which has ESM-only transitive deps —
// mocked here (as youtube-live-detection.service.spec.ts does) so this spec
// doesn't need jsdom just to get a DI token.
jest.mock('../../../utility/service/sanitization.service', () => ({
  SanitizationService: jest.fn().mockImplementation(() => ({
    sanitize: jest.fn((html: string) => html),
    sanitizeText: jest.fn((text: string) => text),
    sanitizeForEmail: jest.fn((html: string) => html),
  })),
}));

import { YoutubeWebhookController } from './youtube-webhook.controller';
import { YoutubeLiveDetectionService } from '../service/youtube-live-detection.service';

const SECRET = 'shh-secret';
const BODY =
  '<feed><entry><yt:videoId>vid-1</yt:videoId><yt:channelId>UC123</yt:channelId></entry></feed>';

function sign(body: string, secret: string): string {
  return `sha1=${createHmac('sha1', secret).update(body).digest('hex')}`;
}

function req(body: string) {
  return { rawBody: Buffer.from(body, 'utf-8') } as any;
}

const mockLiveDetectionService = {
  handleNotification: jest.fn(),
};

describe('YoutubeWebhookController', () => {
  let controller: YoutubeWebhookController;

  async function build(secret: string | undefined) {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [YoutubeWebhookController],
      providers: [
        {
          provide: YoutubeLiveDetectionService,
          useValue: mockLiveDetectionService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'YOUTUBE_WEBSUB_SECRET' ? secret : undefined,
            ),
          },
        },
      ],
    }).compile();
    controller = module.get(YoutubeWebhookController);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handleNotification', () => {
    it('processes the notification when the signature matches, extracting both video and channel ids', async () => {
      await build(SECRET);
      controller.handleNotification(req(BODY), sign(BODY, SECRET));
      expect(mockLiveDetectionService.handleNotification).toHaveBeenCalledWith(
        'vid-1',
        'UC123',
      );
    });

    it('rejects a notification with no signature header', async () => {
      await build(SECRET);
      controller.handleNotification(req(BODY), undefined);
      expect(
        mockLiveDetectionService.handleNotification,
      ).not.toHaveBeenCalled();
    });

    it('rejects a notification signed with the wrong secret (forged request)', async () => {
      await build(SECRET);
      controller.handleNotification(req(BODY), sign(BODY, 'wrong-secret'));
      expect(
        mockLiveDetectionService.handleNotification,
      ).not.toHaveBeenCalled();
    });

    it('rejects a signature for a tampered body', async () => {
      await build(SECRET);
      const validSignature = sign(BODY, SECRET);
      const tamperedBody = BODY.replace('vid-1', 'vid-evil');
      controller.handleNotification(req(tamperedBody), validSignature);
      expect(
        mockLiveDetectionService.handleNotification,
      ).not.toHaveBeenCalled();
    });

    it('rejects everything when no secret is configured (feature effectively off)', async () => {
      await build(undefined);
      controller.handleNotification(req(BODY), sign(BODY, SECRET));
      expect(
        mockLiveDetectionService.handleNotification,
      ).not.toHaveBeenCalled();
    });
  });

  describe('verifyCallback', () => {
    it('echoes the challenge for a valid subscribe handshake', async () => {
      await build(SECRET);
      expect(controller.verifyCallback('xyz', 'subscribe')).toBe('xyz');
    });

    it('throws when the mode is not subscribe/unsubscribe', async () => {
      await build(SECRET);
      expect(() => controller.verifyCallback('xyz', 'denied')).toThrow();
    });
  });
});
