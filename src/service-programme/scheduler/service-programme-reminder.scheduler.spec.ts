import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { ServiceProgrammeReminderScheduler } from './service-programme-reminder.scheduler';
import { ServiceProgrammeSlot } from '../entity/service-programme-slot.entity';
import { ServiceProgrammeStatusEnum } from '../enum/service-programme-status.enum';
import { ServiceSlotTypeEnum } from '../enum/service-slot-type.enum';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { DepartmentAccessService } from '../../department/service/department-access.service';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
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

const mockSlotQb = {
  innerJoinAndSelect: jest.fn().mockReturnThis(),
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
};

const mockSlotRepo = {
  createQueryBuilder: jest.fn(() => mockSlotQb),
  update: jest.fn().mockResolvedValue({ affected: 1 }),
};

const mockDispatch = { notifyMember: jest.fn().mockResolvedValue(undefined) };
const mockDepartmentAccess = {
  findMemberIdsInDepartment: jest.fn().mockResolvedValue([]),
  findHeadOfDepartment: jest.fn().mockResolvedValue(null),
};

const makeSlot = (overrides: Record<string, any> = {}) => ({
  id: 'slot-1',
  type: ServiceSlotTypeEnum.SPEAKER,
  topic: 'Opening',
  allocatedMinutes: 20,
  member: { id: 'member-1', firstname: 'Ada', email: 'ada@example.com' },
  programme: {
    status: ServiceProgrammeStatusEnum.DRAFT,
    serviceSlot: {
      name: 'First Service',
      startTime: new Date('2026-08-02T09:00:00.000Z'),
      endTime: new Date('2026-08-02T11:00:00.000Z'),
      event: { name: 'Sunday' },
    },
  },
  ...overrides,
});

describe('ServiceProgrammeReminderScheduler', () => {
  let scheduler: ServiceProgrammeReminderScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCacheService.acquireLock.mockResolvedValue(true);
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceProgrammeReminderScheduler,
        {
          provide: getRepositoryToken(ServiceProgrammeSlot),
          useValue: mockSlotRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: NotificationDispatchService, useValue: mockDispatch },
        { provide: DepartmentAccessService, useValue: mockDepartmentAccess },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
      ],
    }).compile();

    scheduler = module.get(ServiceProgrammeReminderScheduler);
  });

  it('does nothing when the lock cannot be acquired', async () => {
    mockCacheService.acquireLock.mockResolvedValue(false);
    await scheduler.sendUpcomingSlotReminders();
    expect(mockSlotRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('sends a reminder email with an .ics attachment and a push for each upcoming assigned slot', async () => {
    mockSlotQb.getMany.mockResolvedValue([makeSlot()]);

    await scheduler.sendUpcomingSlotReminders();

    expect(mockDispatch.notifyMember).toHaveBeenCalledWith({
      category: EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
      email: expect.objectContaining({
        to: 'ada@example.com',
        recipientMemberId: 'member-1',
        template: 'service-slot-reminder',
        data: expect.objectContaining({ memberName: 'Ada' }),
        attachments: [
          expect.objectContaining({ filename: 'service-slot.ics' }),
        ],
      }),
      push: expect.objectContaining({
        memberIds: ['member-1'],
        key: PushNotificationKey.SERVICE_SLOT_REMINDER,
      }),
    });
    expect(mockSlotRepo.update).toHaveBeenCalledWith(
      'slot-1',
      expect.objectContaining({ reminderSentAt: expect.any(Date) }),
    );
    expect(mockCacheService.releaseLock).toHaveBeenCalled();
  });

  it('still pushes to a member with no email on file', async () => {
    mockSlotQb.getMany.mockResolvedValue([
      makeSlot({ member: { id: 'member-1', firstname: 'Ada', email: null } }),
    ]);

    await scheduler.sendUpcomingSlotReminders();

    expect(mockDispatch.notifyMember).toHaveBeenCalledWith(
      expect.objectContaining({
        email: undefined,
        push: expect.objectContaining({ memberIds: ['member-1'] }),
      }),
    );
    expect(mockSlotRepo.update).toHaveBeenCalled();
  });

  it('reminds the whole department by push and emails the HOD', async () => {
    mockSlotQb.getMany.mockResolvedValue([
      makeSlot({ member: null, department: { id: 'dept-1', name: 'Choir' } }),
    ]);
    mockDepartmentAccess.findMemberIdsInDepartment.mockResolvedValue([
      'm-1',
      'm-2',
    ]);
    mockDepartmentAccess.findHeadOfDepartment.mockResolvedValue({
      id: 'm-hod',
      firstname: 'Hilda',
      lastname: 'O',
      email: 'hilda@example.com',
    });

    await scheduler.sendUpcomingSlotReminders();

    const call = mockDispatch.notifyMember.mock.calls[0][0];
    expect(call.email).toEqual(
      expect.objectContaining({
        to: 'hilda@example.com',
        recipientMemberId: 'm-hod',
        subject: expect.stringContaining('Choir'),
      }),
    );
    expect(call.push.memberIds.sort()).toEqual(['m-1', 'm-2', 'm-hod']);
    expect(call.push.vars.team_suffix).toBe(' with Choir');
    expect(mockSlotRepo.update).toHaveBeenCalledWith(
      'slot-1',
      expect.objectContaining({ reminderSentAt: expect.any(Date) }),
    );
  });

  it('does nothing when no slots are due for a reminder', async () => {
    mockSlotQb.getMany.mockResolvedValue([]);
    await scheduler.sendUpcomingSlotReminders();
    expect(mockDispatch.notifyMember).not.toHaveBeenCalled();
  });

  it('releases the lock even when the query fails', async () => {
    mockSlotQb.getMany.mockRejectedValue(new Error('db down'));
    await expect(
      scheduler.sendUpcomingSlotReminders(),
    ).resolves.toBeUndefined();
    expect(mockCacheService.releaseLock).toHaveBeenCalled();
  });

  it('runs the slot query once per active tenant, entering each tenant context', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);
    mockSlotQb.getMany.mockResolvedValue([]);

    await scheduler.sendUpcomingSlotReminders();

    expect(mockSlotRepo.createQueryBuilder).toHaveBeenCalledTimes(2);
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_a", public',
    );
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_b", public',
    );
  });

  it('continues past one tenant failing so the rest still get processed', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);
    mockSlotQb.getMany
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([]);

    await expect(
      scheduler.sendUpcomingSlotReminders(),
    ).resolves.toBeUndefined();
    expect(mockSlotRepo.createQueryBuilder).toHaveBeenCalledTimes(2);
    expect(mockCacheService.releaseLock).toHaveBeenCalled();
  });
});
