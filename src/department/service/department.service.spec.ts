import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DepartmentService } from './department.service';
import { Department } from '../entity/department.entity';
import { DepartmentLead } from '../entity/department-lead.entity';
import { DepartmentLeadTypeEnum } from '../enums/department-lead-type.enum';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { RequestLeave } from '../../request-leave/enitity/request-leave.entity';
import { LeaveStatusEnum } from '../../request-leave/enums/leave-status.enum';
import { Attendance } from '../../attendance/entity/attendance.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { CacheService } from '../../utility/service/cache.service';
import { ConfigService } from '@nestjs/config';
import { SessionSurface } from '../../auth/enum/session-surface.enum';

const mockCacheService = {
  key: jest.fn().mockImplementation((ns: string, id: string) => `${ns}:${id}`),
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
};

const mockConfigService = { get: jest.fn() };

const mockAuditLogService = { log: jest.fn() };

const makeQb = () => ({
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  execute: jest.fn(),
  getRawOne: jest.fn(),
  getRawMany: jest.fn(),
});

const mockDepartmentRepo = {
  save: jest.fn(),
  findOneBy: jest.fn(),
  findAndCount: jest.fn(),
  existsBy: jest.fn(),
  delete: jest.fn(),
  count: jest.fn(),
};

const mockLeadRepo = {
  save: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  exists: jest.fn(),
  create: jest.fn(),
  remove: jest.fn(),
};

const mockWorkerProfileRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  exists: jest.fn(),
  count: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockLeaveRepo = {
  find: jest.fn(),
};

const mockAttendanceRepo = {
  createQueryBuilder: jest.fn(),
};

