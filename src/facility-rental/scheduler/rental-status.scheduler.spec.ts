import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { RentalStatusScheduler } from './rental-status.scheduler';
import { RentalBooking } from '../entity/rental-booking.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { RentalBookingStatus } from '../enum/rental.enum';

const mockBookingRepo = {
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
        {
          provide: getRepositoryToken(RentalBooking),
          useValue: mockBookingRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
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

    expect(mockBookingRepo.find).toHaveBeenCalledTimes(4);
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
});
