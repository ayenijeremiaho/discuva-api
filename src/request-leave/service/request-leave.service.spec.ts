import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RequestLeaveService } from './request-leave.service';
import { RequestLeave } from '../enitity/request-leave.entity';
import { MemberService } from '../../member/service/member.service';
import { DepartmentService } from '../../department/service/department.service';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { LeaveStatusEnum } from '../enums/leave-status.enum';

const mockRepo = {
  save: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  exists: jest.fn(),
};
const mockMemberService = { getById: jest.fn() };
const mockDepartmentService = {};
const mockUtilityService = {
  sendEmailWithTemplate: jest.fn(),
  resolveChurchName: jest.fn(),
};
const mockAuditLogService = { log: jest.fn() };

describe('RequestLeaveService', () => {
  let service: RequestLeaveService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockUtilityService.resolveChurchName.mockResolvedValue('Test Church');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestLeaveService,
        { provide: getRepositoryToken(RequestLeave), useValue: mockRepo },
        { provide: MemberService, useValue: mockMemberService },
        { provide: DepartmentService, useValue: mockDepartmentService },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get<RequestLeaveService>(RequestLeaveService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('actionLeave', () => {
    it("names the tenant's own church in the subject, not a generic product name", async () => {
      const leave = {
        id: 'leave-1',
        status: LeaveStatusEnum.PENDING,
        dateFrom: '2026-01-01',
        dateTo: '2026-01-02',
        workerProfile: {
          member: {
            id: 'member-1',
            email: 'worker@test.com',
            firstname: 'jane',
          },
        },
      };
      mockRepo.findOne.mockResolvedValue(leave);
      mockRepo.save.mockImplementation((v) => Promise.resolve(v));
      mockMemberService.getById.mockResolvedValue({ id: 'admin-1' });

      await service.actionLeave(
        { id: 'admin-1' } as any,
        'leave-1',
        LeaveStatusEnum.APPROVED,
      );

      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
        'worker@test.com',
        expect.stringContaining('Test Church Leave Request Approved'),
        'leave-actioned',
        expect.any(Object),
      );
    });
  });
});
