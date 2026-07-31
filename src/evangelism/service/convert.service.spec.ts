import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConvertService } from './convert.service';
import { Convert } from '../entity/convert.entity';
import { ConvertFollowUpLog } from '../entity/convert-follow-up-log.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { MemberService } from '../../member/service/member.service';
import { ConvertStatusEnum } from '../enum/convert-status.enum';
import { DepartmentCapability } from '../../department/enums/department-capability.enum';
import { DepartmentAccessService } from '../../department/service/department-access.service';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { SessionSurface } from '../../auth/enum/session-surface.enum';

const mockConvertRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  existsBy: jest.fn(),
};

const mockFollowUpLogRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findAndCount: jest.fn(),
};

const mockWorkerProfileRepo = {
  findOne: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };

const mockDepartmentAccessService = {
  hasCapability: jest.fn(),
  assertHasCapability: jest.fn(),
};

const mockMemberService = {
  getById: jest.fn(),
};

const currentUser: MemberAuth = {
  id: 'member-1',
  role: MemberRoleEnum.MEMBER,
  requiresPasswordChange: false,
  surface: SessionSurface.MEMBER,
};

const member = { id: 'member-1', firstname: 'Ada', lastname: 'Lovelace' };

describe('ConvertService', () => {
  let service: ConvertService;

  beforeEach(async () => {
    jest.clearAllMocks();

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
        { provide: MemberService, useValue: mockMemberService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        {
          provide: DepartmentAccessService,
          useValue: mockDepartmentAccessService,
        },
      ],
    }).compile();

    service = module.get<ConvertService>(ConvertService);
  });

  describe('createConvert', () => {
    it('creates a convert with an onboarder name snapshot and defaults to UNSAVED', async () => {
      mockMemberService.getById.mockResolvedValue(member);
      const created = { id: 'convert-1' };
      mockConvertRepo.create.mockReturnValue(created);
      mockConvertRepo.save.mockResolvedValue(created);

      const result = await service.createConvert(
        { name: 'John Smith' },
        currentUser,
      );

      expect(mockConvertRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'John Smith',
          status: ConvertStatusEnum.UNSAVED,
          onboardedByName: 'Ada Lovelace',
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'CONVERT_CREATED',
        expect.objectContaining({ actorId: 'member-1', targetId: 'convert-1' }),
      );
      expect(result).toEqual(created);
    });

    it('uses the provided status when given', async () => {
      mockMemberService.getById.mockResolvedValue(member);
      mockConvertRepo.create.mockReturnValue({ id: 'convert-1' });
      mockConvertRepo.save.mockResolvedValue({ id: 'convert-1' });

      await service.createConvert(
        { name: 'John Smith', status: ConvertStatusEnum.SAVED },
        currentUser,
      );

      expect(mockConvertRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: ConvertStatusEnum.SAVED }),
      );
    });
  });

  describe('logFollowUp', () => {
    it('throws NotFoundException when the convert does not exist', async () => {
      mockConvertRepo.findOne.mockResolvedValue(null);

      await expect(
        service.logFollowUp('missing', {}, currentUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('logs a follow-up and updates lastContactedAt on the convert', async () => {
      const convert = { id: 'convert-1', lastContactedAt: null };
      mockConvertRepo.findOne.mockResolvedValue(convert);
      mockMemberService.getById.mockResolvedValue(member);
      const contactedAt = new Date();
      const savedLog = { id: 'log-1', contactedAt };
      mockFollowUpLogRepo.create.mockReturnValue(savedLog);
      mockFollowUpLogRepo.save.mockResolvedValue(savedLog);
      mockConvertRepo.save.mockImplementation((c) => Promise.resolve(c));

      const result = await service.logFollowUp(
        'convert-1',
        { note: 'Reached out by phone' },
        currentUser,
      );

      expect(mockFollowUpLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          convert,
          loggedByName: 'Ada Lovelace',
          note: 'Reached out by phone',
        }),
      );
      expect(convert.lastContactedAt).toBe(contactedAt);
      expect(mockConvertRepo.save).toHaveBeenCalledWith(convert);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'CONVERT_FOLLOW_UP_LOGGED',
        expect.objectContaining({ actorId: 'member-1', targetId: 'log-1' }),
      );
      expect(result).toEqual(savedLog);
    });
  });

  describe('getTeamConverts', () => {
    it('computes daysSinceLastContact and isOverdue for each convert', async () => {
      const now = Date.now();
      const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000);
      mockConvertRepo.findAndCount.mockResolvedValue([
        [
          { id: 'c-1', lastContactedAt: eightDaysAgo, member: null },
          { id: 'c-2', lastContactedAt: null, member: null },
          { id: 'c-3', lastContactedAt: new Date(), member: { id: 'm-1' } },
        ],
        3,
      ]);

      const result = await service.getTeamConverts(1, 10);

      expect(result.data[0].isOverdue).toBe(true);
      expect(result.data[0].daysSinceLastContact).toBe(8);
      expect(result.data[1].isOverdue).toBe(true);
      expect(result.data[1].daysSinceLastContact).toBeNull();
      expect(result.data[2].isOverdue).toBe(false);
    });

    it('filters by status when given', async () => {
      mockConvertRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.getTeamConverts(1, 10, ConvertStatusEnum.SAVED);

      expect(mockConvertRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: ConvertStatusEnum.SAVED } }),
      );
    });
  });

  describe('updateStatus', () => {
    it('throws NotFoundException when the convert does not exist', async () => {
      mockConvertRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateStatus(
          'missing',
          { status: ConvertStatusEnum.SAVED },
          'actor-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates the status and audit-logs it', async () => {
      const convert = { id: 'convert-1', status: ConvertStatusEnum.UNSAVED };
      mockConvertRepo.findOne.mockResolvedValue(convert);
      mockConvertRepo.save.mockImplementation((c) => Promise.resolve(c));

      const result = await service.updateStatus(
        'convert-1',
        { status: ConvertStatusEnum.UNDERGOING_DISCIPLESHIP },
        'actor-1',
      );

      expect(result.status).toBe(ConvertStatusEnum.UNDERGOING_DISCIPLESHIP);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'CONVERT_STATUS_UPDATED',
        expect.objectContaining({
          actorId: 'actor-1',
          metadata: { status: ConvertStatusEnum.UNDERGOING_DISCIPLESHIP },
        }),
      );
    });
  });

  describe('reassignConvert', () => {
    it('throws NotFoundException when the convert does not exist', async () => {
      mockConvertRepo.findOne.mockResolvedValue(null);
      mockWorkerProfileRepo.findOne.mockResolvedValue({ id: 'wp-1' });

      await expect(
        service.reassignConvert(
          'missing',
          { workerProfileId: 'wp-1' },
          'admin-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the worker profile does not exist', async () => {
      mockConvertRepo.findOne.mockResolvedValue({ id: 'convert-1' });
      mockWorkerProfileRepo.findOne.mockResolvedValue(null);

      await expect(
        service.reassignConvert(
          'convert-1',
          { workerProfileId: 'missing' },
          'admin-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the target worker is not in Evangelism', async () => {
      mockConvertRepo.findOne.mockResolvedValue({ id: 'convert-1' });
      mockWorkerProfileRepo.findOne.mockResolvedValue({
        id: 'wp-1',
        department: { capabilities: [] },
        secondaryDepartment: null,
      });

      await expect(
        service.reassignConvert(
          'convert-1',
          { workerProfileId: 'wp-1' },
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('reassigns when the target worker is in Evangelism (secondary department)', async () => {
      const convert = { id: 'convert-1', assignedTo: null };
      mockConvertRepo.findOne.mockResolvedValue(convert);
      const targetProfile = {
        id: 'wp-1',
        department: { capabilities: [] },
        secondaryDepartment: {
          capabilities: [DepartmentCapability.MANAGE_EVANGELISM_CONVERTS],
        },
      };
      mockWorkerProfileRepo.findOne.mockResolvedValue(targetProfile);
      mockConvertRepo.save.mockImplementation((c) => Promise.resolve(c));

      const result = await service.reassignConvert(
        'convert-1',
        { workerProfileId: 'wp-1' },
        'admin-1',
      );

      expect(result.assignedTo).toEqual(targetProfile);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'CONVERT_REASSIGNED',
        expect.objectContaining({ actorId: 'admin-1', targetId: 'convert-1' }),
      );
    });
  });

  describe('linkToMember', () => {
    it('throws NotFoundException when the convert does not exist', async () => {
      mockConvertRepo.findOne.mockResolvedValue(null);

      await expect(
        service.linkToMember('missing', { memberId: 'member-2' }, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('links the convert to a member and sets linkedAt', async () => {
      const convert = { id: 'convert-1', member: null, linkedAt: null };
      mockConvertRepo.findOne.mockResolvedValue(convert);
      mockConvertRepo.save.mockImplementation((c) => Promise.resolve(c));

      const result = await service.linkToMember(
        'convert-1',
        { memberId: 'member-2' },
        'admin-1',
      );

      expect(result.member).toEqual({ id: 'member-2' });
      expect(result.linkedAt).toBeInstanceOf(Date);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'CONVERT_LINKED_TO_MEMBER',
        expect.objectContaining({ actorId: 'admin-1', targetId: 'convert-1' }),
      );
    });
  });

  describe('getFollowUpHistory', () => {
    it('throws NotFoundException when the convert does not exist', async () => {
      mockConvertRepo.existsBy.mockResolvedValue(false);

      await expect(service.getFollowUpHistory('missing')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockFollowUpLogRepo.findAndCount).not.toHaveBeenCalled();
    });

    it('paginates the follow-up log ordered newest-first', async () => {
      mockConvertRepo.existsBy.mockResolvedValue(true);
      mockFollowUpLogRepo.findAndCount.mockResolvedValue([
        [{ id: 'log-1' }, { id: 'log-2' }],
        2,
      ]);

      const result = await service.getFollowUpHistory('convert-1', 1, 10);

      expect(mockFollowUpLogRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { convert: { id: 'convert-1' } },
          order: { contactedAt: 'DESC' },
        }),
      );
      expect(result.data).toHaveLength(2);
    });
  });

  describe('assertIsEvangelismDeptWorker', () => {
    it('delegates to DepartmentAccessService with the EVANGELISM key', async () => {
      mockDepartmentAccessService.assertHasCapability.mockResolvedValue(
        undefined,
      );

      await service.assertIsEvangelismDeptWorker('member-1');

      expect(
        mockDepartmentAccessService.assertHasCapability,
      ).toHaveBeenCalledWith(
        'member-1',
        DepartmentCapability.MANAGE_EVANGELISM_CONVERTS,
        expect.any(String),
      );
    });

    it('propagates the ForbiddenException thrown by DepartmentAccessService', async () => {
      mockDepartmentAccessService.assertHasCapability.mockRejectedValue(
        new ForbiddenException(
          'Only Evangelism department workers can perform this action',
        ),
      );

      await expect(
        service.assertIsEvangelismDeptWorker('member-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
