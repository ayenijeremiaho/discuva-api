import { createHmac } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetaDataDeletionService } from './meta-data-deletion.service';
import { SocialDataDeletionRequest } from '../entity/social-data-deletion-request.entity';
import { SocialPlatform } from '../enum/social-media.enum';
import { PlatformSocialAppService } from '../../platform-admin/service/platform-social-app.service';

const FACEBOOK_SECRET = 'facebook-app-secret';
const INSTAGRAM_SECRET = 'instagram-app-secret';

function buildSignedRequest(payload: object, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url',
  );
  const sig = createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
  return `${sig}.${encodedPayload}`;
}

const mockRequestRepo = {
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve(v)),
  findOne: jest.fn(),
};

const mockPlatformSocialAppService = {
  getDecryptedApp: jest.fn(),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue(undefined),
};

describe('MetaDataDeletionService', () => {
  let service: MetaDataDeletionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockReturnValue(undefined);
    mockPlatformSocialAppService.getDecryptedApp.mockImplementation(
      (platform: SocialPlatform) => {
        if (platform === SocialPlatform.FACEBOOK) {
          return Promise.resolve({
            app: { platform },
            clientSecret: FACEBOOK_SECRET,
          });
        }
        if (platform === SocialPlatform.INSTAGRAM) {
          return Promise.resolve({
            app: { platform },
            clientSecret: INSTAGRAM_SECRET,
          });
        }
        return Promise.resolve(null);
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetaDataDeletionService,
        {
          provide: getRepositoryToken(SocialDataDeletionRequest),
          useValue: mockRequestRepo,
        },
        {
          provide: PlatformSocialAppService,
          useValue: mockPlatformSocialAppService,
        },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(MetaDataDeletionService);
  });

  describe('verifySignedRequest', () => {
    it('verifies a genuinely Facebook-signed request and extracts the user id', async () => {
      const signedRequest = buildSignedRequest(
        { algorithm: 'HMAC-SHA256', issued_at: 1, user_id: 'fb-user-1' },
        FACEBOOK_SECRET,
      );

      const result = await service.verifySignedRequest(signedRequest);

      expect(result).toEqual({
        userId: 'fb-user-1',
        platform: SocialPlatform.FACEBOOK,
      });
    });

    it('verifies against the Instagram app secret when Facebook does not match', async () => {
      const signedRequest = buildSignedRequest(
        { algorithm: 'HMAC-SHA256', issued_at: 1, user_id: 'ig-user-1' },
        INSTAGRAM_SECRET,
      );

      const result = await service.verifySignedRequest(signedRequest);

      expect(result).toEqual({
        userId: 'ig-user-1',
        platform: SocialPlatform.INSTAGRAM,
      });
    });

    it('rejects a request signed with an unregistered secret', async () => {
      const signedRequest = buildSignedRequest(
        { algorithm: 'HMAC-SHA256', issued_at: 1, user_id: 'fb-user-1' },
        'some-attacker-controlled-secret',
      );

      await expect(service.verifySignedRequest(signedRequest)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a malformed signed_request with no "." separator', async () => {
      await expect(
        service.verifySignedRequest('not-a-real-signed-request'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when neither Meta platform has a registered app', async () => {
      mockPlatformSocialAppService.getDecryptedApp.mockResolvedValue(null);
      const signedRequest = buildSignedRequest(
        { algorithm: 'HMAC-SHA256', issued_at: 1, user_id: 'fb-user-1' },
        FACEBOOK_SECRET,
      );

      await expect(service.verifySignedRequest(signedRequest)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a validly-signed payload using an unsupported algorithm', async () => {
      const signedRequest = buildSignedRequest(
        { algorithm: 'RSA-SHA1', issued_at: 1, user_id: 'fb-user-1' },
        FACEBOOK_SECRET,
      );

      await expect(service.verifySignedRequest(signedRequest)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('recordRequest', () => {
    it('saves a row and builds a status URL from the configured base when set', async () => {
      mockConfigService.get.mockReturnValue('https://api.discuva.org');

      const result = await service.recordRequest(
        'fb-user-1',
        SocialPlatform.FACEBOOK,
        'https://fallback-host.example',
      );

      expect(mockRequestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: SocialPlatform.FACEBOOK,
          platformUserId: 'fb-user-1',
          confirmationCode: result.confirmationCode,
        }),
      );
      expect(result.statusUrl).toBe(
        `https://api.discuva.org/v1/integrations/social/meta/data-deletion/status/${result.confirmationCode}`,
      );
    });

    it('falls back to the request host when no base URL is configured', async () => {
      mockConfigService.get.mockReturnValue(undefined);

      const result = await service.recordRequest(
        'fb-user-1',
        SocialPlatform.FACEBOOK,
        'https://fallback-host.example',
      );

      expect(result.statusUrl).toBe(
        `https://fallback-host.example/v1/integrations/social/meta/data-deletion/status/${result.confirmationCode}`,
      );
    });

    it('generates a different confirmation code on each call', async () => {
      const a = await service.recordRequest(
        'fb-user-1',
        SocialPlatform.FACEBOOK,
        'https://host.example',
      );
      const b = await service.recordRequest(
        'fb-user-1',
        SocialPlatform.FACEBOOK,
        'https://host.example',
      );
      expect(a.confirmationCode).not.toBe(b.confirmationCode);
    });
  });

  describe('getStatus', () => {
    it('returns the matching row for a known confirmation code', async () => {
      const row = { confirmationCode: 'abc-123' };
      mockRequestRepo.findOne.mockResolvedValue(row);

      const result = await service.getStatus('abc-123');

      expect(mockRequestRepo.findOne).toHaveBeenCalledWith({
        where: { confirmationCode: 'abc-123' },
      });
      expect(result).toBe(row);
    });

    it('returns null for an unknown confirmation code', async () => {
      mockRequestRepo.findOne.mockResolvedValue(null);
      const result = await service.getStatus('does-not-exist');
      expect(result).toBeNull();
    });
  });
});
