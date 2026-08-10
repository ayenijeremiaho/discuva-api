import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TenantMiddleware } from './tenant.middleware';
import { Tenant } from '../entity/tenant.entity';
import { TenantOnboardingStatus } from '../enum/tenant-onboarding-status.enum';
import refreshJwtConfig from '../../config/refresh.jwt.config';

const mockTenantRepo = { findOneBy: jest.fn() };
const mockCls = { set: jest.fn() };
const mockConfigService = { get: jest.fn().mockReturnValue('localhost') };
const mockTx = { query: jest.fn() };
const mockTxHost = {
  tx: mockTx,
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};
const mockJwtService = { verifyAsync: jest.fn() };
const mockJwtRefreshConfig = { secret: 'refresh-secret' };

function makeReq(
  hostname: string,
  opts: {
    authorization?: string;
    refreshCookie?: string;
    tenantSubdomainHeader?: string;
  } = {},
) {
  return {
    hostname,
    headers: {
      ...(opts.authorization && { authorization: opts.authorization }),
      ...(opts.tenantSubdomainHeader && {
        'x-tenant-subdomain': opts.tenantSubdomainHeader,
      }),
    },
    cookies: opts.refreshCookie
      ? { refresh_token: opts.refreshCookie }
      : undefined,
  } as any;
}

// Minimal EventEmitter-shaped res stub — real TenantMiddleware waits on
// res.once('finish'/'close') to know when to commit/roll back the
// transaction it opened; the happy-path test below fires 'finish' manually
// once next() has run to let that promise resolve.
function makeRes(statusCode = 200) {
  const handlers: Record<string, () => void> = {};
  return {
    statusCode,
    once: jest.fn((event: string, cb: () => void) => {
      handlers[event] = cb;
    }),
    fire: (event: string) => handlers[event]?.(),
  } as any;
}

