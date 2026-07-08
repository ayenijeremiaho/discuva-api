import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { addHours, subHours } from 'date-fns';
import { AttendanceService } from './attendance.service';
import { Attendance } from '../entity/attendance.entity';
import { AttendanceStatusEnum } from '../enums/check-in.enum';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { MemberService } from '../../member/service/member.service';
import { EventService } from '../../event/service/event.service';
import { UtilityService } from '../../utility/service/utility.service';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { WorkerStatusEnum } from '../../member/enums/worker-status.enum';
import { DepartmentService } from '../../department/service/department.service';
import { DateService } from '../../utility/service/date.service';
import { CacheService } from '../../utility/service/cache.service';
import { SessionSurface } from '../../auth/enum/session-surface.enum';
import { getQueueToken } from '@nestjs/bull';
import { FOLLOW_UP_QUEUE } from '../../follow-up/processor/post-event.processor';

const mockFollowUpQueue = {
  add: jest.fn().mockResolvedValue({ id: 'job-1' }),
};

const mockCacheService = {
  key: jest.fn().mockImplementation((ns: string, id: string) => `${ns}:${id}`),
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
};

const makeQb = () => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  innerJoinAndSelect: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  addOrderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn(),
  getMany: jest.fn(),
  getOne: jest.fn(),
  getRawMany: jest.fn(),
  getRawOne: jest.fn(),
  getCount: jest.fn(),
});

const mockAttendanceRepo = {
  save: jest.fn(),
  create: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockSlotRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
};

const mockMemberService = {
  getById: jest.fn(),
  count: jest.fn(),
  getMembersNotCheckedInForEvent: jest.fn(),
  getWorkersNotCheckedInForEvent: jest.fn(),
};

const mockEventService = {
  resolveSlotConfig: jest.fn(),
  findEventsReadyForAbsenceMarking: jest.fn(),
};

const mockConfigService = {
  get: jest.fn(),
};

const mockDataSource = {
  transaction: jest.fn(),
  createQueryBuilder: jest.fn(),
  query: jest.fn(),
};

const mockDepartmentService = {
  getDepartmentIdForLead: jest.fn(),
  getWorkersInDepartment: jest.fn(),
  isMemberDepartmentLead: jest.fn(),
};

const defaultVenue = {
  id: 'venue-1',
  name: 'Main Auditorium',
  latitude: 6.5244,
  longitude: 3.3792,
};

const defaultConfig = {
  workerCheckinStartOffsetSeconds: -7200,
  workerLateOffsetSeconds: 0,
  memberCheckinStartOffsetSeconds: -3600,
  checkinStopOffsetSeconds: 7200,
  venue: defaultVenue,
  allowedDistanceInMeters: 100,
};

const defaultLocation = { latitude: 6.5244, longitude: 3.3792 };

function makeSlot(startTime: Date): any {
  return {
    id: 'slot-1',
    name: 'Sunday Service',
    startTime,
    endTime: addHours(startTime, 3),
    event: { id: 'event-1', name: 'Sunday Service' },
    config: {
      workerCheckinStartOffsetSeconds: -7200,
      workerLateOffsetSeconds: 0,
      memberCheckinStartOffsetSeconds: -3600,
      checkinStopOffsetSeconds: 7200,
      allowedDistanceInMeters: 100,
      defaultVenue,
    },
    venueOverride: null,
    workerCheckinStartOverride: null,
    workerLateOverride: null,
    memberCheckinStartOverride: null,
    checkinStopOverride: null,
    allowedDistanceOverride: null,
  };
}

