import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConvertService } from './convert.service';
import { Convert } from '../entity/convert.entity';
import { ConvertFollowUpLog } from '../entity/convert-follow-up-log.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { FirstTimer } from '../../follow-up/entity/first-timer.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { CacheService } from '../../utility/service/cache.service';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { MemberService } from '../../member/service/member.service';
import { ConvertStatusEnum } from '../enum/convert-status.enum';
import { DepartmentCapability } from '../../department/enums/department-capability.enum';
import { DepartmentAccessService } from '../../department/service/department-access.service';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { WorkerStatusEnum } from '../../member/enums/worker-status.enum';
import { SessionSurface } from '../../auth/enum/session-surface.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { OutreachService } from './outreach.service';
import { EvangelismSettingsService } from './evangelism-settings.service';

const CAP = DepartmentCapability.MANAGE_EVANGELISM_CONVERTS;

function qbMock(result: {
  rawMany?: unknown[];
  rawOne?: unknown;
  affected?: number;
}) {
  const qb: Record<string, jest.Mock> = {};
  const chain = [
    'leftJoin',
    'innerJoin',
    'andWhere',
    'where',
    'select',
    'addSelect',
    'distinct',
    'orderBy',
    'addOrderBy',
    'offset',
    'limit',
    'groupBy',
    'update',
    'set',
  ];
  for (const m of chain) qb[m] = jest.fn().mockReturnValue(qb);
  qb.clone = jest.fn().mockReturnValue(qb);
  qb.getRawMany = jest.fn().mockResolvedValue(result.rawMany ?? []);
  qb.getRawOne = jest.fn().mockResolvedValue(result.rawOne);
  qb.execute = jest.fn().mockResolvedValue({ affected: result.affected });
  return qb;
}

const mockConvertRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  existsBy: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockFollowUpLogRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findAndCount: jest.fn(),
};

const mockWorkerProfileRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockFirstTimerRepo = { update: jest.fn().mockResolvedValue(undefined) };

const mockAuditLogService = { log: jest.fn() };

const mockDepartmentAccessService = {
  hasCapability: jest.fn(),
  assertHasCapability: jest.fn(),
};

const mockMemberService = { getById: jest.fn() };

const mockOutreachService = {
  findTeamMemberIds: jest.fn(),
  exists: jest.fn(),
};

const mockSettingsService = { get: jest.fn() };

const mockCacheService = {
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
  key: jest.fn().mockReturnValue('cache-key'),
  flushNamespace: jest.fn().mockResolvedValue(undefined),
};

const mockNotificationDispatchService = {
  notifyMember: jest.fn().mockResolvedValue(undefined),
};

const currentUser: MemberAuth = {
  id: 'member-1',
  role: MemberRoleEnum.WORKER,
  requiresPasswordChange: false,
  surface: SessionSurface.MEMBER,
};

const member = { id: 'member-1', firstname: 'Ada', lastname: 'Lovelace' };

const profile = (
  id: string,
  memberId: string,
  capabilities: string[] = [],
  status = WorkerStatusEnum.ACTIVE,
) => ({
  id,
  status,
  member: {
    id: memberId,
    firstname: 'W',
    lastname: memberId,
    status: MemberStatusEnum.ACTIVE,
  },
  department: { capabilities },
  secondaryDepartment: null,
});

