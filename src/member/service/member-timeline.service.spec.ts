import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { MemberTimelineService } from './member-timeline.service';
import { Member } from '../entity/member.entity';
import { Department } from '../../department/entity/department.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { FollowUpService } from '../../follow-up/service/follow-up.service';
import { MemberTimelineEventType } from '../interface/member-timeline-event.interface';
import { SundaySchoolAttendance } from '../../sunday-school/entity/sunday-school-attendance.entity';
import { Attendance } from '../../attendance/entity/attendance.entity';

const mockMemberRepo = {
  findOne: jest.fn(),
};
const mockDepartmentRepo = {
  find: jest.fn().mockResolvedValue([]),
};
const mockAuditLogService = {
  findAll: jest.fn().mockResolvedValue({ data: [] }),
};
const mockFollowUpService = {
  getFirstTimerByConvertedMemberId: jest.fn().mockResolvedValue(null),
};
const mockSundaySchoolAttendanceRepo = {
  count: jest.fn().mockResolvedValue(0),
};
const attendanceQbMock = {
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getCount: jest.fn().mockResolvedValue(0),
};
const mockAttendanceRepo = {
  createQueryBuilder: jest.fn().mockReturnValue(attendanceQbMock),
};

const baseMember = {
  id: 'member-1',
  createdAt: new Date('2024-01-10T00:00:00Z'),
  dateJoinedChurch: null,
  workerProfile: null,
} as unknown as Member;