describe('TenantMiddleware', () => {
  let middleware: TenantMiddleware;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockReturnValue('localhost');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantMiddleware,
        { provide: ClsService, useValue: mockCls },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: TransactionHost, useValue: mockTxHost },
        { provide: JwtService, useValue: mockJwtService },
        { provide: refreshJwtConfig.KEY, useValue: mockJwtRefreshConfig },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
      ],
    }).compile();
    middleware = module.get(TenantMiddleware);
  });

  it('throws NotFoundException when the hostname carries no subdomain at all', async () => {
    const next = jest.fn();
    await expect(
      middleware.use(makeReq('localhost'), makeRes(), next),
    ).rejects.toThrow(NotFoundException);
    expect(mockTenantRepo.findOneBy).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when no tenant row exists for the subdomain', async () => {
    mockTenantRepo.findOneBy.mockResolvedValue(null);
    const next = jest.fn();

    await expect(
      middleware.use(makeReq('nope.localhost'), makeRes(), next),
    ).rejects.toThrow(NotFoundException);
  });

  it.each([
    TenantOnboardingStatus.PENDING,
    TenantOnboardingStatus.PROVISIONING,
  ])(
    'throws ServiceUnavailableException ("still being set up") when onboardingStatus is %s',
    async (onboardingStatus) => {
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 't1',
        subdomain: 'church-a',
        schemaName: 'church_a',
        isActive: false,
        onboardingStatus,
      });
      const next = jest.fn();

      await expect(
        middleware.use(makeReq('church-a.localhost'), makeRes(), next),
      ).rejects.toThrow(ServiceUnavailableException);
      await expect(
        middleware.use(makeReq('church-a.localhost'), makeRes(), next),
      ).rejects.toThrow('still being set up');
    },
  );

  it('throws ServiceUnavailableException with a distinct message when onboardingStatus is FAILED', async () => {
    mockTenantRepo.findOneBy.mockResolvedValue({
      id: 't1',
      subdomain: 'church-a',
      schemaName: 'church_a',
      isActive: false,
      onboardingStatus: TenantOnboardingStatus.FAILED,
    });
    const next = jest.fn();

    await expect(
      middleware.use(makeReq('church-a.localhost'), makeRes(), next),
    ).rejects.toThrow('problem setting up');
  });

  it('throws ForbiddenException (not NotFoundException) for a suspended, previously-active tenant', async () => {
    mockTenantRepo.findOneBy.mockResolvedValue({
      id: 't1',
      subdomain: 'church-a',
      schemaName: 'church_a',
      isActive: false,
      onboardingStatus: TenantOnboardingStatus.ACTIVE,
    });
    const next = jest.fn();

    await expect(
      middleware.use(makeReq('church-a.localhost'), makeRes(), next),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      middleware.use(makeReq('church-a.localhost'), makeRes(), next),
    ).rejects.toThrow('suspended');
  });

  it('proceeds normally (sets CLS, calls next) for an active tenant', async () => {
    mockTenantRepo.findOneBy.mockResolvedValue({
      id: 't1',
      subdomain: 'church-a',
      schemaName: 'church_a',
      clusterId: 'default',
      isActive: true,
      onboardingStatus: TenantOnboardingStatus.ACTIVE,
    });
    const res = makeRes(200);
    const next = jest.fn(() => res.fire('finish'));

    await middleware.use(makeReq('church-a.localhost'), res, next);

    expect(mockCls.set).toHaveBeenCalledWith('tenantId', 't1');
    expect(mockCls.set).toHaveBeenCalledWith('schemaName', 'church_a');
    expect(next).toHaveBeenCalled();
    expect(mockTx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_a", public',
    );
  });

  describe('fallback resolution for a Host header with no subdomain', () => {
    it('resolves the tenant from a verified Bearer access-token claim', async () => {
      mockJwtService.verifyAsync.mockResolvedValueOnce({
        sub: 'member-1',
        tenantId: 't1',
      });
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 't1',
        subdomain: 'church-a',
        schemaName: 'church_a',
        clusterId: 'default',
        isActive: true,
        onboardingStatus: TenantOnboardingStatus.ACTIVE,
      });
      const res = makeRes(200);
      const next = jest.fn(() => res.fire('finish'));

      await middleware.use(
        makeReq('admin.localhost', { authorization: 'Bearer valid-token' }),
        res,
        next,
      );

      expect(mockJwtService.verifyAsync).toHaveBeenCalledWith(
        'valid-token',
        undefined,
      );
      expect(mockTenantRepo.findOneBy).toHaveBeenCalledWith({ id: 't1' });
      expect(mockCls.set).toHaveBeenCalledWith('tenantId', 't1');
      expect(next).toHaveBeenCalled();
    });

    it("resolves a REFRESH token sent via the Authorization header (discuva-member's mobile-style /auth/refresh, no cookie) by retrying with the refresh secret", async () => {
      mockJwtService.verifyAsync.mockImplementation(
        async (_token: string, options?: { secret?: string }) => {
          if (options?.secret === 'refresh-secret') {
            return { sub: 'member-1', tenantId: 't1' };
          }
          throw new Error('invalid signature for access secret');
        },
      );
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 't1',
        subdomain: 'church-a',
        schemaName: 'church_a',
        clusterId: 'default',
        isActive: true,
        onboardingStatus: TenantOnboardingStatus.ACTIVE,
      });
      const res = makeRes(200);
      const next = jest.fn(() => res.fire('finish'));

      await middleware.use(
        makeReq('admin.localhost', {
          authorization: 'Bearer refresh-token-not-access-token',
        }),
        res,
        next,
      );

      expect(mockJwtService.verifyAsync).toHaveBeenCalledWith(
        'refresh-token-not-access-token',
        undefined,
      );
      expect(mockJwtService.verifyAsync).toHaveBeenCalledWith(
        'refresh-token-not-access-token',
        { secret: 'refresh-secret' },
      );
      expect(mockTenantRepo.findOneBy).toHaveBeenCalledWith({ id: 't1' });
      expect(next).toHaveBeenCalled();
    });

    it('falls through to the refresh-token cookie, verified with the refresh secret, when no access token resolves anything', async () => {
      mockJwtService.verifyAsync.mockImplementation(
        async (_token: string, options?: { secret?: string }) => {
          if (options?.secret === 'refresh-secret') {
            return { sub: 'member-1', tenantId: 't1' };
          }
          throw new Error('invalid signature');
        },
      );
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 't1',
        subdomain: 'church-a',
        schemaName: 'church_a',
        clusterId: 'default',
        isActive: true,
        onboardingStatus: TenantOnboardingStatus.ACTIVE,
      });
      const res = makeRes(200);
      const next = jest.fn(() => res.fire('finish'));

      await middleware.use(
        makeReq('admin.localhost', { refreshCookie: 'refresh-jwt' }),
        res,
        next,
      );

      expect(mockJwtService.verifyAsync).toHaveBeenCalledWith('refresh-jwt', {
        secret: 'refresh-secret',
      });
      expect(mockTenantRepo.findOneBy).toHaveBeenCalledWith({ id: 't1' });
      expect(next).toHaveBeenCalled();
    });

    it('falls through to X-Tenant-Subdomain when no token is present at all (the login request)', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 't1',
        subdomain: 'church-a',
        schemaName: 'church_a',
        clusterId: 'default',
        isActive: true,
        onboardingStatus: TenantOnboardingStatus.ACTIVE,
      });
      const res = makeRes(200);
      const next = jest.fn(() => res.fire('finish'));

      await middleware.use(
        makeReq('admin.localhost', { tenantSubdomainHeader: 'Church-A' }),
        res,
        next,
      );

      expect(mockJwtService.verifyAsync).not.toHaveBeenCalled();
      expect(mockTenantRepo.findOneBy).toHaveBeenCalledWith({
        subdomain: 'church-a',
      });
      expect(next).toHaveBeenCalled();
    });

    it('throws NotFoundException when the token is invalid AND no X-Tenant-Subdomain header is present', async () => {
      mockJwtService.verifyAsync.mockRejectedValue(new Error('bad token'));
      const next = jest.fn();

      await expect(
        middleware.use(
          makeReq('admin.localhost', { authorization: 'Bearer garbage' }),
          makeRes(),
          next,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockTenantRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('never consults the fallback path when the Host header already resolved a subdomain', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 't1',
        subdomain: 'church-a',
        schemaName: 'church_a',
        clusterId: 'default',
        isActive: true,
        onboardingStatus: TenantOnboardingStatus.ACTIVE,
      });
      const res = makeRes(200);
      const next = jest.fn(() => res.fire('finish'));

      await middleware.use(
        makeReq('church-a.localhost', {
          authorization: 'Bearer should-be-ignored',
        }),
        res,
        next,
      );

      expect(mockJwtService.verifyAsync).not.toHaveBeenCalled();
      expect(mockTenantRepo.findOneBy).toHaveBeenCalledWith({
        subdomain: 'church-a',
      });
    });
  });
});
