import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { AttendanceJobService } from './attendance-job';
import { AttendanceService } from '../service/attendance.service';
import { CacheService } from '../../utility/service/cache.service';
import { Tenant } from '../../tenant/entity/tenant.entity';

const mockAttendanceService = { markAbsentees: jest.fn() };
const mockCacheService = {
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn(),
};
const mockTenantRepo = { find: jest.fn() };
const mockCls = {
  runWith: jest.fn((_store: unknown, fn: () => unknown) => fn()),
};
const mockTxHost = {
  tx: { query: jest.fn() },
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};

describe('AttendanceJobService', () => {
  let service: AttendanceJobService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCacheService.acquireLock.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceJobService,
        { provide: AttendanceService, useValue: mockAttendanceService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
      ],
    }).compile();
    service = module.get(AttendanceJobService);
  });

  it('skips the run when another instance holds the lock', async () => {
    mockCacheService.acquireLock.mockResolvedValue(false);

    await service.scheduledMarkAbsentees();

    expect(mockTenantRepo.find).not.toHaveBeenCalled();
    expect(mockAttendanceService.markAbsentees).not.toHaveBeenCalled();
  });

  it('calls markAbsentees once per active tenant, entering each tenant context', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);
    mockAttendanceService.markAbsentees.mockResolvedValue(undefined);

    await service.scheduledMarkAbsentees();

    expect(mockTenantRepo.find).toHaveBeenCalledWith({
      where: { isActive: true },
    });
    expect(mockAttendanceService.markAbsentees).toHaveBeenCalledTimes(2);
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_a", public',
    );
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_b", public',
    );
    expect(mockCacheService.releaseLock).toHaveBeenCalled();
  });

  it('continues past one tenant failing and still releases the lock', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);
    mockAttendanceService.markAbsentees
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await service.scheduledMarkAbsentees();

    expect(mockAttendanceService.markAbsentees).toHaveBeenCalledTimes(2);
    expect(mockCacheService.releaseLock).toHaveBeenCalled();
  });
});
