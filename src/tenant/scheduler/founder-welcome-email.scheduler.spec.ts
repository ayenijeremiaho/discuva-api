import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { FounderWelcomeEmailScheduler } from './founder-welcome-email.scheduler';
import { Tenant } from '../entity/tenant.entity';
import { TenantOnboardingStatus } from '../enum/tenant-onboarding-status.enum';
import { UtilityService } from '../../utility/service/utility.service';
import { CacheService } from '../../utility/service/cache.service';

const mockCacheService = {
  acquireLock: jest.fn().mockResolvedValue(true),
};

jest.mock('../utility/run-in-tenant-context', () => ({
  runInTenantContext: jest.fn((cls, txHost, envelope, fn) => fn()),
}));

const mockTenantRepo = { find: jest.fn(), update: jest.fn() };
const mockUtilityService = { sendEmailWithTemplate: jest.fn() };
const mockTx = { findOne: jest.fn() };
const mockTxHost = { tx: mockTx };
const mockCls = {};

const dueTenant = {
  id: 'tenant-1',
  name: 'Grace Chapel',
  schemaName: 'church_grace_chapel',
  onboardingStatus: TenantOnboardingStatus.ACTIVE,
  isActive: true,
  activatedAt: new Date('2026-09-01'),
  founderWelcomeEmailSentAt: null,
} as Tenant;

describe('FounderWelcomeEmailScheduler', () => {
  let scheduler: FounderWelcomeEmailScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockTenantRepo.find.mockResolvedValue([]);
    mockTenantRepo.update.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FounderWelcomeEmailScheduler,
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
        { provide: CacheService, useValue: mockCacheService },
        { provide: UtilityService, useValue: mockUtilityService },
      ],
    }).compile();
    scheduler = module.get(FounderWelcomeEmailScheduler);
  });

  it('does nothing when no tenant is due', async () => {
    await scheduler.sendDueFounderWelcomeEmails();

    expect(mockUtilityService.sendEmailWithTemplate).not.toHaveBeenCalled();
    expect(mockTenantRepo.update).not.toHaveBeenCalled();
  });

  it('queries only ACTIVE, isActive, unsent tenants activated at least a day ago', async () => {
    await scheduler.sendDueFounderWelcomeEmails();

    expect(mockTenantRepo.find).toHaveBeenCalledWith({
      where: {
        onboardingStatus: TenantOnboardingStatus.ACTIVE,
        isActive: true,
        founderWelcomeEmailSentAt: expect.anything(),
        activatedAt: expect.anything(),
      },
    });
  });

  it('emails the earliest-created active admin and marks the tenant sent', async () => {
    mockTenantRepo.find.mockResolvedValue([dueTenant]);
    mockTx.findOne.mockResolvedValue({
      isActive: true,
      member: { firstname: 'Ada', email: 'ada@grace-chapel.org' },
    });

    await scheduler.sendDueFounderWelcomeEmails();

    expect(mockTx.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        where: { isActive: true },
        order: { createdAt: 'ASC' },
      }),
    );
    expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
      'ada@grace-chapel.org',
      expect.any(String),
      'founder-welcome',
      expect.objectContaining({
        name: 'Ada',
        church_name: 'Grace Chapel',
      }),
    );
    expect(mockTenantRepo.update).toHaveBeenCalledWith('tenant-1', {
      founderWelcomeEmailSentAt: expect.any(Date),
    });
  });

  it('skips a tenant with no admin found, without marking it sent', async () => {
    mockTenantRepo.find.mockResolvedValue([dueTenant]);
    mockTx.findOne.mockResolvedValue(null);

    await scheduler.sendDueFounderWelcomeEmails();

    expect(mockUtilityService.sendEmailWithTemplate).not.toHaveBeenCalled();
    expect(mockTenantRepo.update).not.toHaveBeenCalled();
  });

  it('does not mark a tenant sent when sending fails, so it retries on the next run', async () => {
    mockTenantRepo.find.mockResolvedValue([dueTenant]);
    mockTx.findOne.mockRejectedValue(new Error('db down'));

    await scheduler.sendDueFounderWelcomeEmails();

    expect(mockTenantRepo.update).not.toHaveBeenCalled();
  });

  it('processes remaining tenants when one fails', async () => {
    const secondTenant = {
      ...dueTenant,
      id: 'tenant-2',
      name: 'Second Church',
    };
    mockTenantRepo.find.mockResolvedValue([dueTenant, secondTenant]);
    mockTx.findOne
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({
        isActive: true,
        member: { firstname: 'Bola', email: 'bola@second-church.org' },
      });

    await scheduler.sendDueFounderWelcomeEmails();

    expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledTimes(1);
    expect(mockTenantRepo.update).toHaveBeenCalledWith('tenant-2', {
      founderWelcomeEmailSentAt: expect.any(Date),
    });
  });

  it('does nothing when another instance already ran it', async () => {
    mockCacheService.acquireLock.mockResolvedValueOnce(false);
    await scheduler.sendDueFounderWelcomeEmails();
    expect(mockTenantRepo.find).not.toHaveBeenCalled();
  });
});