describe('MemberTimelineService', () => {
  let service: MemberTimelineService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockFollowUpService.getFirstTimerByConvertedMemberId.mockResolvedValue(
      null,
    );
    mockAuditLogService.findAll.mockResolvedValue({ data: [] });
    mockDepartmentRepo.find.mockResolvedValue([]);
    mockSundaySchoolAttendanceRepo.count.mockResolvedValue(0);
    attendanceQbMock.getCount.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberTimelineService,
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        {
          provide: getRepositoryToken(Department),
          useValue: mockDepartmentRepo,
        },
        {
          provide: getRepositoryToken(SundaySchoolAttendance),
          useValue: mockSundaySchoolAttendanceRepo,
        },
        {
          provide: getRepositoryToken(Attendance),
          useValue: mockAttendanceRepo,
        },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: FollowUpService, useValue: mockFollowUpService },
      ],
    }).compile();

    service = module.get(MemberTimelineService);
  });

  it('throws NotFoundException for an unknown member', async () => {
    mockMemberRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.getTimeline('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('falls back to "Joined the Church" when there is no first-timer record', async () => {
    mockMemberRepo.findOne.mockResolvedValueOnce(baseMember);
    const { events, visitCount } = await service.getTimeline('member-1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: MemberTimelineEventType.BECAME_MEMBER,
      title: 'Joined the Church',
    });
    // "Joined the Church" isn't itself a visit, and there's no first-timer
    // or attendance history in this scenario.
    expect(visitCount).toBe(0);
  });

  it('builds the pre-membership timeline from a first-timer record with visits', async () => {
    mockMemberRepo.findOne.mockResolvedValueOnce(baseMember);
    mockFollowUpService.getFirstTimerByConvertedMemberId.mockResolvedValueOnce({
      id: 'ft-1',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      convertedAt: new Date('2024-01-15T00:00:00Z'),
      visitedEvent: null,
      visits: [{ visitedAt: '2024-01-08', event: null }],
    });

    const { events, visitCount } = await service.getTimeline('member-1');

    expect(events.map((e) => e.type)).toEqual([
      MemberTimelineEventType.FIRST_VISIT,
      MemberTimelineEventType.REPEAT_VISIT,
      MemberTimelineEventType.BECAME_MEMBER,
    ]);
    // Sorted chronologically, oldest first.
    expect(events[0].occurredAt < events[1].occurredAt).toBe(true);
    expect(events[1].occurredAt < events[2].occurredAt).toBe(true);
    // FIRST_VISIT + REPEAT_VISIT, no Sunday School or regular attendance mocked.
    expect(visitCount).toBe(2);
  });

  it('rolls up Sunday School and regular attendance into visitCount', async () => {
    mockMemberRepo.findOne.mockResolvedValueOnce(baseMember);
    mockFollowUpService.getFirstTimerByConvertedMemberId.mockResolvedValueOnce({
      id: 'ft-1',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      convertedAt: new Date('2024-01-15T00:00:00Z'),
      visitedEvent: null,
      visits: [],
    });
    // First call is the pre-conversion (firstTimer-linked) count, second is
    // the post-conversion (member-linked) count — same repo, two FK columns.
    mockSundaySchoolAttendanceRepo.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    attendanceQbMock.getCount.mockResolvedValueOnce(5);

    const { visitCount } = await service.getTimeline('member-1');

    // 1 (FIRST_VISIT) + 2 (pre-conversion SS) + 3 (post-conversion SS) + 5 (regular attendance)
    expect(visitCount).toBe(11);
    expect(mockSundaySchoolAttendanceRepo.count).toHaveBeenCalledWith({
      where: { firstTimer: { id: 'ft-1' } },
    });
    expect(mockSundaySchoolAttendanceRepo.count).toHaveBeenCalledWith({
      where: { member: { id: 'member-1' } },
    });
    expect(attendanceQbMock.andWhere).toHaveBeenCalledWith(
      'a.status IN (:...statuses)',
      { statuses: ['PRESENT', 'LATE'] },
    );
  });

  it('maps milestone-worthy audit log actions and resolves department names', async () => {
    mockMemberRepo.findOne.mockResolvedValueOnce(baseMember);
    mockAuditLogService.findAll.mockResolvedValueOnce({
      data: [
        {
          action: 'WORKER_PROMOTED',
          createdAt: new Date('2024-02-01T00:00:00Z'),
          metadata: { departmentId: 'dept-1' },
        },
        {
          action: 'MEMBER_UPDATED', // not in the curated allowlist — must be dropped
          createdAt: new Date('2024-02-02T00:00:00Z'),
          metadata: {},
        },
      ],
    });
    mockDepartmentRepo.find.mockResolvedValueOnce([
      { id: 'dept-1', name: 'Ushering' },
    ]);

    const { events } = await service.getTimeline('member-1');

    const workerEvent = events.find(
      (e) => e.type === MemberTimelineEventType.BECAME_WORKER,
    );
    expect(workerEvent).toMatchObject({
      title: 'Became a Worker',
      description: 'Ushering',
    });
    expect(events.some((e) => e.title === 'MEMBER_UPDATED')).toBe(false);
  });

  it('falls back to workerProfile.createdAt when no promotion audit log exists', async () => {
    mockMemberRepo.findOne.mockResolvedValueOnce({
      ...baseMember,
      workerProfile: {
        createdAt: new Date('2024-03-01T00:00:00Z'),
        department: { name: 'Media' },
      },
    });

    const { events } = await service.getTimeline('member-1');

    const workerEvent = events.find(
      (e) => e.type === MemberTimelineEventType.BECAME_WORKER,
    );
    expect(workerEvent).toMatchObject({
      title: 'Became a Worker',
      description: 'Media',
    });
  });

  it('reports isTraineeNow from the current worker profile, false when not a worker', async () => {
    mockMemberRepo.findOne.mockResolvedValueOnce(baseMember);
    const { isTraineeNow } = await service.getTimeline('member-1');
    expect(isTraineeNow).toBe(false);
  });

  it('reports isTraineeNow true when the current worker profile is a trainee', async () => {
    mockMemberRepo.findOne.mockResolvedValueOnce({
      ...baseMember,
      workerProfile: {
        createdAt: new Date('2024-03-01T00:00:00Z'),
        department: { name: 'Media' },
        isTrainee: true,
      },
    });

    const { isTraineeNow } = await service.getTimeline('member-1');
    expect(isTraineeNow).toBe(true);
  });

  it('maps WORKER_TRAINEE_STATUS_CHANGED to Started Training / Completed Training', async () => {
    mockMemberRepo.findOne.mockResolvedValueOnce(baseMember);
    mockAuditLogService.findAll.mockResolvedValueOnce({
      data: [
        {
          action: 'WORKER_TRAINEE_STATUS_CHANGED',
          createdAt: new Date('2024-02-01T00:00:00Z'),
          metadata: { isTrainee: true, departmentId: 'dept-1' },
        },
        {
          action: 'WORKER_TRAINEE_STATUS_CHANGED',
          createdAt: new Date('2024-05-01T00:00:00Z'),
          metadata: { isTrainee: false, departmentId: 'dept-1' },
        },
      ],
    });
    mockDepartmentRepo.find.mockResolvedValueOnce([
      { id: 'dept-1', name: 'Ushering' },
    ]);

    const { events } = await service.getTimeline('member-1');

    const traineeEvents = events.filter(
      (e) => e.type === MemberTimelineEventType.TRAINEE_STATUS_CHANGED,
    );
    expect(traineeEvents.map((e) => e.title)).toEqual([
      'Started Training',
      'Completed Training',
    ]);
    expect(traineeEvents[0].description).toBe('Ushering');
  });
});