describe('DepartmentService', () => {
  let service: DepartmentService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepartmentService,
        {
          provide: getRepositoryToken(Department),
          useValue: mockDepartmentRepo,
        },
        { provide: getRepositoryToken(DepartmentLead), useValue: mockLeadRepo },
        {
          provide: getRepositoryToken(WorkerProfile),
          useValue: mockWorkerProfileRepo,
        },
        { provide: getRepositoryToken(RequestLeave), useValue: mockLeaveRepo },
        {
          provide: getRepositoryToken(Attendance),
          useValue: mockAttendanceRepo,
        },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get<DepartmentService>(DepartmentService);
  });

  describe('assignLead', () => {
    const dto = {
      departmentId: 'dept-1',
      memberId: 'member-1',
      type: 'head' as const,
    };
    const department = { id: 'dept-1', name: 'Media' };
    const profile = { id: 'wp-1' };

    it('should throw NotFoundException if department does not exist', async () => {
      mockDepartmentRepo.findOneBy.mockResolvedValue(null);

      await expect(service.assignLead(dto, 'actor-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if worker is not in the department', async () => {
      mockDepartmentRepo.findOneBy.mockResolvedValue(department);
      mockWorkerProfileRepo.findOne.mockResolvedValue(null);

      await expect(service.assignLead(dto, 'actor-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if worker already holds that lead role', async () => {
      mockDepartmentRepo.findOneBy.mockResolvedValue(department);
      mockWorkerProfileRepo.findOne.mockResolvedValue(profile);
      mockLeadRepo.findOne.mockResolvedValue({
        workerProfile: { id: 'wp-1' },
        leadType: DepartmentLeadTypeEnum.HOD,
      });

      await expect(service.assignLead(dto, 'actor-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should replace existing lead and assign new one', async () => {
      const existingLead = { workerProfile: { id: 'wp-other' } };
      mockDepartmentRepo.findOneBy.mockResolvedValue(department);
      mockWorkerProfileRepo.findOne.mockResolvedValue(profile);
      mockLeadRepo.findOne.mockResolvedValue(existingLead);
      mockLeadRepo.remove.mockResolvedValue(undefined);
      mockLeadRepo.create.mockReturnValue({
        workerProfile: profile,
        department,
        leadType: DepartmentLeadTypeEnum.HOD,
      });
      mockLeadRepo.save.mockResolvedValue({});

      const result = await service.assignLead(dto, 'actor-1');

      expect(mockLeadRepo.remove).toHaveBeenCalledWith(existingLead);
      expect(mockLeadRepo.save).toHaveBeenCalled();
      expect(result).toEqual(department);
    });

    it('should assign lead when no existing lead for the role', async () => {
      mockDepartmentRepo.findOneBy.mockResolvedValue(department);
      mockWorkerProfileRepo.findOne.mockResolvedValue(profile);
      mockLeadRepo.findOne.mockResolvedValue(null);
      mockLeadRepo.create.mockReturnValue({});
      mockLeadRepo.save.mockResolvedValue({});

      const result = await service.assignLead(dto, 'actor-1');

      expect(mockLeadRepo.remove).not.toHaveBeenCalled();
      expect(mockLeadRepo.save).toHaveBeenCalled();
      expect(result).toEqual(department);
    });
  });

  describe('removeLead', () => {
    const dto = { departmentId: 'dept-1', type: 'head' as const };
    const department = { id: 'dept-1', name: 'Media' };

    it('should throw NotFoundException if department does not exist', async () => {
      mockDepartmentRepo.findOneBy.mockResolvedValue(null);

      await expect(service.removeLead(dto, 'actor-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if no lead is assigned', async () => {
      mockDepartmentRepo.findOneBy.mockResolvedValue(department);
      mockLeadRepo.findOne.mockResolvedValue(null);

      await expect(service.removeLead(dto, 'actor-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should remove the lead successfully', async () => {
      const lead = { id: 'lead-1' };
      mockDepartmentRepo.findOneBy.mockResolvedValue(department);
      mockLeadRepo.findOne.mockResolvedValue(lead);
      mockLeadRepo.remove.mockResolvedValue(undefined);

      const result = await service.removeLead(dto, 'actor-1');

      expect(mockLeadRepo.remove).toHaveBeenCalledWith(lead);
      expect(result).toEqual(department);
    });
  });

  describe('isMemberDepartmentLead', () => {
    it('should return true when member is a lead', async () => {
      mockLeadRepo.exists.mockResolvedValue(true);

      const result = await service.isMemberDepartmentLead('member-1');

      expect(result).toBe(true);
    });

    it('should return false when member is not a lead', async () => {
      mockLeadRepo.exists.mockResolvedValue(false);

      const result = await service.isMemberDepartmentLead('member-1');

      expect(result).toBe(false);
    });
  });

  describe('getDepartmentIdForLead', () => {
    it('should return the departmentId when member is a lead', async () => {
      mockLeadRepo.findOne.mockResolvedValue({ department: { id: 'dept-1' } });

      const result = await service.getDepartmentIdForLead('member-1');

      expect(result).toBe('dept-1');
    });

    it('should return null when member is not a lead', async () => {
      mockLeadRepo.findOne.mockResolvedValue(null);

      const result = await service.getDepartmentIdForLead('member-1');

      expect(result).toBeNull();
    });
  });

  describe('getWorkersInDepartment', () => {
    it('should return worker profiles with member relation', async () => {
      const workers = [
        {
          id: 'wp-1',
          member: { id: 'member-1', firstname: 'John', lastname: 'Doe' },
        },
        {
          id: 'wp-2',
          member: { id: 'member-2', firstname: 'Jane', lastname: 'Smith' },
        },
      ];
      mockWorkerProfileRepo.find.mockResolvedValue(workers);

      const result = await service.getWorkersInDepartment('dept-1');

      expect(result).toHaveLength(2);
      expect(mockWorkerProfileRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { department: { id: 'dept-1' } },
          relations: ['member'],
        }),
      );
    });
  });

  describe('getWorkersByDepartment', () => {
    it('should throw BadRequestException if page < 1', async () => {
      await expect(service.getWorkersByDepartment('dept-1', 0)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if department not found', async () => {
      mockDepartmentRepo.findOneBy.mockResolvedValue(null);

      await expect(service.getWorkersByDepartment('dept-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should annotate workers with their lead role', async () => {
      mockDepartmentRepo.findOneBy.mockResolvedValue({
        id: 'dept-1',
        name: 'Media',
      });
      const workers = [
        { id: 'wp-1', member: { id: 'member-1' } },
        { id: 'wp-2', member: { id: 'member-2' } },
      ];
      mockWorkerProfileRepo.findAndCount.mockResolvedValue([workers, 2]);
      mockLeadRepo.find.mockResolvedValue([
        { workerProfile: { id: 'wp-1' }, leadType: DepartmentLeadTypeEnum.HOD },
      ]);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: workers as any,
        page: 1,
        limit: 20,
        totalCount: 2,
        totalPages: 1,
      });

      const result = await service.getWorkersByDepartment('dept-1');

      expect(UtilityService.createPaginationResponse).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'wp-1', leadRole: 'head' }),
          expect.objectContaining({ id: 'wp-2', leadRole: null }),
        ]),
        1,
        20,
        2,
      );
      expect(result).toBeDefined();
    });

    it('should annotate assistant lead role correctly', async () => {
      mockDepartmentRepo.findOneBy.mockResolvedValue({
        id: 'dept-1',
        name: 'Media',
      });
      const workers = [{ id: 'wp-1', member: { id: 'member-1' } }];
      mockWorkerProfileRepo.findAndCount.mockResolvedValue([workers, 1]);
      mockLeadRepo.find.mockResolvedValue([
        {
          workerProfile: { id: 'wp-1' },
          leadType: DepartmentLeadTypeEnum.D_HOD,
        },
      ]);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: workers as any,
        page: 1,
        limit: 20,
        totalCount: 1,
        totalPages: 1,
      });

      await service.getWorkersByDepartment('dept-1');

      expect(UtilityService.createPaginationResponse).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ leadRole: 'assistant' }),
        ]),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('getDepartmentSummary', () => {
    const user: MemberAuth = {
      id: 'member-1',
      role: MemberRoleEnum.WORKER,
      requiresPasswordChange: false,
      surface: SessionSurface.MEMBER,
    };
    const lead = {
      department: { id: 'dept-1', name: 'Media' },
      leadType: DepartmentLeadTypeEnum.HOD,
    };

    it('should throw ForbiddenException if member is not a lead', async () => {
      mockLeadRepo.findOne.mockResolvedValue(null);

      await expect(service.getDepartmentSummary(user)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should return department summary with correct structure', async () => {
      mockLeadRepo.findOne.mockResolvedValue(lead);
      mockWorkerProfileRepo.count
        .mockResolvedValueOnce(10) // totalWorkers
        .mockResolvedValueOnce(8); // activeWorkers
      mockLeaveRepo.find.mockResolvedValue([
        {
          workerProfile: {
            id: 'wp-2',
            member: { id: 'member-2', firstname: 'Jane', lastname: 'Smith' },
          },
          status: LeaveStatusEnum.APPROVED,
          dateFrom: new Date('2026-06-01'),
          dateTo: new Date('2026-06-15'),
        },
      ]);
      const qb = makeQb();
      qb.getRawOne.mockResolvedValue({ attended: '6' });
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getDepartmentSummary(user);

      expect(result.departmentId).toBe('dept-1');
      expect(result.departmentName).toBe('Media');
      expect(result.myLeadRole).toBe('head');
      expect(result.totalWorkers).toBe(10);
      expect(result.activeWorkers).toBe(8);
      expect(result.inactiveWorkers).toBe(2);
      expect(result.attendancePercentage).toBe(75);
      expect(result.workersOnLeave).toHaveLength(1);
      expect(result.workersOnLeave[0]).toMatchObject({
        name: 'Jane Smith',
        status: LeaveStatusEnum.APPROVED,
      });
    });

    it('should return 0 attendance percentage when no active workers', async () => {
      mockLeadRepo.findOne.mockResolvedValue(lead);
      mockWorkerProfileRepo.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      mockLeaveRepo.find.mockResolvedValue([]);
      const qb = makeQb();
      qb.getRawOne.mockResolvedValue({ attended: '0' });
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getDepartmentSummary(user);

      expect(result.attendancePercentage).toBe(0);
    });

    it('should cap attendance percentage at 100', async () => {
      mockLeadRepo.findOne.mockResolvedValue(lead);
      mockWorkerProfileRepo.count
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(5);
      mockLeaveRepo.find.mockResolvedValue([]);
      const qb = makeQb();
      qb.getRawOne.mockResolvedValue({ attended: '10' });
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getDepartmentSummary(user);

      expect(result.attendancePercentage).toBe(100);
    });

    it('should identify assistant lead role correctly', async () => {
      mockLeadRepo.findOne.mockResolvedValue({
        ...lead,
        leadType: DepartmentLeadTypeEnum.D_HOD,
      });
      mockWorkerProfileRepo.count.mockResolvedValue(0);
      mockLeaveRepo.find.mockResolvedValue([]);
      const qb = makeQb();
      qb.getRawOne.mockResolvedValue({ attended: '0' });
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getDepartmentSummary(user);

      expect(result.myLeadRole).toBe('assistant');
    });
  });

  describe('create', () => {
    it('should throw BadRequestException if department name already exists', async () => {
      mockDepartmentRepo.existsBy.mockResolvedValue(true);

      await expect(
        service.create({ name: 'Media', description: '' }, 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create and return a new department', async () => {
      const dept = { id: 'dept-1', name: 'Media' };
      mockDepartmentRepo.existsBy.mockResolvedValue(false);
      mockDepartmentRepo.save.mockResolvedValue(dept);

      const result = await service.create(
        { name: 'Media', description: '' },
        'actor-1',
      );

      expect(result).toEqual(dept);
    });
  });

  describe('delete', () => {
    it('should throw NotFoundException if department does not exist', async () => {
      mockDepartmentRepo.findOneBy.mockResolvedValue(null);

      await expect(service.delete('dept-1', 'actor-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if department has workers', async () => {
      mockDepartmentRepo.findOneBy.mockResolvedValue({
        id: 'dept-1',
        name: 'Media',
      });
      mockWorkerProfileRepo.exists.mockResolvedValue(true);

      await expect(service.delete('dept-1', 'actor-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should delete the department when it has no workers', async () => {
      mockDepartmentRepo.findOneBy.mockResolvedValue({
        id: 'dept-1',
        name: 'Media',
      });
      mockWorkerProfileRepo.exists.mockResolvedValue(false);
      mockDepartmentRepo.delete.mockResolvedValue(undefined);

      await expect(
        service.delete('dept-1', 'actor-1'),
      ).resolves.toBeUndefined();
      expect(mockDepartmentRepo.delete).toHaveBeenCalledWith('dept-1');
    });
  });

  describe('bulkAssignDepartment', () => {
    it('updates only members with an existing worker profile, in one batched query', async () => {
      mockDepartmentRepo.findOneBy.mockResolvedValue({
        id: 'dept-1',
        name: 'Media',
      });
      const selectQb = makeQb();
      selectQb.getRawMany.mockResolvedValue([{ memberId: 'm-1' }]);
      const updateQb = makeQb();
      updateQb.execute.mockResolvedValue({ affected: 1 });
      mockWorkerProfileRepo.createQueryBuilder
        .mockReturnValueOnce(selectQb)
        .mockReturnValueOnce(updateQb);

      const result = await service.bulkAssignDepartment(
        'dept-1',
        { memberIds: ['m-1', 'm-2'] },
        'actor-1',
      );

      expect(result).toEqual({ updated: 1, skipped: 1 });
      expect(updateQb.set).toHaveBeenCalledWith({
        department: { id: 'dept-1' },
      });
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'BULK_DEPARTMENT_ASSIGNED',
        expect.objectContaining({
          targetId: 'dept-1',
          metadata: expect.objectContaining({ updated: 1, skipped: 1 }),
        }),
      );
    });

    it('skips the bulk UPDATE entirely when no member has a worker profile', async () => {
      mockDepartmentRepo.findOneBy.mockResolvedValue({
        id: 'dept-1',
        name: 'Media',
      });
      const selectQb = makeQb();
      selectQb.getRawMany.mockResolvedValue([]);
      mockWorkerProfileRepo.createQueryBuilder.mockReturnValue(selectQb);

      const result = await service.bulkAssignDepartment(
        'dept-1',
        { memberIds: ['m-1', 'm-2'] },
        'actor-1',
      );

      expect(result).toEqual({ updated: 0, skipped: 2 });
      expect(mockWorkerProfileRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException if the department does not exist', async () => {
      mockDepartmentRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.bulkAssignDepartment(
          'missing-dept',
          { memberIds: ['m-1'] },
          'actor-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
