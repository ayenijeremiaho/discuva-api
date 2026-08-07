import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { ConfigService } from '@nestjs/config';
import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TenantMiddleware } from './tenant.middleware';
import { Tenant } from '../entity/tenant.entity';
import { TenantOnboardingStatus } from '../enum/tenant-onboarding-status.enum';

const mockTenantRepo = { findOneBy: jest.fn() };
const mockCls = { set: jest.fn() };
const mockConfigService = { get: jest.fn().mockReturnValue('localhost') };
const mockTx = { query: jest.fn() };
const mockTxHost = {
  tx: mockTx,
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};

function makeReq(hostname: string) {
  return { hostname } as any;
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
});
