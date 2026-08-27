import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrayerMeetingService } from './prayer-meeting.service';
import { PrayerMeeting } from '../entity/prayer-meeting.entity';
import { PrayerRosterEntry } from '../entity/prayer-roster-entry.entity';
import { PrayerFixedAssignment } from '../entity/prayer-fixed-assignment.entity';
import { PrayerDayConfig } from '../entity/prayer-day-config.entity';
import { PrayerProgram } from '../entity/prayer-program.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { DepartmentLead } from '../../department/entity/department-lead.entity';
import { PrayerScheduleRule } from '../entity/prayer-schedule-rule.entity';
import { PrayerAudience, PrayerWindowStatus } from '../enum/prayer.enum';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';

const mockMeetingRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  update: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  createQueryBuilder: jest.fn(),
};
const mockRosterRepo = { find: jest.fn(), save: jest.fn(), create: jest.fn() };
const mockFixedRepo = { find: jest.fn() };
const mockDayConfigRepo = { find: jest.fn() };
const mockProgramRepo = { findOne: jest.fn() };
const mockWorkerRepo = { findOne: jest.fn(), find: jest.fn() };
const mockDeptLeadRepo = { findOne: jest.fn() };
const mockRuleRepo = { find: jest.fn() };
const mockPushService = { dispatchToWorkerProfileIds: jest.fn() };

const meetingQb = {
  innerJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  setLock: jest.fn().mockReturnThis(),
  getOne: jest.fn(),
};

const mockManager = {
  getRepository: jest.fn().mockReturnValue({
    createQueryBuilder: jest.fn().mockReturnValue(meetingQb),
  }),
  findOne: jest.fn(),
  count: jest.fn(),
  create: jest.fn((_e: unknown, data: unknown) => data),
  save: jest.fn((_e: unknown, data: unknown) => Promise.resolve(data)),
};

const mockTxHost = { tx: mockManager };

