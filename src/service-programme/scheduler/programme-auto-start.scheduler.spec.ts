import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { ProgrammeAutoStartScheduler } from './programme-auto-start.scheduler';
import { ServiceProgramme } from '../entity/service-programme.entity';
import { ServiceSessionService } from '../service/service-session.service';
import { CacheService } from '../../utility/service/cache.service';
import { DateService } from '../../utility/service/date.service';
import { Tenant } from '../../tenant/entity/tenant.entity';

const mockCacheService = {
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn(),
};

const mockDateService = {
  startOfDay: jest.fn().mockReturnValue(new Date('2026-08-02T00:00:00.000Z')),
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
    mockDateService.startOfDay.mockReturnValue(
      new Date('2026-08-02T00:00:00.000Z'),
    );
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
        { provide: DateService, useValue: mockDateService },
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

  it('auto-starts a due, eligible event with no human actor (null memberId), pinning the specific due programme', async () => {
    mockProgrammeQb.getMany.mockResolvedValue([makeProgramme('event-1')]);
    mockSessionService.startEvent.mockResolvedValue({
      sessionCode: 'ABC123',
    });

    await scheduler.autoStartDueProgrammes();

    expect(mockSessionService.startEvent).toHaveBeenCalledWith(
      'event-1',
      null,
      'programme-event-1',
    );
    expect(mockCacheService.releaseLock).toHaveBeenCalled();
  });

  // Regression test: the window used to be a tight 10-minute trailing
  // lookback from `now`, so a later slot in a multi-slot event (e.g. Second
  // Service) blocked by a still-LIVE prior session could scroll past its
  // own startTime + 10 minutes before ever getting unblocked — permanently
  // stranding it in DRAFT even once the prior session was finally ended.
  // The window must be anchored to start-of-day, not a short trailing gap
  // from `now`, so a due slot stays eligible all day.
  it('queries slots due since start of the church-local day, not a short trailing window from now', async () => {
    const startOfDay = new Date('2026-08-02T00:00:00.000Z');
    mockDateService.startOfDay.mockReturnValue(startOfDay);
    mockProgrammeQb.getMany.mockResolvedValue([]);

    await scheduler.autoStartDueProgrammes();

    expect(mockDateService.startOfDay).toHaveBeenCalled();
    expect(mockProgrammeQb.andWhere).toHaveBeenCalledWith(
      'slot.start_time BETWEEN :windowStart AND :now',
      expect.objectContaining({ windowStart: startOfDay }),
    );
  });

  it('does nothing when no programmes are due', async () => {
    mockProgrammeQb.getMany.mockResolvedValue([]);
    await scheduler.autoStartDueProgrammes();
    expect(mockSessionService.startEvent).not.toHaveBeenCalled();
  });

  // Regression test: startEvent() used to be called with just the eventId,
  // leaving it to fall back to "earliest DRAFT programme for the whole
  // event" — which could pick a still-DRAFT sibling slot that was never due
  // (or never auto-start-eligible at all) instead of the one this batch
  // actually determined was due. Passing the specific due programmeId
  // closes that gap; this test pins the earlier of two due slots by
  // explicit startTime, not object-creation-order, so it can't pass by
  // accident.
  it('starts each distinct event only once, passing the earliest-due programme id when two due slots share an event', async () => {
    const earlier = {
      ...makeProgramme('event-1'),
      id: 'programme-earlier',
      serviceSlot: {
        id: 'slot-earlier',
        startTime: new Date('2026-08-02T08:00:00.000Z'),
        event: { id: 'event-1' },
      },
    };
    const later = {
      ...makeProgramme('event-1'),
      id: 'programme-later',
      serviceSlot: {
        id: 'slot-later',
        startTime: new Date('2026-08-02T10:00:00.000Z'),
        event: { id: 'event-1' },
      },
    };
    // Deliberately queued out of chronological order — the picker must sort
    // by startTime itself, not trust array order.
    mockProgrammeQb.getMany.mockResolvedValue([later, earlier]);
    mockSessionService.startEvent.mockResolvedValue({ sessionCode: 'X' });

    await scheduler.autoStartDueProgrammes();

    expect(mockSessionService.startEvent).toHaveBeenCalledTimes(1);
    expect(mockSessionService.startEvent).toHaveBeenCalledWith(
      'event-1',
      null,
      'programme-earlier',
    );
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
