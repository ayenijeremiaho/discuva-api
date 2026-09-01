import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { ProgrammeAutoStartScheduler } from './programme-auto-start.scheduler';
import { ServiceProgramme } from '../entity/service-programme.entity';
import { ServiceSessionService } from '../service/service-session.service';
import { CacheService } from '../../utility/service/cache.service';
import { Tenant } from '../../tenant/entity/tenant.entity';

const mockCacheService = {
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn(),
};

const mockTenantRepo = {
  find: jest
    .fn()
    .mockResolvedValue([{ id: 't1', subdomain: 'a', schemaName: 'church_a' }]),
};
const mockCls = {
  runWith: jest.fn((_store: unknown, fn: () => unknown) => fn()),
};
const mockTxHost = {
  tx: { query: jest.fn() },
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};

const mockProgrammeQb = {
  innerJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
};

const mockProgrammeRepo = {
  createQueryBuilder: jest.fn(() => mockProgrammeQb),
};

const mockSessionService = {
  startEvent: jest.fn(),
};

const makeProgramme = (
  eventId: string,
  overrides: Record<string, any> = {},
) => ({
  id: `programme-${eventId}`,
  serviceSlot: {
    id: `slot-${eventId}`,
    startTime: new Date(),
    event: { id: eventId },
  },
  ...overrides,
});

describe('ProgrammeAutoStartScheduler', () => {
  let scheduler: ProgrammeAutoStartScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCacheService.acquireLock.mockResolvedValue(true);
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProgrammeAutoStartScheduler,
        {
          provide: getRepositoryToken(ServiceProgramme),
          useValue: mockProgrammeRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: ServiceSessionService, useValue: mockSessionService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
      ],
    }).compile();

    scheduler = module.get(ProgrammeAutoStartScheduler);
  });

  it('does nothing when the lock cannot be acquired', async () => {
    mockCacheService.acquireLock.mockResolvedValue(false);
    await scheduler.autoStartDueProgrammes();
    expect(mockProgrammeRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('auto-starts a due, eligible event with no human actor (null memberId)', async () => {
    mockProgrammeQb.getMany.mockResolvedValue([makeProgramme('event-1')]);
    mockSessionService.startEvent.mockResolvedValue({
      sessionCode: 'ABC123',
    });

    await scheduler.autoStartDueProgrammes();

    expect(mockSessionService.startEvent).toHaveBeenCalledWith('event-1', null);
    expect(mockCacheService.releaseLock).toHaveBeenCalled();
  });

  it('does nothing when no programmes are due', async () => {
    mockProgrammeQb.getMany.mockResolvedValue([]);
    await scheduler.autoStartDueProgrammes();
    expect(mockSessionService.startEvent).not.toHaveBeenCalled();
  });

  it('starts each distinct event only once, even with two due slots for the same event', async () => {
    mockProgrammeQb.getMany.mockResolvedValue([
      makeProgramme('event-1'),
      { ...makeProgramme('event-1'), id: 'programme-2' },
    ]);
    mockSessionService.startEvent.mockResolvedValue({ sessionCode: 'X' });

    await scheduler.autoStartDueProgrammes();

    expect(mockSessionService.startEvent).toHaveBeenCalledTimes(1);
  });

  it('treats a ConflictException (already live) as an expected skip, not a failure', async () => {
    mockProgrammeQb.getMany.mockResolvedValue([
      makeProgramme('event-1'),
      makeProgramme('event-2'),
    ]);
    mockSessionService.startEvent
      .mockRejectedValueOnce(new ConflictException('still live'))
      .mockResolvedValueOnce({ sessionCode: 'Y' });

    await expect(scheduler.autoStartDueProgrammes()).resolves.toBeUndefined();
    expect(mockSessionService.startEvent).toHaveBeenCalledTimes(2);
    expect(mockCacheService.releaseLock).toHaveBeenCalled();
  });

  it("one event's unexpected failure doesn't block the rest of the batch", async () => {
    mockProgrammeQb.getMany.mockResolvedValue([
      makeProgramme('event-1'),
      makeProgramme('event-2'),
    ]);
    mockSessionService.startEvent
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ sessionCode: 'Z' });

    await expect(scheduler.autoStartDueProgrammes()).resolves.toBeUndefined();
    expect(mockSessionService.startEvent).toHaveBeenCalledTimes(2);
  });

  it('releases the lock even when the query fails', async () => {
    mockProgrammeQb.getMany.mockRejectedValue(new Error('db down'));
    await expect(scheduler.autoStartDueProgrammes()).resolves.toBeUndefined();
    expect(mockCacheService.releaseLock).toHaveBeenCalled();
  });

  it('runs the query once per active tenant, entering each tenant context', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);
    mockProgrammeQb.getMany.mockResolvedValue([]);

    await scheduler.autoStartDueProgrammes();

    expect(mockProgrammeRepo.createQueryBuilder).toHaveBeenCalledTimes(2);
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_a", public',
    );
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_b", public',
    );
  });
});
