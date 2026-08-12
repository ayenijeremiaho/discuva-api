import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as simpleWebAuthnServer from '@simplewebauthn/server';
import { WebauthnService } from './webauthn.service';
import { MemberWebauthnCredential } from '../../member/entity/member-webauthn-credential.entity';
import { MemberService } from '../../member/service/member.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

jest.mock('@simplewebauthn/server');

const mockCredentialRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((v) => v),
  save: jest.fn((v) => v),
  delete: jest.fn(),
};
const mockTenantRepo = { findOne: jest.fn() };
const mockMemberService = { getById: jest.fn() };
const mockConfigService = { get: jest.fn() };
const mockCacheService = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  key: (ns: string, id: string) => `${ns}:${id}`,
};
const mockAuditLogService = { log: jest.fn() };
const mockCls = { get: jest.fn() };

describe('WebauthnService', () => {
  let service: WebauthnService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'APP_BASE_DOMAIN') return 'discuva.org';
      if (key === 'PRODUCT_NAME') return 'Discuva';
      return undefined;
    });
    mockCls.get.mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebauthnService,
        {
          provide: getRepositoryToken(MemberWebauthnCredential),
          useValue: mockCredentialRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: MemberService, useValue: mockMemberService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: ClsService, useValue: mockCls },
      ],
    }).compile();
    service = module.get(WebauthnService);
  });

  describe('generateRegistrationOptions', () => {
    it('excludes already-registered credentials and requires a resident, verified key', async () => {
      mockMemberService.getById.mockResolvedValue({
        id: 'member-1',
        email: 'a@b.com',
      });
      mockCredentialRepo.find.mockResolvedValue([
        { credentialId: 'existing-cred', transports: ['internal'] },
      ]);
      (
        simpleWebAuthnServer.generateRegistrationOptions as jest.Mock
      ).mockResolvedValue({ challenge: 'chal-1' });

      const result = await service.generateRegistrationOptions('member-1');

      expect(result).toEqual({ challenge: 'chal-1' });
      expect(
        simpleWebAuthnServer.generateRegistrationOptions,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          rpID: 'discuva.org',
          userName: 'a@b.com',
          excludeCredentials: [
            { id: 'existing-cred', transports: ['internal'] },
          ],
          authenticatorSelection: {
            residentKey: 'required',
            userVerification: 'required',
          },
        }),
      );
      expect(mockCacheService.set).toHaveBeenCalledWith(
        'webauthn_challenge:member-1',
        'chal-1',
        300,
      );
    });

    it("uses the tenant's own name for rpName when tenant context is available", async () => {
      mockMemberService.getById.mockResolvedValue({
        id: 'member-1',
        email: 'a@b.com',
      });
      mockCredentialRepo.find.mockResolvedValue([]);
      mockCls.get.mockReturnValue('tenant-1');
      mockTenantRepo.findOne.mockResolvedValue({ name: 'First Baptist' });
      (
        simpleWebAuthnServer.generateRegistrationOptions as jest.Mock
      ).mockResolvedValue({ challenge: 'chal-1' });

      await service.generateRegistrationOptions('member-1');

      expect(
        simpleWebAuthnServer.generateRegistrationOptions,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ rpName: 'First Baptist' }),
      );
    });
  });

  describe('verifyRegistrationResponse', () => {
    it('throws BadRequestException when the challenge has expired', async () => {
      mockCacheService.get.mockResolvedValue(undefined);

      await expect(
        service.verifyRegistrationResponse(
          'member-1',
          {} as any,
          'https://church-a.discuva.org',
          'iPhone UA',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockCredentialRepo.save).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when verification fails', async () => {
      mockCacheService.get.mockResolvedValue('chal-1');
      (
        simpleWebAuthnServer.verifyRegistrationResponse as jest.Mock
      ).mockResolvedValue({ verified: false });

      await expect(
        service.verifyRegistrationResponse(
          'member-1',
          {} as any,
          'https://church-a.discuva.org',
          'iPhone UA',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('stores the new credential, derives a device name, and audit-logs on success', async () => {
      mockCacheService.get.mockResolvedValue('chal-1');
      (
        simpleWebAuthnServer.verifyRegistrationResponse as jest.Mock
      ).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: 'new-cred-id',
            publicKey: Buffer.from('pubkey-bytes'),
            counter: 0,
            transports: ['internal'],
          },
        },
      });

      await service.verifyRegistrationResponse(
        'member-1',
        {} as any,
        'https://church-a.discuva.org',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
      );

      expect(mockCredentialRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          memberId: 'member-1',
          credentialId: 'new-cred-id',
          deviceName: 'iPhone',
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'MEMBER_WEBAUTHN_CREDENTIAL_REGISTERED',
        expect.objectContaining({ targetId: 'member-1' }),
      );
      // Challenge is single-use — cleared after the verify attempt either way.
      expect(mockCacheService.del).toHaveBeenCalledWith(
        'webauthn_challenge:member-1',
      );
    });
  });

  describe('generateAuthenticationOptions', () => {
    it('omits allowCredentials so the browser/OS resolves the credential (usernameless)', async () => {
      (
        simpleWebAuthnServer.generateAuthenticationOptions as jest.Mock
      ).mockResolvedValue({ challenge: 'login-chal' });

      const result = await service.generateAuthenticationOptions();

      expect(result.options).toEqual({ challenge: 'login-chal' });
      expect(typeof result.challengeId).toBe('string');
      expect(
        simpleWebAuthnServer.generateAuthenticationOptions,
      ).toHaveBeenCalledWith(
        expect.not.objectContaining({ allowCredentials: expect.anything() }),
      );
      expect(mockCacheService.set).toHaveBeenCalledWith(
        `webauthn_challenge:${result.challengeId}`,
        'login-chal',
        300,
      );
    });
  });

  describe('verifyAuthenticationResponse', () => {
    it('throws UnauthorizedException when the challenge has expired', async () => {
      mockCacheService.get.mockResolvedValue(undefined);

      await expect(
        service.verifyAuthenticationResponse(
          'chal-id',
          { id: 'cred-1' } as any,
          'https://church-a.discuva.org',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when no credential is registered for this device', async () => {
      mockCacheService.get.mockResolvedValue('chal-1');
      mockCredentialRepo.findOne.mockResolvedValue(null);

      await expect(
        service.verifyAuthenticationResponse(
          'chal-id',
          { id: 'unknown-cred' } as any,
          'https://church-a.discuva.org',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('verifies the assertion, persists the new counter, and returns the resolved memberId', async () => {
      mockCacheService.get.mockResolvedValue('chal-1');
      mockCredentialRepo.findOne.mockResolvedValue({
        memberId: 'member-1',
        credentialId: 'cred-1',
        publicKey: Buffer.from('pubkey-bytes').toString('base64'),
        counter: 5,
        transports: ['internal'],
      });
      (
        simpleWebAuthnServer.verifyAuthenticationResponse as jest.Mock
      ).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 6 },
      });

      const memberId = await service.verifyAuthenticationResponse(
        'chal-id',
        { id: 'cred-1' } as any,
        'https://church-a.discuva.org',
      );

      expect(memberId).toBe('member-1');
      expect(mockCredentialRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ counter: 6 }),
      );
    });

    it('throws UnauthorizedException when the signature does not verify (e.g. counter regression / clone)', async () => {
      mockCacheService.get.mockResolvedValue('chal-1');
      mockCredentialRepo.findOne.mockResolvedValue({
        memberId: 'member-1',
        credentialId: 'cred-1',
        publicKey: Buffer.from('pubkey-bytes').toString('base64'),
        counter: 5,
        transports: [],
      });
      (
        simpleWebAuthnServer.verifyAuthenticationResponse as jest.Mock
      ).mockResolvedValue({ verified: false });

      await expect(
        service.verifyAuthenticationResponse(
          'chal-id',
          { id: 'cred-1' } as any,
          'https://church-a.discuva.org',
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockCredentialRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('listCredentials', () => {
    it('never returns credentialId or publicKey', async () => {
      mockCredentialRepo.find.mockResolvedValue([
        {
          id: 'row-1',
          credentialId: 'secret-cred-id',
          publicKey: 'secret-public-key',
          deviceName: 'iPhone',
          createdAt: new Date('2026-08-01'),
          lastUsedAt: null,
        },
      ]);

      const result = await service.listCredentials('member-1');

      expect(result).toEqual([
        {
          id: 'row-1',
          deviceName: 'iPhone',
          createdAt: new Date('2026-08-01'),
          lastUsedAt: null,
        },
      ]);
    });
  });

  describe('removeCredential', () => {
    it('throws NotFoundException when the row does not belong to this member', async () => {
      mockCredentialRepo.delete.mockResolvedValue({ affected: 0 });

      await expect(
        service.removeCredential('member-1', 'row-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockAuditLogService.log).not.toHaveBeenCalled();
    });

    it('deletes scoped to memberId and audit-logs on success', async () => {
      mockCredentialRepo.delete.mockResolvedValue({ affected: 1 });

      await service.removeCredential('member-1', 'row-1');

      expect(mockCredentialRepo.delete).toHaveBeenCalledWith({
        id: 'row-1',
        memberId: 'member-1',
      });
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'MEMBER_WEBAUTHN_CREDENTIAL_REMOVED',
        expect.objectContaining({ targetId: 'member-1' }),
      );
    });
  });

  describe('revokeAllCredentials', () => {
    it('deletes every credential for the member and audit-logs the count', async () => {
      mockCredentialRepo.delete.mockResolvedValue({ affected: 3 });

      await service.revokeAllCredentials('member-1');

      expect(mockCredentialRepo.delete).toHaveBeenCalledWith({
        memberId: 'member-1',
      });
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'MEMBER_WEBAUTHN_CREDENTIALS_REVOKED',
        expect.objectContaining({
          targetId: 'member-1',
          metadata: { count: 3 },
        }),
      );
    });

    it('does not audit-log when the member had no credentials to revoke', async () => {
      mockCredentialRepo.delete.mockResolvedValue({ affected: 0 });

      await service.revokeAllCredentials('member-1');

      expect(mockAuditLogService.log).not.toHaveBeenCalled();
    });
  });
});
