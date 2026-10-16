import { Test, TestingModule } from '@nestjs/testing';
import { RentalNotifierService } from '../service/rental-notifier.service';

const mockNotifier = { reminder: jest.fn().mockResolvedValue(undefined) };
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { RentalStatusScheduler } from './rental-status.scheduler';
import { RentalBooking } from '../entity/rental-booking.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { RentalBookingStatus } from '../enum/rental.enum';
import { realGateProvider } from '../../tenant/scheduler-gate/scheduler-gate.testing';

const mockNextQb = {
  select: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  setParameters: jest.fn().mockReturnThis(),
  getRawOne: jest.fn().mockResolvedValue({ next: null }),
};
const mockBookingRepo = {
  createQueryBuilder: jest.fn(() => mockNextQb),
  find: jest.fn().mockResolvedValue([]),
  update: jest.fn().mockResolvedValue({ affected: 1 }),
};
const mockTenantRepo = { find: jest.fn() };
const mockCls = {
  runWith: jest.fn((_store: unknown, fn: () => unknown) => fn()),
};
const mockTxHost = {
  tx: { query: jest.fn() },
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};

describe('RentalStatusScheduler', () => {
  let scheduler: RentalStatusScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockBookingRepo.find.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RentalStatusScheduler,
        { provide: RentalNotifierService, useValue: mockNotifier },
        {
          provide: getRepositoryToken(RentalBooking),
          useValue: mockBookingRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
        realGateProvider(mockTenantRepo, mockCls),
      ],
    }).compile();
    scheduler = module.get(RentalStatusScheduler);
  });

  it('runs the booking query once per active tenant, entering each tenant context', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);

    await scheduler.transitionBookingStatuses();

    // Per church: due reminders, then bookings starting, then bookings ending.
    expect(mockBookingRepo.find).toHaveBeenCalledTimes(6);
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_a", public',
    );
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_b", public',
    );
  });

  it('transitions confirmed bookings that have started to IN_PROGRESS', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    mockBookingRepo.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'booking-1' }])
      .mockResolvedValueOnce([]);

    await scheduler.transitionBookingStatuses();

    expect(mockBookingRepo.update).toHaveBeenCalledWith(['booking-1'], {
      status: RentalBookingStatus.IN_PROGRESS,
    });
  });

  it('continues past one tenant failing so the rest still get processed', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);
    mockBookingRepo.find
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([]);

    await expect(
      scheduler.transitionBookingStatuses(),
    ).resolves.toBeUndefined();
    expect(mockBookingRepo.find).toHaveBeenCalled();
  });

  it('reminds each renter once, the day before, marking it before sending', async () => {
    const booking = {
      id: 'b1',
      startDateTime: new Date(Date.now() + 3_600_000),
    };
    mockBookingRepo.find.mockResolvedValueOnce([booking]).mockResolvedValue([]);

    await scheduler.runTransitions();

    expect(mockBookingRepo.find.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          status: RentalBookingStatus.CONFIRMED,
          reminderSentAt: expect.anything(),
        }),
        relations: ['member', 'facility'],
      }),
    );
    expect(mockBookingRepo.update).toHaveBeenCalledWith(['b1'], {
      reminderSentAt: expect.any(Date),
    });
    expect(mockNotifier.reminder).toHaveBeenCalledWith(booking);
    expect(mockBookingRepo.update.mock.invocationCallOrder[0]).toBeLessThan(
      mockNotifier.reminder.mock.invocationCallOrder[0],
    );
  });

  it('wakes for the earliest of a booking starting or ending and a reminder falling due', async () => {
    mockNextQb.getRawOne
      .mockResolvedValueOnce({ next: '2026-10-10T15:00:00.000Z' })
      .mockResolvedValueOnce({ start: '2026-10-09T09:00:00.000Z' });
    await expect(scheduler.runTransitions()).resolves.toEqual(
      new Date('2026-10-08T09:00:00.000Z'),
    );
  });

  it('reports when the next booking starts or ends so quiet churches can be skipped', async () => {
    mockNextQb.getRawOne.mockResolvedValueOnce({
      next: '2026-10-04T15:00:00.000Z',
    });
    await expect(scheduler.runTransitions()).resolves.toEqual(
      new Date('2026-10-04T15:00:00.000Z'),
    );
    expect(mockNextQb.where).toHaveBeenCalledWith('b.status IN (:...open)', {
      open: [RentalBookingStatus.CONFIRMED, RentalBookingStatus.IN_PROGRESS],
    });
    mockNextQb.getRawOne
      .mockResolvedValueOnce({ start: null })
      .mockResolvedValueOnce({ next: null })
      .mockResolvedValueOnce({ start: null });
    await expect(scheduler.runTransitions()).resolves.toBeNull();
  });
});
