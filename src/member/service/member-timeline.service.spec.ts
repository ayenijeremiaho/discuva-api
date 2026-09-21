import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { MemberTimelineService } from './member-timeline.service';
import { Member } from '../entity/member.entity';
import { Department } from '../../department/entity/department.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { FollowUpService } from '../../follow-up/service/follow-up.service';
import { MemberTimelineEventType } from '../interface/member-timeline-event.interface';

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberTimelineService,
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        {
          provide: getRepositoryToken(Department),
          useValue: mockDepartmentRepo,
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
    const timeline = await service.getTimeline('member-1');
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      type: MemberTimelineEventType.BECAME_MEMBER,
      title: 'Joined the Church',
    });
  });

  it('builds the pre-membership timeline from a first-timer record with visits', async () => {
    mockMemberRepo.findOne.mockResolvedValueOnce(baseMember);
    mockFollowUpService.getFirstTimerByConvertedMemberId.mockResolvedValueOnce({
      createdAt: new Date('2024-01-01T00:00:00Z'),
      convertedAt: new Date('2024-01-15T00:00:00Z'),
      visitedEvent: null,
      visits: [{ visitedAt: '2024-01-08', event: null }],
    });

    const timeline = await service.getTimeline('member-1');

    expect(timeline.map((e) => e.type)).toEqual([
      MemberTimelineEventType.FIRST_VISIT,
      MemberTimelineEventType.REPEAT_VISIT,
      MemberTimelineEventType.BECAME_MEMBER,
    ]);
    // Sorted chronologically, oldest first.
    expect(timeline[0].occurredAt < timeline[1].occurredAt).toBe(true);
    expect(timeline[1].occurredAt < timeline[2].occurredAt).toBe(true);
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

    const timeline = await service.getTimeline('member-1');

    const workerEvent = timeline.find(
      (e) => e.type === MemberTimelineEventType.BECAME_WORKER,
    );
    expect(workerEvent).toMatchObject({
      title: 'Became a Worker',
      description: 'Ushering',
    });
    expect(timeline.some((e) => e.title === 'MEMBER_UPDATED')).toBe(false);
  });

  it('falls back to workerProfile.createdAt when no promotion audit log exists', async () => {
    mockMemberRepo.findOne.mockResolvedValueOnce({
      ...baseMember,
      workerProfile: {
        createdAt: new Date('2024-03-01T00:00:00Z'),
        department: { name: 'Media' },
      },
    });

    const timeline = await service.getTimeline('member-1');

    const workerEvent = timeline.find(
      (e) => e.type === MemberTimelineEventType.BECAME_WORKER,
    );
    expect(workerEvent).toMatchObject({
      title: 'Became a Worker',
      description: 'Media',
    });
  });
});
