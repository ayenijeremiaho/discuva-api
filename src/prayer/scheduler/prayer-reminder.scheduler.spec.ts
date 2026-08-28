import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { PrayerReminderScheduler } from './prayer-reminder.scheduler';
import { PrayerRosterEntry } from '../entity/prayer-roster-entry.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';

const mockRosterRepo = {
  find: jest.fn().mockResolvedValue([]),
  save: jest.fn(),
};
const mockTenantRepo = { find: jest.fn() };
const mockUtilityService = { sendEmailWithTemplate: jest.fn() };
const mockPushService = { dispatchToMemberIds: jest.fn() };
const mockCls = {
  runWith: jest.fn((_store: unknown, fn: () => unknown) => fn()),
};
const mockTxHost = {
  tx: { query: jest.fn() },
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};

describe('PrayerReminderScheduler', () => {
  let scheduler: PrayerReminderScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRosterRepo.find.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrayerReminderScheduler,
        {
          provide: getRepositoryToken(PrayerRosterEntry),
          useValue: mockRosterRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: PushNotificationService, useValue: mockPushService },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
      ],
    }).compile();
    scheduler = module.get(PrayerReminderScheduler);
  });

  it('runs the roster query once per active tenant, entering each tenant context', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);

    await scheduler.sendReminders();

    // Two calls per tenant (two-day + day-of), so 4 total across 2 tenants.
    expect(mockRosterRepo.find).toHaveBeenCalledTimes(4);
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_a", public',
    );
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_b", public',
    );
  });

  it('sends both an email and a push notification per due entry', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    const entry = {
      id: 'entry-1',
      reminderTwoDaySent: false,
      reminderDaySent: false,
      workerProfile: {
        member: { id: 'member-1', email: 'w@example.com', firstname: 'Ada' },
      },
      meeting: {
        date: '2026-06-01',
        dayConfig: { startTime: '18:00', endTime: '19:00', mode: 'onsite' },
      },
    };
    mockRosterRepo.find
      .mockResolvedValueOnce([entry])
      .mockResolvedValueOnce([]);

    await scheduler.sendReminders();

    expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
      'w@example.com',
      expect.stringContaining('2 Days Away'),
      'prayer-reminder',
      expect.objectContaining({ name: 'Ada' }),
      undefined,
      expect.any(String),
    );
    expect(mockPushService.dispatchToMemberIds).toHaveBeenCalledWith(
      ['member-1'],
      expect.objectContaining({
        idempotencyKey: 'prayer-reminder-two-day:entry-1',
      }),
    );
    expect(mockRosterRepo.save).toHaveBeenCalledWith([
      expect.objectContaining({ reminderTwoDaySent: true }),
    ]);
  });

  it('sends a reminder for a member-direct entry (MEMBERS-audience program, no workerProfile)', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    const entry = {
      id: 'entry-2',
      reminderTwoDaySent: false,
      reminderDaySent: false,
      workerProfile: null,
      member: { id: 'member-2', email: 'm@example.com', firstname: 'Bola' },
      meeting: {
        date: '2026-06-01',
        dayConfig: { startTime: '18:00', endTime: '19:00', mode: 'onsite' },
      },
    };
    mockRosterRepo.find
      .mockResolvedValueOnce([entry])
      .mockResolvedValueOnce([]);

    await scheduler.sendReminders();

    expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
      'm@example.com',
      expect.stringContaining('2 Days Away'),
      'prayer-reminder',
      expect.objectContaining({ name: 'Bola' }),
      undefined,
      expect.any(String),
    );
    expect(mockPushService.dispatchToMemberIds).toHaveBeenCalledWith(
      ['member-2'],
      expect.objectContaining({
        idempotencyKey: 'prayer-reminder-two-day:entry-2',
      }),
    );
    expect(mockRosterRepo.save).toHaveBeenCalledWith([
      expect.objectContaining({ reminderTwoDaySent: true }),
    ]);
  });

  it('does not mark reminderTwoDaySent when the entry has neither a workerProfile nor a member', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    const entry = {
      id: 'entry-3',
      reminderTwoDaySent: false,
      reminderDaySent: false,
      workerProfile: null,
      member: null,
      meeting: {
        date: '2026-06-01',
        dayConfig: { startTime: '18:00', endTime: '19:00', mode: 'onsite' },
      },
    };
    mockRosterRepo.find
      .mockResolvedValueOnce([entry])
      .mockResolvedValueOnce([]);

    await scheduler.sendReminders();

    expect(mockUtilityService.sendEmailWithTemplate).not.toHaveBeenCalled();
    expect(mockPushService.dispatchToMemberIds).not.toHaveBeenCalled();
    expect(mockRosterRepo.save).toHaveBeenCalledWith([
      expect.objectContaining({ reminderTwoDaySent: false }),
    ]);
  });

  it('continues past one tenant failing so the rest still get processed', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);
    mockRosterRepo.find
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([]);

    await expect(scheduler.sendReminders()).resolves.toBeUndefined();
    expect(mockRosterRepo.find).toHaveBeenCalled();
  });
});
