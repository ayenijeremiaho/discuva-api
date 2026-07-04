import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrayerRosterService } from './prayer-roster.service';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { PrayerMeeting } from '../entity/prayer-meeting.entity';
import { PrayerRosterEntry } from '../entity/prayer-roster-entry.entity';
import { PrayerScheduleRule } from '../entity/prayer-schedule-rule.entity';
import { PrayerProgram } from '../entity/prayer-program.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { Member } from '../../member/entity/member.entity';
import { DepartmentLead } from '../../department/entity/department-lead.entity';
import {
  PrayerAssignmentType,
  PrayerAudience,
  PrayerMeetingStatus,
  PrayerRosterStatus,
  PrayerRuleType,
  PrayerWindowStatus,
} from '../enum/prayer.enum';
import { WorkerStatusEnum } from '../../member/enums/worker-status.enum';
import { DepartmentLeadTypeEnum } from '../../department/enums/department-lead-type.enum';

const PROGRAM_ID = 'prog-1';

const makeProgram = (audience = PrayerAudience.WORKERS): PrayerProgram =>
  ({ id: PROGRAM_ID, name: 'Test Program', audience, isActive: true }) as any;

const makeWorker = (id: string): WorkerProfile =>
  ({ id, status: WorkerStatusEnum.ACTIVE }) as WorkerProfile;

const makeMeeting = (
  id: string,
  capacity = 0,
  maxCapacity = 10,
): PrayerMeeting =>
  ({
    id,
    date: '2026-07-01',
    month: 7,
    year: 2026,
    status: PrayerMeetingStatus.SCHEDULED,
    selectionStatus: PrayerWindowStatus.OPEN,
    currentCapacity: capacity,
    dayConfig: { id: 'dc-1', maxCapacity },
    rosterEntries: [],
    program: makeProgram(),
  }) as any;

const baseRules: PrayerScheduleRule[] = [
  {
    id: 'r1',
    type: PrayerRuleType.ROLE_FREQUENCY,
    targetLeadType: null,
    value: 1,
    description: 'worker default',
    isActive: true,
  } as any,
  {
    id: 'r2',
    type: PrayerRuleType.ROLE_FREQUENCY,
    targetLeadType: DepartmentLeadTypeEnum.HOD,
    value: 2,
    description: 'HOD',
    isActive: true,
  } as any,
  {
    id: 'r3',
    type: PrayerRuleType.ROLE_FREQUENCY,
    targetLeadType: DepartmentLeadTypeEnum.D_HOD,
    value: 2,
    description: 'D.HOD',
    isActive: true,
  } as any,
  {
    id: 'r4',
    type: PrayerRuleType.MIN_LEADERS_PER_MEETING,
    targetLeadType: null,
    value: 1,
    description: 'min leaders',
    isActive: true,
  } as any,
  {
    id: 'r5',
    type: PrayerRuleType.MAX_PER_MEETING,
    targetLeadType: null,
    value: 10,
    description: 'max per meeting',
    isActive: true,
  } as any,
];

const mockMeetingQueryBuilder = {
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
};
const mockMeetingRepo = {
  find: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue(mockMeetingQueryBuilder),
};
const mockRosterRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  delete: jest.fn(),
};
const mockRuleRepo = { find: jest.fn() };
const mockProgramRepo = { findOne: jest.fn() };
const mockWorkerRepo = { find: jest.fn(), findOne: jest.fn() };
const mockMemberRepo = { findOne: jest.fn() };
const mockDeptLeadRepo = { find: jest.fn(), findOne: jest.fn() };

