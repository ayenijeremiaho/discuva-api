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
import { WorkerStatusEnum } from '../../member/enums/worker-status.enum';
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
      // First call: the existing HOD row being replaced. Second call: the
      // new cross-role conflict check (see below) — no Deputy HOD row for
      // this worker in this department, so it resolves clean.
      mockLeadRepo.findOne
        .mockResolvedValueOnce(existingLead)
        .mockResolvedValueOnce(null);
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

    // The old UNIQUE(worker_profile_id) constraint used to block this only
    // as a side effect of blocking every multi-row case for a worker — now
    // that leading multiple DIFFERENT departments is legitimate, holding
    // BOTH lead types within the SAME department needs its own explicit
    // guard, since HOD and Deputy HOD must be two different people.
    it('rejects assigning a worker as HOD when they already hold Deputy HOD for the same department', async () => {
      mockDepartmentRepo.findOneBy.mockResolvedValue(department);
      mockWorkerProfileRepo.findOne.mockResolvedValue(profile);
      mockLeadRepo.findOne
        .mockResolvedValueOnce(null) // no existing HOD row to replace
        .mockResolvedValueOnce({
          workerProfile: { id: profile.id },
          leadType: DepartmentLeadTypeEnum.D_HOD,
        }); // but this worker already holds Deputy HOD here

      await expect(service.assignLead(dto, 'actor-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockLeadRepo.save).not.toHaveBeenCalled();
    });

    it('rejects assigning a worker as Deputy HOD when they already hold HOD for the same department', async () => {
      const assistantDto = { ...dto, type: 'assistant' as const };
      mockDepartmentRepo.findOneBy.mockResolvedValue(department);
      mockWorkerProfileRepo.findOne.mockResolvedValue(profile);
      mockLeadRepo.findOne
        .mockResolvedValueOnce(null) // no existing Deputy HOD row to replace
        .mockResolvedValueOnce({
          workerProfile: { id: profile.id },
          leadType: DepartmentLeadTypeEnum.HOD,
        }); // but this worker already holds HOD here

      await expect(service.assignLead(assistantDto, 'actor-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockLeadRepo.save).not.toHaveBeenCalled();
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

  describe('resolveLeadDepartmentId', () => {
    it('validates and returns an explicitly-supplied departmentId via assertIsDepartmentLead', async () => {
      mockLeadRepo.findOne.mockResolvedValue({
        department: { id: 'dept-2' },
      });

      const result = await service.resolveLeadDepartmentId(
        'member-1',
        'dept-2',
      );

      expect(result).toBe('dept-2');
      expect(mockLeadRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            department: { id: 'dept-2' },
          }),
        }),
      );
    });

    it('rejects an explicit departmentId the member does not lead', async () => {
      mockLeadRepo.findOne.mockResolvedValue(null);

      await expect(
        service.resolveLeadDepartmentId('member-1', 'dept-2'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('auto-detects the department when the member leads exactly one', async () => {
      mockLeadRepo.find.mockResolvedValue([
        { department: { id: 'dept-1', name: 'Sound' }, leadType: 'HOD' },
      ]);

      const result = await service.resolveLeadDepartmentId('member-1');

      expect(result).toBe('dept-1');
    });

    it('throws ForbiddenException when the member leads no department', async () => {
      mockLeadRepo.find.mockResolvedValue([]);

      await expect(service.resolveLeadDepartmentId('member-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    // This is the exact scenario a real UNIQUE(worker_profile_id) DB
    // constraint used to make impossible — now that a worker can lead
    // multiple departments, silently picking one (the old
    // getDepartmentIdForLead behavior) would be wrong, so this must reject
    // and ask the caller to disambiguate instead.
    it('throws BadRequestException when the member leads more than one department and none was specified', async () => {
      mockLeadRepo.find.mockResolvedValue([
        { department: { id: 'dept-1', name: 'Sound' }, leadType: 'HOD' },
        { department: { id: 'dept-2', name: 'Visuals' }, leadType: 'HOD' },
      ]);

      await expect(service.resolveLeadDepartmentId('member-1')).rejects.toThrow(
        BadRequestException,
      );
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
      // Array where = OR — a worker whose ONLY connection to this
      // department is as their secondary/alternate one must still match,
      // not just workers with it as their primary.
      expect(mockWorkerProfileRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [
            { department: { id: 'dept-1' } },
            { secondaryDepartment: { id: 'dept-1' } },
          ],
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
      // Same OR-on-primary-or-secondary shape as getWorkersInDepartment —
      // the department roster must include alternate-department workers.
      expect(mockWorkerProfileRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [
            { department: { id: 'dept-1' } },
            { secondaryDepartment: { id: 'dept-1' } },
          ],
        }),
      );
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
      mockLeadRepo.find.mockResolvedValue([]);

      await expect(service.getDepartmentSummary(user)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should return department summary with correct structure', async () => {
      mockLeadRepo.find.mockResolvedValue([lead]);
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

    // A worker whose ALTERNATE (secondary) department is this one must be
    // counted here too — otherwise the Summary's totals silently disagree
    // with the Attendance screen's roster, which already includes them via
    // getWorkersInDepartment's own OR fix.
    it('counts workers via EITHER primary or secondary department, same as getWorkersInDepartment', async () => {
      mockLeadRepo.find.mockResolvedValue([lead]);
      mockLeadRepo.findOne.mockResolvedValue(lead);
      mockWorkerProfileRepo.count.mockResolvedValue(0);
      mockLeaveRepo.find.mockResolvedValue([]);
      const qb = makeQb();
      qb.getRawOne.mockResolvedValue({ attended: '0' });
      mockAttendanceRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getDepartmentSummary(user);

      expect(mockWorkerProfileRepo.count).toHaveBeenNthCalledWith(1, {
        where: [
          { department: { id: 'dept-1' } },
          { secondaryDepartment: { id: 'dept-1' } },
        ],
      });
      expect(mockWorkerProfileRepo.count).toHaveBeenNthCalledWith(2, {
        where: [
          { department: { id: 'dept-1' }, status: WorkerStatusEnum.ACTIVE },
          {
            secondaryDepartment: { id: 'dept-1' },
            status: WorkerStatusEnum.ACTIVE,
          },
        ],
      });
      expect(mockLeaveRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.arrayContaining([
            expect.objectContaining({
              workerProfile: { secondaryDepartment: { id: 'dept-1' } },
              status: LeaveStatusEnum.PENDING,
            }),
          ]),
        }),
      );
      expect(qb.where).toHaveBeenCalledWith(
        '(wp.department_id = :deptId OR wp.secondary_department_id = :deptId)',
        { deptId: 'dept-1' },
      );
    });

    it('should return 0 attendance percentage when no active workers', async () => {
      mockLeadRepo.find.mockResolvedValue([lead]);
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
      mockLeadRepo.find.mockResolvedValue([lead]);
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
      const assistantLead = { ...lead, leadType: DepartmentLeadTypeEnum.D_HOD };
      mockLeadRepo.find.mockResolvedValue([assistantLead]);
      mockLeadRepo.findOne.mockResolvedValue(assistantLead);
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
      const clearSecondaryQb = makeQb();
      clearSecondaryQb.execute.mockResolvedValue({ affected: 0 });
      mockWorkerProfileRepo.createQueryBuilder
        .mockReturnValueOnce(selectQb)
        .mockReturnValueOnce(updateQb)
        .mockReturnValueOnce(clearSecondaryQb);

      const result = await service.bulkAssignDepartment(
        'dept-1',
        { memberIds: ['m-1', 'm-2'] },
        'actor-1',
      );

      expect(result).toEqual({ updated: 1, skipped: 1 });
      expect(updateQb.set).toHaveBeenCalledWith({
        department: { id: 'dept-1' },
      });
      // A worker who already held dept-1 as their SECONDARY department must
      // have it cleared there too, once it becomes their primary — a
      // department can't be both at once.
      expect(clearSecondaryQb.set).toHaveBeenCalledWith({
        secondaryDepartment: null,
      });
      expect(clearSecondaryQb.andWhere).toHaveBeenCalledWith(
        'secondary_department_id = :departmentId',
        { departmentId: 'dept-1' },
      );
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
