import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RequestLeaveService } from './request-leave.service';
import { RequestLeave } from '../enitity/request-leave.entity';
import { MemberService } from '../../member/service/member.service';
import { DepartmentService } from '../../department/service/department.service';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { ConfigService } from '@nestjs/config';

describe('RequestLeaveService', () => {
  let service: RequestLeaveService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestLeaveService,
        {
          provide: getRepositoryToken(RequestLeave),
          useValue: {
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            exists: jest.fn(),
          },
        },
        { provide: MemberService, useValue: {} },
        { provide: DepartmentService, useValue: {} },
        { provide: UtilityService, useValue: {} },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('Test App') },
        },
      ],
    }).compile();

    service = module.get<RequestLeaveService>(RequestLeaveService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