describe('PrayerRosterService', () => {
  let service: PrayerRosterService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrayerRosterService,
        { provide: getRepositoryToken(PrayerMeeting), useValue: mockMeetingRepo },
        { provide: getRepositoryToken(PrayerRosterEntry), useValue: mockRosterRepo },
        { provide: getRepositoryToken(PrayerScheduleRule), useValue: mockRuleRepo },
        { provide: getRepositoryToken(PrayerProgram), useValue: mockProgramRepo },
        { provide: getRepositoryToken(WorkerProfile), useValue: mockWorkerRepo },
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        { provide: getRepositoryToken(DepartmentLead), useValue: mockDeptLeadRepo },
        {
          provide: PushNotificationService,
          useValue: { dispatchToWorkerProfileIds: jest.fn(), dispatchToMemberIds: jest.fn() },
        },
      ],
    }).compile();
    service = module.get<PrayerRosterService>(PrayerRosterService);
  });

  // Helper: set up the standard happy-path mocks for autoAssign.
  // meetingRepo.find is called twice: once for scheduled meetings (with rosterEntries),
  // once for fresh meetings after capacity reset (with dayConfig only).
  const setupAutoAssign = (
    meetings: PrayerMeeting[],
    existingEntries: any[] = [],
    workers: WorkerProfile[] = [],
    leads: any[] = [],
  ) => {
    mockProgramRepo.findOne.mockResolvedValue(makeProgram());
    // 1st find: meetings with rosterEntries (for capacity reset)
    mockMeetingRepo.find
      .mockResolvedValueOnce(meetings)
      // 2nd find: fresh meetings after cleanup
      .mockResolvedValueOnce(meetings);
    // rosterRepo.find: first call for AUTO_ASSIGNED cleanup, second for existingEntries
    mockRosterRepo.find
      .mockResolvedValueOnce([]) // no existing auto-assigned to clear
      .mockResolvedValueOnce(existingEntries);
    mockRuleRepo.find.mockResolvedValue(baseRules);
    mockWorkerRepo.find.mockResolvedValue(workers);
    mockDeptLeadRepo.find.mockResolvedValue(leads);
    mockRosterRepo.save.mockResolvedValue([]);
    mockMeetingRepo.save.mockResolvedValue([]);
  };

  describe('autoAssign', () => {
    it('throws NotFoundException when no meetings exist', async () => {
      mockProgramRepo.findOne.mockResolvedValue(makeProgram());
      mockMeetingRepo.find.mockResolvedValue([]);
      await expect(service.autoAssign(PROGRAM_ID, 7, 2026)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException for MEMBERS-only programs', async () => {
      mockProgramRepo.findOne.mockResolvedValue(makeProgram(PrayerAudience.MEMBERS));
      await expect(service.autoAssign(PROGRAM_ID, 7, 2026)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('assigns regular workers exactly once', async () => {
      const worker = makeWorker('w1');
      const meeting = makeMeeting('m1');
      setupAutoAssign([meeting], [], [worker]);

      const result = await service.autoAssign(PROGRAM_ID, 7, 2026);
      expect(result.assigned).toBe(1);
      expect(mockRosterRepo.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            workerProfile: worker,
            meeting,
            assignmentType: PrayerAssignmentType.AUTO_ASSIGNED,
          }),
        ]),
      );
    });

    it('assigns HODs exactly twice across two meetings', async () => {
      const hod = makeWorker('hod1');
      const meetings = [makeMeeting('m1'), makeMeeting('m2')];
      setupAutoAssign(meetings, [], [hod], [
        { workerProfile: hod, leadType: DepartmentLeadTypeEnum.HOD },
      ]);

      const result = await service.autoAssign(PROGRAM_ID, 7, 2026);
      expect(result.assigned).toBe(2);
    });

    it('skips workers already at required frequency', async () => {
      const worker = makeWorker('w1');
      const meeting = makeMeeting('m1', 1);
      const existingEntry = {
        workerProfile: worker,
        meeting,
        assignmentType: PrayerAssignmentType.FIXED,
      };
      setupAutoAssign([meeting], [existingEntry], [worker]);

      const result = await service.autoAssign(PROGRAM_ID, 7, 2026);
      expect(result.assigned).toBe(0);
    });

    it('does not assign a worker to the same meeting twice', async () => {
      const worker = makeWorker('hod1');
      const meeting = makeMeeting('m1');
      setupAutoAssign([meeting], [], [worker], [
        { workerProfile: worker, leadType: DepartmentLeadTypeEnum.HOD },
      ]);

      const result = await service.autoAssign(PROGRAM_ID, 7, 2026);
      const savedEntries: any[] = mockRosterRepo.save.mock.calls[0]?.[0] ?? [];
      const forMeeting = savedEntries.filter(
        (e: any) => e.meeting?.id === 'm1',
      );
      expect(forMeeting.length).toBe(1);
      expect(result.unassignable).toContain('hod1');
    });

    it('marks worker as unassignable when all meetings are full', async () => {
      const worker = makeWorker('w1');
      const meeting = makeMeeting('m1', 10, 10);
      setupAutoAssign([meeting], [], [worker]);

      const result = await service.autoAssign(PROGRAM_ID, 7, 2026);
      expect(result.unassignable).toContain('w1');
    });

    it('clears existing AUTO_ASSIGNED entries before re-running (idempotency)', async () => {
      const worker = makeWorker('w1');
      const meeting = makeMeeting('m1');
      const existingAuto = [{ id: 'old-entry', workerProfile: worker, meeting }];

      mockProgramRepo.findOne.mockResolvedValue(makeProgram());
      // 1st find: meetings with rosterEntries
      mockMeetingRepo.find
        .mockResolvedValueOnce([{ ...meeting, rosterEntries: existingAuto }])
        .mockResolvedValueOnce([meeting]);
      // 1st rosterRepo.find: existing AUTO_ASSIGNED to delete
      mockRosterRepo.find
        .mockResolvedValueOnce(existingAuto)
        .mockResolvedValueOnce([]);
      mockRosterRepo.delete = jest.fn().mockResolvedValue({ affected: 1 });
      mockRuleRepo.find.mockResolvedValue(baseRules);
      mockWorkerRepo.find.mockResolvedValue([worker]);
      mockDeptLeadRepo.find.mockResolvedValue([]);
      mockRosterRepo.save.mockResolvedValue([]);
      mockMeetingRepo.save.mockResolvedValue([]);

      await service.autoAssign(PROGRAM_ID, 7, 2026);
      expect(mockRosterRepo.delete).toHaveBeenCalledWith(['old-entry']);
    });
  });

  describe('manualAssign', () => {
    it('throws BadRequestException when neither workerProfileId nor memberId provided', async () => {
      await expect(
        service.manualAssign(PROGRAM_ID, { meetingId: 'm1' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when meeting not found', async () => {
      mockMeetingRepo.findOne = jest.fn().mockResolvedValue(null);
      await expect(
        service.manualAssign(PROGRAM_ID, { meetingId: 'm1', workerProfileId: 'w1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('assigns a worker to a meeting and increments capacity', async () => {
      const worker = makeWorker('w1');
      const meeting = { ...makeMeeting('m1'), program: makeProgram() };
      mockMeetingRepo.findOne = jest.fn().mockResolvedValue(meeting);
      mockWorkerRepo.findOne = jest.fn().mockResolvedValue(worker);
      mockRosterRepo.findOne = jest.fn().mockResolvedValue(null);
      const entry = { id: 'e1', workerProfile: worker, meeting, assignmentType: PrayerAssignmentType.MANUAL };
      mockRosterRepo.create = jest.fn().mockReturnValue(entry);
      mockRosterRepo.save = jest.fn().mockResolvedValue(entry);
      mockMeetingRepo.save = jest.fn().mockResolvedValue(meeting);

      const result = await service.manualAssign(PROGRAM_ID, {
        meetingId: 'm1',
        workerProfileId: 'w1',
      });
      expect(result.assignmentType).toBe(PrayerAssignmentType.MANUAL);
      expect(mockMeetingRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ currentCapacity: 1 }),
      );
    });
  });

  describe('removeEntry', () => {
    it('throws NotFoundException when entry not found', async () => {
      mockRosterRepo.findOne = jest.fn().mockResolvedValue(null);
      await expect(service.removeEntry('missing')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for FIXED entries', async () => {
      mockRosterRepo.findOne = jest.fn().mockResolvedValue({
        id: 'e1',
        assignmentType: PrayerAssignmentType.FIXED,
        status: PrayerRosterStatus.SCHEDULED,
        meeting: makeMeeting('m1'),
      });
      await expect(service.removeEntry('e1')).rejects.toThrow(BadRequestException);
    });

    it('deletes the entry and decrements meeting capacity', async () => {
      const meeting = makeMeeting('m1', 2);
      mockRosterRepo.findOne = jest.fn().mockResolvedValue({
        id: 'e1',
        assignmentType: PrayerAssignmentType.AUTO_ASSIGNED,
        status: PrayerRosterStatus.SCHEDULED,
        meeting,
      });
      mockRosterRepo.delete = jest.fn().mockResolvedValue({ affected: 1 });
      mockMeetingRepo.findOne = jest.fn().mockResolvedValue(meeting);
      mockMeetingRepo.save = jest.fn().mockResolvedValue(undefined);

      await service.removeEntry('e1');
      expect(mockRosterRepo.delete).toHaveBeenCalledWith('e1');
      expect(mockMeetingRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ currentCapacity: 1 }),
      );
    });
  });

  describe('reschedule', () => {
    it('throws NotFoundException when entry does not exist', async () => {
      mockRosterRepo.findOne = jest.fn().mockResolvedValue(null);
      await expect(
        service.reschedule('missing', { newMeetingId: 'm2' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when target meeting is full', async () => {
      const entry = {
        id: 'e1',
        workerProfile: makeWorker('w1'),
        member: null,
        meeting: makeMeeting('m1'),
        assignmentType: PrayerAssignmentType.SELF_SELECTED,
        status: PrayerRosterStatus.SCHEDULED,
      };
      const fullMeeting = makeMeeting('m2', 10, 10);

      mockRosterRepo.findOne = jest
        .fn()
        .mockResolvedValueOnce(entry)
        .mockResolvedValueOnce(null);
      mockMeetingRepo.findOne = jest.fn().mockResolvedValue(fullMeeting);

      await expect(
        service.reschedule('e1', { newMeetingId: 'm2' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a new entry linked to rescheduledFrom and soft-deletes the old one', async () => {
      const worker = makeWorker('w1');
      const oldMeeting = makeMeeting('m1', 1);
      const newMeeting = makeMeeting('m2', 0);
      const entry = {
        id: 'e1',
        workerProfile: worker,
        member: null,
        meeting: oldMeeting,
        assignmentType: PrayerAssignmentType.SELF_SELECTED,
        status: PrayerRosterStatus.SCHEDULED,
      };
      const savedEntry = {
        ...entry,
        id: 'e2',
        meeting: newMeeting,
        rescheduledFrom: entry,
      };

      mockRosterRepo.findOne = jest
        .fn()
        .mockResolvedValueOnce(entry)
        .mockResolvedValueOnce(null);
      mockMeetingRepo.findOne = jest
        .fn()
        .mockResolvedValueOnce(newMeeting)
        .mockResolvedValueOnce(oldMeeting);
      mockRosterRepo.create = jest.fn().mockReturnValue(savedEntry);
      mockRosterRepo.save = jest
        .fn()
        .mockResolvedValueOnce(savedEntry)
        .mockResolvedValueOnce({
          ...entry,
          status: PrayerRosterStatus.RESCHEDULED,
        });
      mockMeetingRepo.save = jest.fn().mockResolvedValue(undefined);

      const result = await service.reschedule('e1', { newMeetingId: 'm2' });
      expect(mockRosterRepo.save).toHaveBeenCalledTimes(2);
      expect(entry.status).toBe(PrayerRosterStatus.RESCHEDULED);
      expect(result.rescheduledFrom).toEqual(entry);
    });
  });

  describe('validateRoster', () => {
    it('returns valid when all workers have exact frequency and all meetings have a leader', async () => {
      const worker = makeWorker('w1');
      const hod = makeWorker('hod1');
      const meeting = {
        ...makeMeeting('m1'),
        rosterEntries: [{ workerProfile: worker }, { workerProfile: hod }],
      };

      mockRuleRepo.find.mockResolvedValue(baseRules);
      mockWorkerRepo.find.mockResolvedValue([worker, hod]);
      mockDeptLeadRepo.find.mockResolvedValue([
        { workerProfile: hod, leadType: DepartmentLeadTypeEnum.HOD },
      ]);
      mockRosterRepo.find.mockResolvedValue([
        { workerProfile: worker, meeting },
        { workerProfile: hod, meeting },
        { workerProfile: hod, meeting: makeMeeting('m2') },
      ]);
      mockMeetingQueryBuilder.getMany.mockResolvedValue([meeting]);

      const result = await service.validateRoster(PROGRAM_ID, 7, 2026);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('reports issue when a worker has wrong frequency', async () => {
      const worker = makeWorker('w1');
      const meeting = {
        ...makeMeeting('m1'),
        rosterEntries: [{ workerProfile: worker }],
      };

      mockRuleRepo.find.mockResolvedValue(baseRules);
      mockWorkerRepo.find.mockResolvedValue([worker]);
      mockDeptLeadRepo.find.mockResolvedValue([]);
      mockRosterRepo.find.mockResolvedValue([]);
      mockMeetingQueryBuilder.getMany.mockResolvedValue([meeting]);

      const result = await service.validateRoster(PROGRAM_ID, 7, 2026);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes('w1'))).toBe(true);
    });
  });
});