describe('PrayerMeetingService', () => {
  let service: PrayerMeetingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    meetingQb.innerJoinAndSelect.mockReturnThis();
    meetingQb.where.mockReturnThis();
    meetingQb.setLock.mockReturnThis();
    meetingQb.getOne.mockResolvedValue(null);
    mockManager.getRepository.mockReturnValue({
      createQueryBuilder: jest.fn().mockReturnValue(meetingQb),
    });
    mockManager.findOne.mockReset().mockResolvedValue(null);
    mockManager.count.mockReset().mockResolvedValue(0);
    mockManager.create
      .mockReset()
      .mockImplementation((_e: unknown, data: unknown) => data);
    mockManager.save
      .mockReset()
      .mockImplementation((_e: unknown, data: unknown) =>
        Promise.resolve(data),
      );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrayerMeetingService,
        {
          provide: getRepositoryToken(PrayerMeeting),
          useValue: mockMeetingRepo,
        },
        {
          provide: getRepositoryToken(PrayerRosterEntry),
          useValue: mockRosterRepo,
        },
        {
          provide: getRepositoryToken(PrayerFixedAssignment),
          useValue: mockFixedRepo,
        },
        {
          provide: getRepositoryToken(PrayerDayConfig),
          useValue: mockDayConfigRepo,
        },
        {
          provide: getRepositoryToken(PrayerProgram),
          useValue: mockProgramRepo,
        },
        {
          provide: getRepositoryToken(WorkerProfile),
          useValue: mockWorkerRepo,
        },
        {
          provide: getRepositoryToken(DepartmentLead),
          useValue: mockDeptLeadRepo,
        },
        {
          provide: getRepositoryToken(PrayerScheduleRule),
          useValue: mockRuleRepo,
        },
        { provide: TransactionHost, useValue: mockTxHost },
        { provide: PushNotificationService, useValue: mockPushService },
      ],
    }).compile();

    service = module.get<PrayerMeetingService>(PrayerMeetingService);
  });

  describe('selfSelect', () => {
    const program = { id: 'prog-1', audience: PrayerAudience.WORKERS };
    const workerProfile = { id: 'wp-1' };
    const dto = { meetingId: 'meeting-1' };
    const openMeeting = {
      id: 'meeting-1',
      month: 1,
      year: 2026,
      program: { id: 'prog-1' },
      dayConfig: { id: 'dc-1', maxCapacity: 5 },
      currentCapacity: 0,
      selectionStatus: PrayerWindowStatus.OPEN,
    };

    beforeEach(() => {
      mockProgramRepo.findOne.mockResolvedValue(program);
      mockWorkerRepo.findOne.mockResolvedValue(workerProfile);
      mockRuleRepo.find.mockResolvedValue([]);
      mockDeptLeadRepo.findOne.mockResolvedValue(null);
    });

    it('throws NotFoundException when the prayer program does not exist', async () => {
      mockProgramRepo.findOne.mockResolvedValue(null);
      await expect(service.selfSelect('prog-1', 'wp-1', dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when the program is MEMBERS-only', async () => {
      mockProgramRepo.findOne.mockResolvedValue({
        ...program,
        audience: PrayerAudience.MEMBERS,
      });
      await expect(service.selfSelect('prog-1', 'wp-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when the meeting is not found (lock query)', async () => {
      meetingQb.getOne.mockResolvedValue(null);
      await expect(service.selfSelect('prog-1', 'wp-1', dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when the meeting belongs to a different program', async () => {
      meetingQb.getOne.mockResolvedValue({
        ...openMeeting,
        program: { id: 'other-prog' },
      });
      await expect(service.selfSelect('prog-1', 'wp-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the selection window is not open', async () => {
      meetingQb.getOne.mockResolvedValue({
        ...openMeeting,
        selectionStatus: PrayerWindowStatus.CLOSED,
      });
      await expect(service.selfSelect('prog-1', 'wp-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the day is at capacity', async () => {
      meetingQb.getOne.mockResolvedValue({
        ...openMeeting,
        currentCapacity: 5,
      });
      await expect(service.selfSelect('prog-1', 'wp-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the worker has a fixed assignment for this day', async () => {
      meetingQb.getOne.mockResolvedValue(openMeeting);
      mockManager.findOne.mockResolvedValueOnce({ id: 'fixed-1' });
      await expect(service.selfSelect('prog-1', 'wp-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the worker already hit their required frequency', async () => {
      meetingQb.getOne.mockResolvedValue(openMeeting);
      mockManager.findOne.mockResolvedValueOnce(null); // no fixed assignment
      mockRuleRepo.find.mockResolvedValue([]);
      mockManager.count.mockResolvedValue(1); // default frequency is 1
      await expect(service.selfSelect('prog-1', 'wp-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ConflictException when already assigned to this meeting', async () => {
      meetingQb.getOne.mockResolvedValue(openMeeting);
      mockManager.findOne
        .mockResolvedValueOnce(null) // no fixed assignment
        .mockResolvedValueOnce({ id: 'existing-entry' }); // already on this day
      mockManager.count.mockResolvedValue(0);
      await expect(service.selfSelect('prog-1', 'wp-1', dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('creates the roster entry and increments meeting capacity', async () => {
      const meeting = { ...openMeeting };
      meetingQb.getOne.mockResolvedValue(meeting);
      mockManager.findOne
        .mockResolvedValueOnce(null) // no fixed assignment
        .mockResolvedValueOnce(null); // not already on this day
      mockManager.count.mockResolvedValue(0);

      const result = await service.selfSelect('prog-1', 'wp-1', dto);

      expect(mockManager.save).toHaveBeenCalledWith(
        PrayerRosterEntry,
        expect.objectContaining({ workerProfile, meeting }),
      );
      expect(meeting.currentCapacity).toBe(1);
      expect(mockManager.save).toHaveBeenCalledWith(PrayerMeeting, meeting);
      expect(result).toEqual(
        expect.objectContaining({ workerProfile, meeting }),
      );
    });

    it('closes the selection window once capacity is reached', async () => {
      const meeting = {
        ...openMeeting,
        dayConfig: { id: 'dc-1', maxCapacity: 1 },
      };
      meetingQb.getOne.mockResolvedValue(meeting);
      mockManager.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockManager.count.mockResolvedValue(0);

      await service.selfSelect('prog-1', 'wp-1', dto);

      expect(meeting.currentCapacity).toBe(1);
      expect(meeting.selectionStatus).toBe(PrayerWindowStatus.CLOSED);
    });
  });

  describe('getRequiredFrequency (via getSelectionStatus)', () => {
    it('returns the default rule value when no lead-specific rule matches', async () => {
      mockRuleRepo.find.mockResolvedValue([{ targetLeadType: null, value: 2 }]);
      mockDeptLeadRepo.findOne.mockResolvedValue(null);
      mockRosterRepo.find.mockResolvedValue([]);

      const result = await service.getSelectionStatus(
        'prog-1',
        'wp-1',
        1,
        2026,
      );

      expect(result.required).toBe(2);
      expect(result.canSubmit).toBe(false);
    });
  });

  describe('openSelectionWindow', () => {
    it('throws NotFoundException when no meetings exist for the given month', async () => {
      mockMeetingRepo.find.mockResolvedValue([]);
      await expect(
        service.openSelectionWindow('prog-1', { month: 1, year: 2026 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('opens the window and notifies active workers', async () => {
      mockMeetingRepo.find.mockResolvedValue([{ id: 'm-1' }]);
      mockWorkerRepo.find.mockResolvedValue([{ id: 'wp-1' }, { id: 'wp-2' }]);

      await service.openSelectionWindow('prog-1', { month: 1, year: 2026 });

      expect(mockMeetingRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          selectionStatus: PrayerWindowStatus.PENDING,
        }),
        { selectionStatus: PrayerWindowStatus.OPEN },
      );
      expect(mockPushService.dispatchToWorkerProfileIds).toHaveBeenCalledWith(
        ['wp-1', 'wp-2'],
        expect.objectContaining({ idempotencyKey: expect.any(String) }),
      );
    });
  });
});