describe('ConvertService', () => {
  let service: ConvertService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSettingsService.get.mockResolvedValue({
      overdueDays: 7,
      autoAssign: true,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConvertService,
        { provide: getRepositoryToken(Convert), useValue: mockConvertRepo },
        {
          provide: getRepositoryToken(ConvertFollowUpLog),
          useValue: mockFollowUpLogRepo,
        },
        {
          provide: getRepositoryToken(WorkerProfile),
          useValue: mockWorkerProfileRepo,
        },
        {
          provide: getRepositoryToken(FirstTimer),
          useValue: mockFirstTimerRepo,
        },
        { provide: MemberService, useValue: mockMemberService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        {
          provide: DepartmentAccessService,
          useValue: mockDepartmentAccessService,
        },
        { provide: OutreachService, useValue: mockOutreachService },
        { provide: EvangelismSettingsService, useValue: mockSettingsService },
        { provide: CacheService, useValue: mockCacheService },
        {
          provide: NotificationDispatchService,
          useValue: mockNotificationDispatchService,
        },
      ],
    }).compile();

    service = module.get<ConvertService>(ConvertService);
  });

  describe('createConvert', () => {
    beforeEach(() => {
      mockMemberService.getById.mockResolvedValue(member);
      mockConvertRepo.create.mockImplementation((c) => c);
      mockConvertRepo.save.mockImplementation((c) =>
        Promise.resolve({ id: 'convert-1', ...c }),
      );
    });

    it('snapshots the onboarder, defaults to UNSAVED and audit-logs', async () => {
      jest.spyOn(service, 'pickAssignee').mockResolvedValue(null);

      const result = await service.createConvert(
        { name: 'John Smith' },
        currentUser,
      );

      expect(mockConvertRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'John Smith',
          status: ConvertStatusEnum.UNSAVED,
          onboardedByName: 'Ada Lovelace',
          outreach: null,
          assignedTo: null,
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'CONVERT_CREATED',
        expect.objectContaining({ actorId: 'member-1', targetId: 'convert-1' }),
      );
      expect(mockCacheService.flushNamespace).toHaveBeenCalledWith(
        'evangelism:report',
      );
      expect(result.id).toBe('convert-1');
    });

    it('files the convert under an outreach the caller is on and offers the team for assignment', async () => {
      mockOutreachService.findTeamMemberIds.mockResolvedValue([
        'member-1',
        'member-2',
      ]);
      const pick = jest.spyOn(service, 'pickAssignee').mockResolvedValue(null);

      await service.createConvert(
        { name: 'John Smith', outreachId: 'outreach-1' },
        currentUser,
      );

      expect(pick).toHaveBeenCalledWith(['member-1', 'member-2']);
      expect(mockConvertRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ outreach: { id: 'outreach-1' } }),
      );
    });

    it('rejects an outreach the caller is not on', async () => {
      mockOutreachService.findTeamMemberIds.mockResolvedValue(['member-2']);

      await expect(
        service.createConvert(
          { name: 'John Smith', outreachId: 'outreach-1' },
          currentUser,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockConvertRepo.save).not.toHaveBeenCalled();
    });

    it('404s for an unknown outreach', async () => {
      mockOutreachService.findTeamMemberIds.mockResolvedValue(null);

      await expect(
        service.createConvert(
          { name: 'John Smith', outreachId: 'missing' },
          currentUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns 409 with the existing record when the phone is already known', async () => {
      mockConvertRepo.findOne.mockResolvedValue({
        id: 'convert-0',
        name: 'Johnny',
        onboardedByName: 'Grace Hopper',
        createdAt: new Date('2026-09-01'),
      });

      const err = await service
        .createConvert(
          { name: 'John Smith', phone: '+2348012345678' },
          currentUser,
        )
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toEqual(
        expect.objectContaining({
          code: 'CONVERT_DUPLICATE',
          existing: expect.objectContaining({ id: 'convert-0' }),
        }),
      );
      expect(mockConvertRepo.save).not.toHaveBeenCalled();
    });

    it('skips the duplicate check when allowDuplicate is set', async () => {
      jest.spyOn(service, 'pickAssignee').mockResolvedValue(null);

      await service.createConvert(
        { name: 'John Smith', phone: '+2348012345678', allowDuplicate: true },
        currentUser,
      );

      expect(mockConvertRepo.findOne).not.toHaveBeenCalled();
      expect(mockConvertRepo.save).toHaveBeenCalled();
    });

    it('leaves the convert unassigned when auto-assign is off', async () => {
      mockSettingsService.get.mockResolvedValue({
        overdueDays: 7,
        autoAssign: false,
      });
      const pick = jest.spyOn(service, 'pickAssignee');

      await service.createConvert({ name: 'John Smith' }, currentUser);

      expect(pick).not.toHaveBeenCalled();
      expect(mockConvertRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ assignedTo: null }),
      );
    });

    it('pushes CONVERT_ASSIGNED to an assignee other than the adder', async () => {
      jest
        .spyOn(service, 'pickAssignee')
        .mockResolvedValue(profile('wp-2', 'member-2', [CAP]) as never);

      await service.createConvert({ name: 'John Smith' }, currentUser);

      expect(mockNotificationDispatchService.notifyMember).toHaveBeenCalledWith(
        expect.objectContaining({
          push: expect.objectContaining({
            memberIds: ['member-2'],
            key: PushNotificationKey.CONVERT_ASSIGNED,
          }),
        }),
      );
    });

    it('does not push when the adder is the assignee', async () => {
      jest
        .spyOn(service, 'pickAssignee')
        .mockResolvedValue(profile('wp-1', 'member-1', [CAP]) as never);

      await service.createConvert({ name: 'John Smith' }, currentUser);

      expect(
        mockNotificationDispatchService.notifyMember,
      ).not.toHaveBeenCalled();
    });
  });

  describe('pickAssignee', () => {
    it('prefers the adder when they are in the Evangelism dept', async () => {
      mockWorkerProfileRepo.find.mockResolvedValue([
        profile('wp-2', 'member-2', [CAP]),
        profile('wp-1', 'member-1', [CAP]),
      ]);

      const result = await service.pickAssignee(['member-1', 'member-2']);

      expect(result?.id).toBe('wp-1');
      expect(mockWorkerProfileRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('falls back to an Evangelism teammate when the adder is not in the dept', async () => {
      mockWorkerProfileRepo.find.mockResolvedValue([
        profile('wp-1', 'member-1'),
        profile('wp-3', 'member-3', [CAP]),
      ]);

      const result = await service.pickAssignee([
        'member-1',
        'member-2',
        'member-3',
      ]);

      expect(result?.id).toBe('wp-3');
    });

    it('round-robins to the least-loaded Evangelism worker when nobody on the outreach qualifies', async () => {
      mockWorkerProfileRepo.find.mockResolvedValue([
        profile('wp-1', 'member-1'),
      ]);
      mockWorkerProfileRepo.createQueryBuilder.mockReturnValue(
        qbMock({ rawMany: [{ id: 'wp-9' }] }),
      );
      mockWorkerProfileRepo.findOne.mockResolvedValue(
        profile('wp-9', 'member-9', [CAP]),
      );

      const result = await service.pickAssignee(['member-1']);

      expect(result?.id).toBe('wp-9');
    });

    it('returns null when there is no Evangelism worker at all', async () => {
      mockWorkerProfileRepo.find.mockResolvedValue([]);
      mockWorkerProfileRepo.createQueryBuilder.mockReturnValue(
        qbMock({ rawMany: [] }),
      );

      expect(await service.pickAssignee(['member-1'])).toBeNull();
    });
  });

  describe('assertCanActOnConvert', () => {
    const convert = {
      id: 'convert-1',
      onboardedBy: { id: 'member-1' },
      outreach: { team: [{ id: 'member-2' }] },
      assignedTo: { member: { id: 'member-3' } },
    };

    it.each(['member-1', 'member-2', 'member-3'])(
      'allows %s (onboarder, teammate, assignee) without a dept check',
      async (memberId) => {
        mockConvertRepo.findOne.mockResolvedValue(convert);

        await service.assertCanActOnConvert('convert-1', memberId);

        expect(
          mockDepartmentAccessService.assertHasCapability,
        ).not.toHaveBeenCalled();
      },
    );

    it('falls back to the Evangelism capability for anyone else', async () => {
      mockConvertRepo.findOne.mockResolvedValue(convert);
      mockDepartmentAccessService.assertHasCapability.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.assertCanActOnConvert('convert-1', 'member-9'),
      ).rejects.toThrow(ForbiddenException);
      expect(
        mockDepartmentAccessService.assertHasCapability,
      ).toHaveBeenCalledWith('member-9', CAP, expect.any(String));
    });

    it('404s for a missing convert', async () => {
      mockConvertRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assertCanActOnConvert('missing', 'member-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listForMember / listForAdmin', () => {
    const stored = {
      id: 'convert-1',
      name: 'John',
      onboardedBy: { id: 'member-1', firstname: 'Ada', lastname: 'L' },
      outreach: {
        id: 'o-1',
        team: [{ id: 'member-1', firstname: 'Ada', lastname: 'L', email: 'x' }],
      },
      assignedTo: null,
      member: null,
      lastContactedAt: null,
    };

    it('scope=team requires the Evangelism capability', async () => {
      mockDepartmentAccessService.assertHasCapability.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.listForMember({ scope: 'team' }, 'member-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('scope=mine filters by onboarder, team or assignee and reports the viewer roles', async () => {
      const qb = qbMock({
        rawMany: [{ id: 'convert-1' }],
        rawOne: { count: '1' },
      });
      mockConvertRepo.createQueryBuilder.mockReturnValue(qb);
      mockConvertRepo.find.mockResolvedValue([stored]);

      const result = await service.listForMember({}, 'member-1');

      expect(qb.andWhere).toHaveBeenCalledWith(
        '(c.onboarded_by = :viewer OR tm.id = :viewer OR am.id = :viewer)',
        { viewer: 'member-1' },
      );
      expect(result.data[0]).toEqual(
        expect.objectContaining({
          isOverdue: true,
          daysSinceLastContact: null,
          stage: 'MET',
          myRoles: ['onboarder', 'team'],
        }),
      );
      expect(result.data[0].outreach!.team).toEqual([
        { id: 'member-1', firstname: 'Ada', lastname: 'L' },
      ]);
      expect(
        mockDepartmentAccessService.assertHasCapability,
      ).not.toHaveBeenCalled();
    });

    it('applies the overdue cutoff from settings', async () => {
      mockSettingsService.get.mockResolvedValue({
        overdueDays: 3,
        autoAssign: true,
      });
      const qb = qbMock({ rawMany: [], rawOne: { count: '0' } });
      mockConvertRepo.createQueryBuilder.mockReturnValue(qb);
      const before = Date.now();

      await service.listForAdmin({ overdue: true, assignedTo: 'unassigned' });

      const overdueCall = qb.andWhere.mock.calls.find(([sql]) =>
        String(sql).includes('last_contacted_at'),
      );
      const cutoff = (overdueCall![1] as { cutoff: Date }).cutoff.getTime();
      expect(before - cutoff).toBeGreaterThanOrEqual(3 * 86_400_000 - 1000);
      expect(before - cutoff).toBeLessThan(3 * 86_400_000 + 1000);
      expect(qb.andWhere).toHaveBeenCalledWith('c.assigned_to IS NULL');
    });

    it('rejects assignedTo=me in the admin portal', async () => {
      await expect(service.listForAdmin({ assignedTo: 'me' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('reassignConvert', () => {
    it('allows any active worker and notifies them', async () => {
      mockConvertRepo.findOne.mockResolvedValue({ id: 'c-1', name: 'John' });
      mockWorkerProfileRepo.findOne.mockResolvedValue(
        profile('wp-5', 'member-5'),
      );
      mockConvertRepo.save.mockImplementation((c) => Promise.resolve(c));

      const result = await service.reassignConvert(
        'c-1',
        { workerProfileId: 'wp-5' },
        'admin-member',
      );

      expect(result.assignedTo).toEqual(
        expect.objectContaining({ id: 'wp-5' }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'CONVERT_REASSIGNED',
        expect.objectContaining({ actorId: 'admin-member' }),
      );
      expect(mockNotificationDispatchService.notifyMember).toHaveBeenCalledWith(
        expect.objectContaining({
          push: expect.objectContaining({ memberIds: ['member-5'] }),
        }),
      );
    });

    it('rejects an inactive worker', async () => {
      mockConvertRepo.findOne.mockResolvedValue({ id: 'c-1' });
      mockWorkerProfileRepo.findOne.mockResolvedValue(
        profile('wp-5', 'member-5', [], WorkerStatusEnum.INACTIVE),
      );

      await expect(
        service.reassignConvert('c-1', { workerProfileId: 'wp-5' }, 'a'),
      ).rejects.toThrow(BadRequestException);
    });

    it('404s for a missing worker profile', async () => {
      mockConvertRepo.findOne.mockResolvedValue({ id: 'c-1' });
      mockWorkerProfileRepo.findOne.mockResolvedValue(null);

      await expect(
        service.reassignConvert('c-1', { workerProfileId: 'x' }, 'a'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('unassignConvert', () => {
    it('clears the assignee and audit-logs', async () => {
      mockConvertRepo.findOne.mockResolvedValue({
        id: 'c-1',
        name: 'John',
        assignedTo: { id: 'wp-1' },
      });
      mockConvertRepo.save.mockImplementation((c) => Promise.resolve(c));

      const result = await service.unassignConvert('c-1', 'admin-member');

      expect(result.assignedTo).toBeNull();
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'CONVERT_UNASSIGNED',
        expect.anything(),
      );
    });
  });

  describe('bulkReassign', () => {
    it.each([
      [{ toWorkerProfileId: 'wp-2' }],
      [
        {
          toWorkerProfileId: 'wp-2',
          convertIds: ['c-1'],
          fromWorkerProfileId: 'wp-1',
        },
      ],
    ])('requires exactly one source: %j', async (dto) => {
      await expect(service.bulkReassign(dto, 'a')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects moving a worker to themselves', async () => {
      await expect(
        service.bulkReassign(
          { toWorkerProfileId: 'wp-1', fromWorkerProfileId: 'wp-1' },
          'a',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("moves a worker's open converts and sends one push with the count", async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(
        profile('wp-2', 'member-2'),
      );
      const qb = qbMock({ affected: 4 });
      mockConvertRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.bulkReassign(
        { toWorkerProfileId: 'wp-2', fromWorkerProfileId: 'wp-1' },
        'admin-member',
      );

      expect(result).toEqual({ updated: 4 });
      expect(qb.where).toHaveBeenCalledWith(
        'assigned_to = :from AND member_id IS NULL AND first_timer_id IS NULL',
        { from: 'wp-1' },
      );
      expect(
        mockNotificationDispatchService.notifyMember,
      ).toHaveBeenCalledTimes(1);
      expect(mockNotificationDispatchService.notifyMember).toHaveBeenCalledWith(
        expect.objectContaining({
          push: expect.objectContaining({
            key: PushNotificationKey.CONVERTS_BULK_ASSIGNED,
            vars: { count: 4 },
          }),
        }),
      );
    });

    it('does not push when nothing moved', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(
        profile('wp-2', 'member-2'),
      );
      mockConvertRepo.createQueryBuilder.mockReturnValue(
        qbMock({ affected: 0 }),
      );

      await service.bulkReassign(
        { toWorkerProfileId: 'wp-2', convertIds: ['c-1'] },
        'a',
      );

      expect(
        mockNotificationDispatchService.notifyMember,
      ).not.toHaveBeenCalled();
    });
  });

  describe('moveToOutreach', () => {
    it('404s for an unknown outreach', async () => {
      mockConvertRepo.findOne.mockResolvedValue({ id: 'c-1' });
      mockOutreachService.exists.mockResolvedValue(false);

      await expect(service.moveToOutreach('c-1', 'o-x', 'a')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('can detach a convert from its outreach', async () => {
      mockConvertRepo.findOne.mockResolvedValue({
        id: 'c-1',
        outreach: { id: 'o-1' },
      });
      mockConvertRepo.save.mockImplementation((c) => Promise.resolve(c));

      const result = await service.moveToOutreach('c-1', null, 'a');

      expect(result.outreach).toBeNull();
    });
  });

  describe('logFollowUp / metAgain', () => {
    it('logs a follow-up and updates lastContactedAt', async () => {
      const convert = { id: 'c-1', name: 'John', lastContactedAt: null };
      const contactedAt = new Date('2026-10-01T10:00:00Z');
      mockConvertRepo.findOne.mockResolvedValue(convert);
      mockMemberService.getById.mockResolvedValue(member);
      mockFollowUpLogRepo.create.mockImplementation((l) => l);
      mockFollowUpLogRepo.save.mockImplementation((l) =>
        Promise.resolve({ id: 'log-1', contactedAt, ...l }),
      );

      await service.logFollowUp('c-1', { note: 'Called' }, currentUser);

      expect(mockConvertRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ lastContactedAt: contactedAt }),
      );
    });

    it('met-again is refused once Follow-Up has taken over', async () => {
      mockConvertRepo.findOne.mockResolvedValue({
        id: 'c-1',
        firstTimer: { id: 'ft-1' },
      });

      await expect(
        service.metAgain('c-1', { note: 'x' }, currentUser),
      ).rejects.toThrow(ConflictException);
    });

    it('met-again prefixes the note', async () => {
      mockConvertRepo.findOne.mockResolvedValue({ id: 'c-1', name: 'John' });
      const spy = jest
        .spyOn(service, 'logFollowUp')
        .mockResolvedValue({} as never);

      await service.metAgain('c-1', { note: 'At the market' }, currentUser);

      expect(spy).toHaveBeenCalledWith(
        'c-1',
        { note: 'Met again: At the market' },
        currentUser,
      );
    });

    it('throws NotFoundException when the convert does not exist', async () => {
      mockConvertRepo.findOne.mockResolvedValue(null);

      await expect(
        service.logFollowUp('missing', {}, currentUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateStatus / linkToMember / getFollowUpHistory', () => {
    it('updates the status and audit-logs it', async () => {
      mockConvertRepo.findOne.mockResolvedValue({ id: 'c-1', name: 'John' });
      mockConvertRepo.save.mockImplementation((c) => Promise.resolve(c));

      const result = await service.updateStatus(
        'c-1',
        { status: ConvertStatusEnum.SAVED },
        'member-1',
      );

      expect(result.status).toBe(ConvertStatusEnum.SAVED);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'CONVERT_STATUS_UPDATED',
        expect.objectContaining({ metadata: { status: 'SAVED' } }),
      );
    });

    it('links the convert to a member and sets linkedAt', async () => {
      mockConvertRepo.findOne.mockResolvedValue({ id: 'c-1', name: 'John' });
      mockConvertRepo.save.mockImplementation((c) => Promise.resolve(c));

      const result = await service.linkToMember(
        'c-1',
        { memberId: 'member-7' },
        'admin-member',
      );

      expect(result.member).toEqual({ id: 'member-7' });
      expect(result.linkedAt).toBeInstanceOf(Date);
    });

    it('paginates the follow-up log newest-first', async () => {
      mockConvertRepo.existsBy.mockResolvedValue(true);
      mockFollowUpLogRepo.findAndCount.mockResolvedValue([[{ id: 'l-1' }], 1]);

      await service.getFollowUpHistory('c-1', 2, 5);

      expect(mockFollowUpLogRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { contactedAt: 'DESC' },
          skip: 5,
          take: 5,
        }),
      );
    });
  });

  describe('journey to Follow-Up and membership', () => {
    it('blocks evangelism follow-up once Follow-Up has taken over, but still allows reading history', async () => {
      const handedOver = {
        id: 'c-1',
        onboardedBy: { id: 'member-1' },
        outreach: null,
        assignedTo: null,
        firstTimer: { id: 'ft-1' },
      };
      mockConvertRepo.findOne.mockResolvedValue(handedOver);

      await expect(
        service.assertCanActOnConvert('c-1', 'member-1'),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.assertCanActOnConvert('c-1', 'member-1', { write: false }),
      ).resolves.toBeUndefined();
    });

    it('refuses to reassign a convert Follow-Up now owns', async () => {
      mockConvertRepo.findOne.mockResolvedValue({
        id: 'c-1',
        firstTimer: { id: 'ft-1' },
      });
      mockWorkerProfileRepo.findOne.mockResolvedValue(
        profile('wp-5', 'member-5'),
      );

      await expect(
        service.reassignConvert('c-1', { workerProfileId: 'wp-5' }, 'a'),
      ).rejects.toThrow(ConflictException);
    });

    it('reports the stage and stops flagging overdue once with Follow-Up', async () => {
      const qb = qbMock({
        rawMany: [{ id: 'c-1' }, { id: 'c-2' }],
        rawOne: { count: '2' },
      });
      mockConvertRepo.createQueryBuilder.mockReturnValue(qb);
      mockConvertRepo.find.mockResolvedValue([
        {
          id: 'c-1',
          firstTimer: { id: 'ft-1', phone: '+234' },
          member: null,
          lastContactedAt: null,
        },
        {
          id: 'c-2',
          firstTimer: null,
          member: { id: 'm-1' },
          lastContactedAt: null,
        },
      ]);

      const result = await service.listForAdmin({ stage: 'with_follow_up' });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'c.first_timer_id IS NOT NULL AND c.member_id IS NULL',
      );
      expect(result.data.map((c) => [c.stage, c.isOverdue])).toEqual([
        ['WITH_FOLLOW_UP', false],
        ['JOINED', false],
      ]);
      expect(result.data[0].firstTimer).toEqual({ id: 'ft-1' });
    });

    it('closing a convert as a member also closes the first-timer it became', async () => {
      mockConvertRepo.findOne.mockResolvedValue({
        id: 'c-1',
        name: 'John',
        firstTimer: { id: 'ft-1', convertedAt: null },
      });
      mockConvertRepo.save.mockImplementation((c) => Promise.resolve(c));

      await service.linkToMember('c-1', { memberId: 'member-7' }, 'admin-m');

      expect(mockFirstTimerRepo.update).toHaveBeenCalledWith('ft-1', {
        convertedAt: expect.any(Date),
        convertedMember: { id: 'member-7' },
      });
    });

    it('does not overwrite a first-timer that already joined', async () => {
      mockConvertRepo.findOne.mockResolvedValue({
        id: 'c-1',
        name: 'John',
        firstTimer: { id: 'ft-1', convertedAt: new Date() },
      });
      mockConvertRepo.save.mockImplementation((c) => Promise.resolve(c));

      await service.linkToMember('c-1', { memberId: 'member-7' }, 'admin-m');

      expect(mockFirstTimerRepo.update).not.toHaveBeenCalled();
    });
  });
});