describe('AttendanceService', () => {
  let service: AttendanceService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.restoreAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        {
          provide: getRepositoryToken(Attendance),
          useValue: mockAttendanceRepo,
        },
        { provide: getRepositoryToken(ServiceSlot), useValue: mockSlotRepo },
        { provide: MemberService, useValue: mockMemberService },
        { provide: EventService, useValue: mockEventService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: DataSource, useValue: mockDataSource },
        { provide: DepartmentService, useValue: mockDepartmentService },
        {
          provide: UtilityService,
          useValue: { sendEmailWithTemplate: jest.fn() },
        },
        { provide: DateService, useValue: new DateService() },
        { provide: CacheService, useValue: mockCacheService },
        {
          provide: getQueueToken(FOLLOW_UP_QUEUE),
          useValue: mockFollowUpQueue,
        },
      ],
    }).compile();

    service = module.get<AttendanceService>(AttendanceService);
  });

  describe('checkin', () => {
    const user = {
      id: 'member-1',
      role: MemberRoleEnum.MEMBER,
      requiresPasswordChange: false,
      surface: SessionSurface.MEMBER,
    };
    const dto = { serviceSlotId: 'slot-1' };

    it('should throw NotFoundException if slot not found', async () => {
      mockSlotRepo.findOne.mockResolvedValue(null);

      await expect(service.checkin(user, dto as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if member is inactive', async () => {
      const now = new Date();
      const slot = makeSlot(addHours(now, 1));
      mockSlotRepo.findOne.mockResolvedValue(slot);
      mockMemberService.getById.mockResolvedValue({
        id: 'member-1',
        role: MemberRoleEnum.MEMBER,
        status: MemberStatusEnum.INACTIVE,
        workerProfile: null,
      });
      mockEventService.resolveSlotConfig.mockReturnValue(defaultConfig);

      await expect(service.checkin(user, dto as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if worker does not provide location', async () => {
      const now = new Date();
      const slot = makeSlot(addHours(now, 1));
      mockSlotRepo.findOne.mockResolvedValue(slot);
      mockMemberService.getById.mockResolvedValue({
        id: 'worker-1',
        role: MemberRoleEnum.WORKER,
        status: MemberStatusEnum.ACTIVE,
        workerProfile: { id: 'wp-1', status: WorkerStatusEnum.ACTIVE },
      });

      await expect(
        service.checkin(
          { ...user, id: 'worker-1', role: MemberRoleEnum.WORKER },
          { serviceSlotId: 'slot-1' } as any,
        ),
      ).rejects.toThrow('Workers must provide their location to check in.');
    });

    it('should throw BadRequestException if member already checked in', async () => {
      const now = new Date();
      const slot = makeSlot(addHours(now, 1));
      mockSlotRepo.findOne.mockResolvedValue(slot);
      mockMemberService.getById.mockResolvedValue({
        id: 'member-1',
        role: MemberRoleEnum.MEMBER,
        status: MemberStatusEnum.ACTIVE,
        workerProfile: null,
      });
      mockEventService.resolveSlotConfig.mockReturnValue(defaultConfig);
      mockAttendanceRepo.findOne.mockResolvedValue({
        id: 'att-1',
        status: AttendanceStatusEnum.PRESENT,
        checkinTime: new Date(),
      });

      await expect(service.checkin(user, dto as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should mark PRESENT for a regular member checking in within window', async () => {
      const now = new Date();
      const startTime = addHours(now, 1);
      const slot = makeSlot(startTime);

      mockSlotRepo.findOne.mockResolvedValue(slot);
      mockMemberService.getById.mockResolvedValue({
        id: 'member-1',
        role: MemberRoleEnum.MEMBER,
        status: MemberStatusEnum.ACTIVE,
        workerProfile: null,
      });
      mockEventService.resolveSlotConfig.mockReturnValue(defaultConfig);
      mockAttendanceRepo.findOne.mockResolvedValue(null);
      mockAttendanceRepo.create.mockReturnValue({
        status: AttendanceStatusEnum.PRESENT,
      });
      mockAttendanceRepo.save.mockResolvedValue({
        id: 'att-1',
        status: AttendanceStatusEnum.PRESENT,
      });
      mockConfigService.get.mockReturnValue('false');

      const result = await service.checkin(
        {
          id: 'member-1',
          role: MemberRoleEnum.MEMBER,
          requiresPasswordChange: false,
          surface: SessionSurface.MEMBER,
        },
        dto as any,
      );

      expect(result).toEqual({ message: 'Check-in successful' });
      expect(mockAttendanceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: AttendanceStatusEnum.PRESENT }),
      );
    });

    it('should save event reference on checkin record', async () => {
      const now = new Date();
      const startTime = addHours(now, 1);
      const slot = makeSlot(startTime);

      mockSlotRepo.findOne.mockResolvedValue(slot);
      mockMemberService.getById.mockResolvedValue({
        id: 'member-1',
        role: MemberRoleEnum.MEMBER,
        status: MemberStatusEnum.ACTIVE,
        workerProfile: null,
      });
      mockEventService.resolveSlotConfig.mockReturnValue(defaultConfig);
      mockAttendanceRepo.findOne.mockResolvedValue(null);
      mockAttendanceRepo.create.mockReturnValue({});
      mockAttendanceRepo.save.mockResolvedValue({ id: 'att-1' });
      mockConfigService.get.mockReturnValue('false');

      await service.checkin(
        {
          id: 'member-1',
          role: MemberRoleEnum.MEMBER,
          requiresPasswordChange: false,
          surface: SessionSurface.MEMBER,
        },
        dto as any,
      );

      expect(mockAttendanceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ event: slot.event, serviceSlot: slot }),
      );
    });

    it('should mark PRESENT for worker checking in before late threshold with location', async () => {
      const now = new Date();
      const startTime = addHours(now, 1);
      const slot = makeSlot(startTime);

      mockSlotRepo.findOne.mockResolvedValue(slot);
      mockMemberService.getById.mockResolvedValue({
        id: 'worker-1',
        role: MemberRoleEnum.WORKER,
        status: MemberStatusEnum.ACTIVE,
        workerProfile: {
          id: 'wp-1',
          status: WorkerStatusEnum.ACTIVE,
          department: { id: 'dept-1' },
        },
      });
      mockEventService.resolveSlotConfig.mockReturnValue(defaultConfig);
      mockAttendanceRepo.findOne.mockResolvedValue(null);
      mockAttendanceRepo.create.mockReturnValue({
        status: AttendanceStatusEnum.PRESENT,
      });
      mockAttendanceRepo.save.mockResolvedValue({
        id: 'att-1',
        status: AttendanceStatusEnum.PRESENT,
      });
      mockConfigService.get.mockReturnValue('false');

      const result = await service.checkin(
        {
          id: 'worker-1',
          role: MemberRoleEnum.WORKER,
          requiresPasswordChange: false,
          surface: SessionSurface.MEMBER,
        },
        { serviceSlotId: 'slot-1', location: defaultLocation } as any,
      );

      expect(result).toEqual({ message: 'Check-in successful' });
      expect(mockAttendanceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: AttendanceStatusEnum.PRESENT }),
      );
    });

    it('should mark LATE for worker checking in after late threshold', async () => {
      const now = new Date();
      const startTime = subHours(now, 1);
      const cfg = { ...defaultConfig, workerLateOffsetSeconds: 0 };
      const slot = makeSlot(startTime);

      mockSlotRepo.findOne.mockResolvedValue(slot);
      mockMemberService.getById.mockResolvedValue({
        id: 'worker-1',
        role: MemberRoleEnum.WORKER,
        status: MemberStatusEnum.ACTIVE,
        workerProfile: {
          id: 'wp-1',
          status: WorkerStatusEnum.ACTIVE,
          department: { id: 'dept-1' },
        },
      });
      mockEventService.resolveSlotConfig.mockReturnValue(cfg);
      mockAttendanceRepo.findOne.mockResolvedValue(null);
      mockAttendanceRepo.create.mockReturnValue({
        status: AttendanceStatusEnum.LATE,
      });
      mockAttendanceRepo.save.mockResolvedValue({
        id: 'att-1',
        status: AttendanceStatusEnum.LATE,
      });
      mockConfigService.get.mockReturnValue('false');

      const result = await service.checkin(
        {
          id: 'worker-1',
          role: MemberRoleEnum.WORKER,
          requiresPasswordChange: false,
          surface: SessionSurface.MEMBER,
        },
        { serviceSlotId: 'slot-1', location: defaultLocation } as any,
      );

      expect(result).toEqual({ message: 'Check-in successful' });
      expect(mockAttendanceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: AttendanceStatusEnum.LATE }),
      );
    });
  });

  describe('markAbsentees', () => {
    it('should do nothing when no events are ready', async () => {
      mockEventService.findEventsReadyForAbsenceMarking.mockResolvedValue([]);

      await service.markAbsentees();

      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('should create absence records per event and mark event as processed', async () => {
      const event = {
        id: 'event-1',
        name: 'Sunday Service',
        eventDate: new Date('2026-06-01'),
      };
      mockEventService.findEventsReadyForAbsenceMarking.mockResolvedValue([
        event,
      ]);

      const absentMembers = [{ id: 'member-2' }];
      const absentWorkers = [{ id: 'worker-2' }];
      mockMemberService.getMembersNotCheckedInForEvent.mockResolvedValue(
        absentMembers,
      );
      mockMemberService.getWorkersNotCheckedInForEvent.mockResolvedValue(
        absentWorkers,
      );

      const managerSave = jest.fn().mockResolvedValue(undefined);
      const managerUpdate = jest.fn().mockResolvedValue(undefined);
      mockDataSource.transaction.mockImplementation(async (cb: any) => {
        await cb({
          save: managerSave,
          update: managerUpdate,
          createQueryBuilder: () => makeQb(),
        });
      });
      // mock leave query (no workers on leave)
      mockDataSource.createQueryBuilder = jest.fn().mockReturnValue({
        ...makeQb(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      await service.markAbsentees();

      expect(managerSave).toHaveBeenCalledWith(
        Attendance,
        expect.arrayContaining([
          expect.objectContaining({
            event,
            status: AttendanceStatusEnum.ABSENT,
            roleAtCheckin: MemberRoleEnum.MEMBER,
          }),
          expect.objectContaining({
            event,
            status: AttendanceStatusEnum.ABSENT,
            roleAtCheckin: MemberRoleEnum.WORKER,
          }),
        ]),
      );
      expect(managerUpdate).toHaveBeenCalledWith(expect.anything(), 'event-1', {
        attendanceMarked: true,
      });
    });

    it('should mark worker ON_LEAVE when approved leave covers event date', async () => {
      const eventDate = new Date('2026-06-01');
      const event = { id: 'event-1', name: 'Sunday Service', eventDate };
      mockEventService.findEventsReadyForAbsenceMarking.mockResolvedValue([
        event,
      ]);

      mockMemberService.getMembersNotCheckedInForEvent.mockResolvedValue([]);
      mockMemberService.getWorkersNotCheckedInForEvent.mockResolvedValue([
        { id: 'worker-2' },
      ]);

      const managerSave = jest.fn().mockResolvedValue(undefined);
      const managerUpdate = jest.fn().mockResolvedValue(undefined);
      mockDataSource.transaction.mockImplementation(async (cb: any) => {
        await cb({ save: managerSave, update: managerUpdate });
      });
      mockDataSource.createQueryBuilder = jest.fn().mockReturnValue({
        ...makeQb(),
        getRawMany: jest.fn().mockResolvedValue([{ memberId: 'worker-2' }]),
      });

      await service.markAbsentees();

      expect(managerSave).toHaveBeenCalledWith(
        Attendance,
        expect.arrayContaining([
          expect.objectContaining({ status: AttendanceStatusEnum.ON_LEAVE }),
        ]),
      );
    });
  });

  describe('getAttendanceStreak', () => {
    it('should return streak count for consecutive PRESENT/LATE records', async () => {
      mockAttendanceRepo.find.mockResolvedValue([
        { status: AttendanceStatusEnum.PRESENT },
        { status: AttendanceStatusEnum.LATE },
        { status: AttendanceStatusEnum.PRESENT },
      ]);

      const streak = await service.getAttendanceStreak(
        'member-1',
        MemberRoleEnum.MEMBER,
      );

      expect(streak).toBe(3);
    });

    it('should break streak on ABSENT record', async () => {
      mockAttendanceRepo.find.mockResolvedValue([
        { status: AttendanceStatusEnum.PRESENT },
        { status: AttendanceStatusEnum.ABSENT },
        { status: AttendanceStatusEnum.PRESENT },
      ]);

      const streak = await service.getAttendanceStreak(
        'member-1',
        MemberRoleEnum.MEMBER,
      );

      expect(streak).toBe(1);
    });

    it('should skip ON_LEAVE records without breaking the streak', async () => {
      mockAttendanceRepo.find.mockResolvedValue([
        { status: AttendanceStatusEnum.PRESENT },
        { status: AttendanceStatusEnum.ON_LEAVE },
        { status: AttendanceStatusEnum.LATE },
        { status: AttendanceStatusEnum.ON_LEAVE },
        { status: AttendanceStatusEnum.PRESENT },
      ]);

      const streak = await service.getAttendanceStreak(
        'member-1',
        MemberRoleEnum.MEMBER,
      );

      expect(streak).toBe(3);
    });

    it('should return 0 for empty record list', async () => {
      mockAttendanceRepo.find.mockResolvedValue([]);

      const streak = await service.getAttendanceStreak(
        'member-1',
        MemberRoleEnum.MEMBER,
      );

      expect(streak).toBe(0);
    });

    it('should return 0 when most recent record is ABSENT', async () => {
      mockAttendanceRepo.find.mockResolvedValue([
        { status: AttendanceStatusEnum.ABSENT },
        { status: AttendanceStatusEnum.PRESENT },
      ]);

      const streak = await service.getAttendanceStreak(
        'member-1',
        MemberRoleEnum.MEMBER,
      );

      expect(streak).toBe(0);
    });
  });

  describe('getMemberRank', () => {
    it('returns 1 when no other member scored higher', async () => {
      const qb = makeQb();
      qb.getRawOne.mockResolvedValue({ score: '5' });
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(qb);
      mockDataSource.query.mockResolvedValue([{ count: '0' }]);

      const rank = await service.getMemberRank(
        'member-1',
        30,
        MemberRoleEnum.MEMBER,
      );
      expect(rank).toBe(1);
    });

    it('returns correct rank when others scored higher', async () => {
      const qb = makeQb();
      qb.getRawOne.mockResolvedValue({ score: '3' });
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(qb);
      mockDataSource.query.mockResolvedValue([{ count: '4' }]);

      const rank = await service.getMemberRank(
        'member-1',
        30,
        MemberRoleEnum.MEMBER,
      );
      expect(rank).toBe(5);
    });

    it('returns rank 1 when member has no attendance (score 0)', async () => {
      const qb = makeQb();
      qb.getRawOne.mockResolvedValue({ score: '0' });
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(qb);
      mockDataSource.query.mockResolvedValue([{ count: '0' }]);

      const rank = await service.getMemberRank(
        'member-1',
        30,
        MemberRoleEnum.WORKER,
      );
      expect(rank).toBe(1);
    });
  });

  describe('correctAttendance', () => {
    it('should throw NotFoundException if record not found', async () => {
      mockAttendanceRepo.findOne.mockResolvedValue(null);

      await expect(
        service.correctAttendance(
          'att-1',
          AttendanceStatusEnum.PRESENT,
          'admin-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update the status and return the saved record', async () => {
      const existing = {
        id: 'att-1',
        status: AttendanceStatusEnum.ABSENT,
        member: { id: 'member-1' },
        event: { id: 'event-1' },
      };
      const updated = { ...existing, status: AttendanceStatusEnum.PRESENT };

      mockAttendanceRepo.findOne.mockResolvedValue(existing);
      mockAttendanceRepo.save.mockResolvedValue(updated);

      const result = await service.correctAttendance(
        'att-1',
        AttendanceStatusEnum.PRESENT,
        'admin-1',
      );

      expect(result.status).toBe(AttendanceStatusEnum.PRESENT);
      expect(mockAttendanceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: AttendanceStatusEnum.PRESENT }),
      );
    });
  });

  describe('getMyHistory', () => {
    it('should throw BadRequestException if page < 1', async () => {
      await expect(
        service.getMyHistory(
          {
            id: 'member-1',
            role: MemberRoleEnum.MEMBER,
            requiresPasswordChange: false,
            surface: SessionSurface.MEMBER,
          },
          0,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return paginated attendance history', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[{ id: 'att-1' }], 1]);
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(qb);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [{ id: 'att-1' } as any],
        page: 1,
        limit: 10,
        totalCount: 1,
        totalPages: 1,
      });

      const result = await service.getMyHistory(
        {
          id: 'member-1',
          role: MemberRoleEnum.MEMBER,
          requiresPasswordChange: false,
          surface: SessionSurface.MEMBER,
        },
        1,
        10,
      );

      expect(result.data).toHaveLength(1);
      expect(result.page).toBe(1);
    });

    it('should join event directly on attendance so absent records include event data', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(qb);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [],
        page: 1,
        limit: 10,
        totalCount: 0,
        totalPages: 1,
      });

      await service.getMyHistory(
        {
          id: 'member-1',
          role: MemberRoleEnum.MEMBER,
          requiresPasswordChange: false,
          surface: SessionSurface.MEMBER,
        },
        1,
        10,
      );

      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
        'attendance.event',
        'event',
      );
    });

    it('should apply status filter when provided', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(qb);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [],
        page: 1,
        limit: 10,
        totalCount: 0,
        totalPages: 1,
      });

      await service.getMyHistory(
        {
          id: 'member-1',
          role: MemberRoleEnum.MEMBER,
          requiresPasswordChange: false,
          surface: SessionSurface.MEMBER,
        },
        1,
        10,
        AttendanceStatusEnum.PRESENT,
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('attendance.status'),
        expect.objectContaining({ status: AttendanceStatusEnum.PRESENT }),
      );
    });
  });

  describe('getAllHistory', () => {
    it('should join event directly on attendance so absent records include event data', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(qb);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [],
        page: 1,
        limit: 10,
        totalCount: 0,
        totalPages: 1,
      });

      await service.getAllHistory(1, 10);

      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
        'attendance.event',
        'event',
      );
    });

    it('should throw BadRequestException if page < 1', async () => {
      await expect(service.getAllHistory(0)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should apply memberId filter when provided', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(qb);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [],
        page: 1,
        limit: 10,
        totalCount: 0,
        totalPages: 1,
      });

      await service.getAllHistory(1, 10, 'member-1');

      expect(qb.andWhere).toHaveBeenCalledWith('member.id = :memberId', {
        memberId: 'member-1',
      });
    });

    it('should apply ILIKE search filter across firstname, lastname, and email', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(qb);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [],
        page: 1,
        limit: 10,
        totalCount: 0,
        totalPages: 1,
      });

      await service.getAllHistory(
        1,
        10,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'john',
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        '(member.firstname ILIKE :search OR member.lastname ILIKE :search OR member.email ILIKE :search)',
        { search: '%john%' },
      );
    });

    it('should not apply search filter when search is undefined', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(qb);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [],
        page: 1,
        limit: 10,
        totalCount: 0,
        totalPages: 1,
      });

      await service.getAllHistory(1, 10);

      const ilikeCalls = (qb.andWhere as jest.Mock).mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('ILIKE'),
      );
      expect(ilikeCalls).toHaveLength(0);
    });

    it('should wrap search term in % wildcards for partial matching', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(qb);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [],
        page: 1,
        limit: 10,
        totalCount: 0,
        totalPages: 1,
      });

      await service.getAllHistory(
        1,
        10,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'doe',
      );

      const ilikeCall = (qb.andWhere as jest.Mock).mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('ILIKE'),
      );
      expect(ilikeCall[1]).toEqual({ search: '%doe%' });
    });
  });

  describe('getWorkerAttendancePercentage', () => {
    it('should return 0 if no workers exist', async () => {
      mockMemberService.count.mockResolvedValue(0);

      const result = await service.getWorkerAttendancePercentage(30);

      expect(result).toBe(0);
    });

    it('should calculate percentage based on attended workers', async () => {
      mockMemberService.count.mockResolvedValue(10);

      const qb = makeQb();
      qb.getRawOne.mockResolvedValue({ count: '8' });
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getWorkerAttendancePercentage(30);

      expect(result).toBe(80);
    });

    it('should cap percentage at 100 even if count exceeds total', async () => {
      mockMemberService.count.mockResolvedValue(5);

      const qb = makeQb();
      qb.getRawOne.mockResolvedValue({ count: '10' });
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getWorkerAttendancePercentage(30);

      expect(result).toBe(100);
    });
  });

  describe('getPersonalAttendancePercentage', () => {
    it('should return 0 if member has no attendance records in the period', async () => {
      const qb = makeQb();
      qb.getRawOne.mockResolvedValue({ total: '0', attended: '0' });
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getPersonalAttendancePercentage(
        'member-1',
        30,
      );

      expect(result).toBe(0);
    });

    it('should calculate ratio of present/late records to total', async () => {
      const qb = makeQb();
      qb.getRawOne.mockResolvedValue({ total: '10', attended: '8' });
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getPersonalAttendancePercentage(
        'member-1',
        30,
      );

      expect(result).toBe(80);
    });
  });

  describe('getDepartmentHistory', () => {
    const user = {
      id: 'member-1',
      role: MemberRoleEnum.WORKER,
      requiresPasswordChange: false,
      surface: SessionSurface.MEMBER,
    };

    it('should throw ForbiddenException if user is not a department lead', async () => {
      mockDepartmentService.getDepartmentIdForLead.mockResolvedValue(null);

      await expect(
        service.getDepartmentHistory(user, 'slot-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return attendance records filtered by department and slot', async () => {
      mockDepartmentService.getDepartmentIdForLead.mockResolvedValue('dept-1');
      const records = [{ id: 'att-1' }, { id: 'att-2' }];
      const qb = makeQb();
      qb.getMany.mockResolvedValue(records);
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getDepartmentHistory(user, 'slot-1');

      expect(result).toEqual(records);
      expect(qb.where).toHaveBeenCalledWith('dept.id = :deptId', {
        deptId: 'dept-1',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('slot.id = :slotId', {
        slotId: 'slot-1',
      });
    });
  });

  describe('getDepartmentEventAttendance', () => {
    const user = {
      id: 'member-1',
      role: MemberRoleEnum.WORKER,
      requiresPasswordChange: false,
      surface: SessionSurface.MEMBER,
    };

    it('should throw ForbiddenException if user is not a department lead', async () => {
      mockDepartmentService.getDepartmentIdForLead.mockResolvedValue(null);

      await expect(
        service.getDepartmentEventAttendance(user, 'event-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if event has no slots', async () => {
      mockDepartmentService.getDepartmentIdForLead.mockResolvedValue('dept-1');
      mockDepartmentService.getWorkersInDepartment.mockResolvedValue([]);
      mockSlotRepo.find = jest.fn().mockResolvedValue([]);

      await expect(
        service.getDepartmentEventAttendance(user, 'event-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return attendance matrix with null status for absent workers', async () => {
      mockDepartmentService.getDepartmentIdForLead.mockResolvedValue('dept-1');

      const event = { id: 'event-1', name: 'Sunday Service' };
      const slots = [
        {
          id: 'slot-1',
          name: 'First Service',
          startTime: new Date('2026-06-01T08:00:00'),
          event,
        },
        {
          id: 'slot-2',
          name: 'Second Service',
          startTime: new Date('2026-06-01T10:00:00'),
          event,
        },
      ];
      const workers = [
        {
          id: 'wp-1',
          member: { id: 'member-2', firstname: 'John', lastname: 'Doe' },
        },
      ];

      mockSlotRepo.find = jest.fn().mockResolvedValue(slots);
      mockDepartmentService.getWorkersInDepartment.mockResolvedValue(workers);
      mockAttendanceRepo.find = jest.fn().mockResolvedValue([
        {
          member: { id: 'member-2' },
          serviceSlot: { id: 'slot-1' },
          status: AttendanceStatusEnum.PRESENT,
          checkinTime: new Date('2026-06-01T07:55:00'),
        },
      ]);

      const result = await service.getDepartmentEventAttendance(
        user,
        'event-1',
      );

      expect(result.eventId).toBe('event-1');
      expect(result.eventName).toBe('Sunday Service');
      expect(result.slots).toHaveLength(2);
      expect(result.workers).toHaveLength(1);
      expect(result.workers[0].name).toBe('John Doe');
      expect(result.workers[0].attendance[0].status).toBe(
        AttendanceStatusEnum.PRESENT,
      );
      expect(result.workers[0].attendance[1].status).toBeNull();
    });

    it('should return empty workers array when department has no workers', async () => {
      mockDepartmentService.getDepartmentIdForLead.mockResolvedValue('dept-1');

      const slots = [
        {
          id: 'slot-1',
          name: 'Service',
          startTime: new Date(),
          event: { id: 'event-1', name: 'Test' },
        },
      ];
      mockSlotRepo.find = jest.fn().mockResolvedValue(slots);
      mockDepartmentService.getWorkersInDepartment.mockResolvedValue([]);

      const result = await service.getDepartmentEventAttendance(
        user,
        'event-1',
      );

      expect(result.workers).toHaveLength(0);
      expect(mockAttendanceRepo.find).not.toHaveBeenCalled();
    });
  });

  // ── getAtRiskMembers ──────────────────────────────────────────────────────

  describe('getAtRiskMembers', () => {
    beforeEach(() => {
      mockDataSource.query.mockReset();
    });

    it('throws BadRequestException when page < 1', async () => {
      await expect(
        service.getAtRiskMembers(3, undefined, undefined, 0, 20),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns paginated at-risk members with mapped fields', async () => {
      const dataRows = [
        {
          id: 'member-1',
          firstname: 'Ada',
          lastname: 'Obi',
          email: 'ada@test.com',
          phone_number: '08011111111',
          absence_count: '5',
          last_seen_at: new Date('2026-05-01'),
          has_open_task: true,
        },
      ];
      let callCount = 0;
      mockDataSource.query.mockImplementation(() => {
        callCount++;
        return callCount === 1
          ? Promise.resolve(dataRows)
          : Promise.resolve([{ total: '1' }]);
      });

      const result = await service.getAtRiskMembers(
        3,
        undefined,
        undefined,
        1,
        20,
      );
      expect(mockDataSource.query).toHaveBeenCalledTimes(2);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: 'member-1',
        firstname: 'Ada',
        lastname: 'Obi',
        absenceCount: 5,
        hasOpenFollowUpTask: true,
        lastSeenAt: expect.any(Date),
      });
      expect(result.totalCount).toBe(1);
    });

    it('returns empty list when no at-risk members', async () => {
      let callCount = 0;
      mockDataSource.query.mockImplementation(() => {
        callCount++;
        return callCount === 1
          ? Promise.resolve([])
          : Promise.resolve([{ total: '0' }]);
      });

      const result = await service.getAtRiskMembers(
        3,
        undefined,
        undefined,
        1,
        20,
      );
      expect(result.data).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });

    it('passes date params to SQL when from/to provided', async () => {
      mockDataSource.query.mockImplementation(() => Promise.resolve([]));

      await service.getAtRiskMembers(2, '2026-01-01', '2026-06-30', 1, 10);

      const firstCall = mockDataSource.query.mock.calls[0];
      expect(firstCall[1]).toContain('2026-01-01');
      expect(firstCall[1]).toContain('2026-06-30');
    });

    it('maps lastSeenAt to null when member has no presence records', async () => {
      const dataRows = [
        {
          id: 'member-2',
          firstname: 'Bola',
          lastname: 'Ade',
          email: 'bola@test.com',
          phone_number: '08022222222',
          absence_count: '4',
          last_seen_at: null,
          has_open_task: false,
        },
      ];
      let callCount = 0;
      mockDataSource.query.mockImplementation(() => {
        callCount++;
        return callCount === 1
          ? Promise.resolve(dataRows)
          : Promise.resolve([{ total: '1' }]);
      });

      const result = await service.getAtRiskMembers(
        3,
        undefined,
        undefined,
        1,
        20,
      );
      expect(result.data[0].lastSeenAt).toBeNull();
      expect(result.data[0].hasOpenFollowUpTask).toBe(false);
    });
  });
});
