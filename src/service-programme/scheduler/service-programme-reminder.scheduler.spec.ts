import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ServiceProgrammeReminderScheduler } from './service-programme-reminder.scheduler';
import { ServiceProgrammeSlot } from '../entity/service-programme-slot.entity';
import { ServiceProgrammeStatusEnum } from '../enum/service-programme-status.enum';
import { ServiceSlotTypeEnum } from '../enum/service-slot-type.enum';
import { EmailQueueService } from '../../utility/service/email-queue.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { CacheService } from '../../utility/service/cache.service';

const mockCacheService = {
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn(),
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

const mockEmailQueueService = {
  queueEmailWithTemplate: jest.fn().mockResolvedValue('job-1'),
  queueEmailWithTemplateAndAttachments: jest.fn().mockResolvedValue('job-1'),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceProgrammeReminderScheduler,
        {
          provide: getRepositoryToken(ServiceProgrammeSlot),
          useValue: mockSlotRepo,
        },
        { provide: EmailQueueService, useValue: mockEmailQueueService },
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();

    scheduler = module.get(ServiceProgrammeReminderScheduler);
  });

  it('does nothing when the lock cannot be acquired', async () => {
    mockCacheService.acquireLock.mockResolvedValue(false);
    await scheduler.sendUpcomingSlotReminders();
    expect(mockSlotRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('sends a reminder with an .ics attachment for each upcoming assigned slot', async () => {
    mockSlotQb.getMany.mockResolvedValue([makeSlot()]);

    await scheduler.sendUpcomingSlotReminders();

    expect(
      mockEmailQueueService.queueEmailWithTemplateAndAttachments,
    ).toHaveBeenCalledWith(
      'ada@example.com',
      expect.any(String),
      'service-slot-reminder',
      expect.objectContaining({ memberName: 'Ada' }),
      [expect.objectContaining({ filename: 'service-slot.ics' })],
      undefined,
      EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
    );
    expect(mockSlotRepo.update).toHaveBeenCalledWith(
      'slot-1',
      expect.objectContaining({ reminderSentAt: expect.any(Date) }),
    );
    expect(mockCacheService.releaseLock).toHaveBeenCalled();
  });

  it('skips slots whose assigned member has no email', async () => {
    mockSlotQb.getMany.mockResolvedValue([
      makeSlot({ member: { id: 'member-1', firstname: 'Ada', email: null } }),
    ]);

    await scheduler.sendUpcomingSlotReminders();

    expect(mockEmailQueueService.queueEmailWithTemplate).not.toHaveBeenCalled();
    expect(
      mockEmailQueueService.queueEmailWithTemplateAndAttachments,
    ).not.toHaveBeenCalled();
    expect(mockSlotRepo.update).not.toHaveBeenCalled();
  });

  it('does nothing when no slots are due for a reminder', async () => {
    mockSlotQb.getMany.mockResolvedValue([]);
    await scheduler.sendUpcomingSlotReminders();
    expect(mockEmailQueueService.queueEmailWithTemplate).not.toHaveBeenCalled();
    expect(
      mockEmailQueueService.queueEmailWithTemplateAndAttachments,
    ).not.toHaveBeenCalled();
  });

  it('releases the lock even when the query fails', async () => {
    mockSlotQb.getMany.mockRejectedValue(new Error('db down'));
    await expect(scheduler.sendUpcomingSlotReminders()).rejects.toThrow(
      'db down',
    );
    expect(mockCacheService.releaseLock).toHaveBeenCalled();
  });
});
