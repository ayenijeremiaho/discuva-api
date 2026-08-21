import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TransactionHost } from '@nestjs-cls/transactional';
import { ClsService } from 'nestjs-cls';
import { SocialOAuthConnectService } from './social-oauth-connect.service';
import { SocialAccount } from '../entity/social-account.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { SocialPlatform } from '../enum/social-media.enum';
import { PlatformSocialAppService } from '../../platform-admin/service/platform-social-app.service';
import { OAuthStateService } from '../oauth/oauth-state.service';
import { SocialOAuthExchangerRegistry } from '../oauth/social-oauth-exchanger-registry.service';
import { EncryptionService } from '../../utility/service/encryption.service';

jest.mock('../../tenant/utility/run-in-tenant-context', () => ({
  runInTenantContext: jest.fn((cls, txHost, envelope, fn) => fn()),
}));

const mockAccountRepo = {
  findOneBy: jest.fn(),
  findOneByOrFail: jest.fn(),
  save: jest.fn(),
};
const mockTenantRepo = { findOneByOrFail: jest.fn() };
const mockPlatformSocialAppService = { getDecryptedApp: jest.fn() };
const mockOAuthStateService = { encode: jest.fn(), decode: jest.fn() };
const mockExchanger = { buildAuthorizeUrl: jest.fn(), exchangeCode: jest.fn() };
const mockExchangerRegistry = { resolve: jest.fn(() => mockExchanger) };
const mockEncryptionService = { encrypt: jest.fn((v) => `enc(${v})`) };
const mockConfigService = {
  get: jest.fn().mockReturnValue('https://admin.discuva.app'),
};
const mockCls = { get: jest.fn().mockReturnValue('tenant-1') };
const mockTxHost = {};

describe('SocialOAuthConnectService', () => {
  let service: SocialOAuthConnectService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockExchangerRegistry.resolve.mockReturnValue(mockExchanger);
    mockCls.get.mockReturnValue('tenant-1');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialOAuthConnectService,
        {
          provide: getRepositoryToken(SocialAccount),
          useValue: mockAccountRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        {
          provide: PlatformSocialAppService,
          useValue: mockPlatformSocialAppService,
        },
        { provide: OAuthStateService, useValue: mockOAuthStateService },
        {
          provide: SocialOAuthExchangerRegistry,
          useValue: mockExchangerRegistry,
        },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
      ],
    }).compile();
    service = module.get(SocialOAuthConnectService);
  });

  describe('getAuthorizeUrl', () => {
    it('throws NotFoundException when the account does not exist', async () => {
      mockAccountRepo.findOneBy.mockResolvedValue(null);
      await expect(service.getAuthorizeUrl('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when the platform app is not registered or inactive', async () => {
      mockAccountRepo.findOneBy.mockResolvedValue({
        id: 'acc-1',
        platform: SocialPlatform.FACEBOOK,
      });
      mockPlatformSocialAppService.getDecryptedApp.mockResolvedValue(null);
      await expect(service.getAuthorizeUrl('acc-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('encodes state with the account id and the CLS tenantId, then builds the authorize URL', async () => {
      mockAccountRepo.findOneBy.mockResolvedValue({
        id: 'acc-1',
        platform: SocialPlatform.FACEBOOK,
      });
      mockPlatformSocialAppService.getDecryptedApp.mockResolvedValue({
        app: { platform: SocialPlatform.FACEBOOK, isActive: true },
        clientSecret: 'secret',
      });
      mockOAuthStateService.encode.mockReturnValue('encoded-state');
      mockExchanger.buildAuthorizeUrl.mockReturnValue(
        'https://meta.example/authorize',
      );

      const url = await service.getAuthorizeUrl('acc-1');

      expect(mockOAuthStateService.encode).toHaveBeenCalledWith(
        'acc-1',
        'tenant-1',
      );
      expect(mockExchanger.buildAuthorizeUrl).toHaveBeenCalledWith(
        { platform: SocialPlatform.FACEBOOK, isActive: true },
        'encoded-state',
      );
      expect(url).toBe('https://meta.example/authorize');
    });
  });

  describe('handleCallback', () => {
    it('redirects with error=platform-disabled without attempting an exchange when the app is inactive', async () => {
      mockOAuthStateService.decode.mockReturnValue({
        accountId: 'acc-1',
        tenantId: 'tenant-1',
      });
      mockPlatformSocialAppService.getDecryptedApp.mockResolvedValue({
        app: { isActive: false },
        clientSecret: 'secret',
      });

      const url = await service.handleCallback(
        SocialPlatform.FACEBOOK,
        'code',
        'state',
      );

      expect(mockExchanger.exchangeCode).not.toHaveBeenCalled();
      expect(url).toContain('error=platform-disabled');
    });

    it('exchanges the code, persists encrypted tokens onto the matching account, and redirects with connected=<platform>', async () => {
      mockOAuthStateService.decode.mockReturnValue({
        accountId: 'acc-1',
        tenantId: 'tenant-1',
      });
      mockPlatformSocialAppService.getDecryptedApp.mockResolvedValue({
        app: { platform: SocialPlatform.YOUTUBE, isActive: true },
        clientSecret: 'app-secret',
      });
      mockExchanger.exchangeCode.mockResolvedValue({
        accessToken: 'raw-access-token',
        refreshToken: 'raw-refresh-token',
        expiresInSeconds: 3600,
        scope: 'upload',
        externalAccountId: 'channel-123',
      });
      mockTenantRepo.findOneByOrFail.mockResolvedValue({
        id: 'tenant-1',
        schemaName: 'tenant_1',
      });
      const account = {
        id: 'acc-1',
        platform: SocialPlatform.YOUTUBE,
        isConnected: false,
      };
      mockAccountRepo.findOneByOrFail.mockResolvedValue(account);
      mockAccountRepo.save.mockImplementation((a) => Promise.resolve(a));

      const url = await service.handleCallback(
        SocialPlatform.YOUTUBE,
        'auth-code',
        'state-token',
      );

      expect(mockExchanger.exchangeCode).toHaveBeenCalledWith(
        'auth-code',
        { platform: SocialPlatform.YOUTUBE, isActive: true },
        'app-secret',
      );
      expect(mockAccountRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          accessTokenEncrypted: 'enc(raw-access-token)',
          refreshTokenEncrypted: 'enc(raw-refresh-token)',
          scope: 'upload',
          externalAccountId: 'channel-123',
          isConnected: true,
        }),
      );
      expect(url).toContain('connected=YOUTUBE');
    });

    it('redirects with error=connection-failed and never throws when the exchange itself fails', async () => {
      mockOAuthStateService.decode.mockReturnValue({
        accountId: 'acc-1',
        tenantId: 'tenant-1',
      });
      mockPlatformSocialAppService.getDecryptedApp.mockResolvedValue({
        app: { platform: SocialPlatform.X, isActive: true },
        clientSecret: 'app-secret',
      });
      mockExchanger.exchangeCode.mockRejectedValue(new Error('bad code'));

      const url = await service.handleCallback(
        SocialPlatform.X,
        'auth-code',
        'state-token',
      );

      expect(url).toContain('error=connection-failed');
    });

    it('redirects with error=connection-failed on a tampered/undecodable state', async () => {
      mockOAuthStateService.decode.mockImplementation(() => {
        throw new Error('bad state');
      });

      const url = await service.handleCallback(
        SocialPlatform.FACEBOOK,
        'auth-code',
        'garbage-state',
      );

      expect(url).toContain('error=connection-failed');
    });
  });
});
