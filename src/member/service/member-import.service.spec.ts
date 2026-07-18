import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as ExcelJS from 'exceljs';
import { MemberImportService } from './member-import.service';
import { MemberImportJob } from '../entity/member-import-job.entity';
import { MemberImportRow } from '../entity/member-import-row.entity';
import { Member } from '../entity/member.entity';
import { WorkerProfile } from '../entity/worker-profile.entity';
import { Department } from '../../department/entity/department.entity';
import { ExcelService } from '../../utility/service/excel.service';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { MemberImportRowStatus } from '../enums/member-import-row-status.enum';

const TEMPLATE_HEADERS = [
  'First Name*',
  'Last Name*',
  'Email*',
  'Phone Number',
  'Gender (MALE/FEMALE)',
  'Birth Day (1-31)',
  'Birth Month (1-12)',
  'Birth Year',
  'Marital Status (SINGLE/MARRIED/DIVORCED/WIDOWED)',
  'Year Born Again (4-digit year)',
  'Year Baptized (4-digit year)',
  'Baptized With Holy Ghost (TRUE/FALSE)',
  'Date Joined Church (YYYY-MM-DD)',
  'Department (optional — creates as Worker)',
  'Profession',
  'Year Joined Workforce',
];

async function buildXlsxBuffer(rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Members');
  sheet.addRow(TEMPLATE_HEADERS);
  for (const row of rows) sheet.addRow(row);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function makeFile(buffer: Buffer): Express.Multer.File {
  return { buffer, originalname: 'import.xlsx' } as Express.Multer.File;
}

describe('MemberImportService', () => {
  let service: MemberImportService;

  const mockJobRepository = {
    create: jest.fn((v) => v),
    save: jest.fn((v) => Promise.resolve({ id: 'job-1', ...v })),
    findOneBy: jest.fn(),
  };

  const mockRowRepository = {
    create: jest.fn((v) => v),
    save: jest.fn((v) => Promise.resolve(v)),
    find: jest.fn().mockResolvedValue([]),
  };

  const mockMemberRepository = {
    findOneBy: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((v) => v),
    manager: { transaction: jest.fn() },
  };

  const mockWorkerProfileRepository = {
    create: jest.fn((v) => v),
  };

  const mockDepartmentRepository = {
    createQueryBuilder: jest.fn(),
  };

  const mockExcelService = {
    buildWorkbook: jest.fn().mockResolvedValue(Buffer.from('xlsx')),
  };

  const mockUtilityService = { sendEmailWithTemplate: jest.fn() };
  const mockAuditLogService = { log: jest.fn() };
  const mockConfigService = { get: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockMemberRepository.findOneBy.mockResolvedValue(null);
    mockMemberRepository.find.mockResolvedValue([]);
    mockDepartmentRepository.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
      getMany: jest.fn().mockResolvedValue([]),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberImportService,
        {
          provide: getRepositoryToken(MemberImportJob),
          useValue: mockJobRepository,
        },
        {
          provide: getRepositoryToken(MemberImportRow),
          useValue: mockRowRepository,
        },
        { provide: getRepositoryToken(Member), useValue: mockMemberRepository },
        {
          provide: getRepositoryToken(WorkerProfile),
          useValue: mockWorkerProfileRepository,
        },
        {
          provide: getRepositoryToken(Department),
          useValue: mockDepartmentRepository,
        },
        { provide: ExcelService, useValue: mockExcelService },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<MemberImportService>(MemberImportService);
    jest.spyOn(service, 'getJob').mockResolvedValue({ id: 'job-1' } as any);
  });

  describe('generateTemplate', () => {
    it('builds a workbook via ExcelService', async () => {
      await service.generateTemplate();
      expect(mockExcelService.buildWorkbook).toHaveBeenCalledWith(
        'Members',
        expect.any(Array),
        [],
      );
    });
  });

  describe('previewImport', () => {
    const admin = { id: 'admin-1' } as any;

    it('flags a row missing required fields', async () => {
      const buffer = await buildXlsxBuffer([
        [
          '',
          '',
          'onlyemail@test.com',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
        ],
      ]);

      await service.previewImport(makeFile(buffer), admin);

      const savedRows = mockRowRepository.save.mock.calls[0][0];
      expect(savedRows).toHaveLength(1);
      expect(savedRows[0].errors.length).toBeGreaterThan(0);
    });

    it('accepts a fully valid row with no department', async () => {
      const buffer = await buildXlsxBuffer([
        [
          'Jane',
          'Doe',
          'jane@test.com',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
        ],
      ]);

      await service.previewImport(makeFile(buffer), admin);

      const savedRows = mockRowRepository.save.mock.calls[0][0];
      expect(savedRows[0].errors).toEqual([]);
      expect(savedRows[0].data.email).toBe('jane@test.com');
    });

    it('flags a row whose email already exists in the DB', async () => {
      mockMemberRepository.findOneBy.mockResolvedValueOnce({ id: 'existing' });
      const buffer = await buildXlsxBuffer([
        [
          'Jane',
          'Doe',
          'jane@test.com',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
        ],
      ]);

      await service.previewImport(makeFile(buffer), admin);

      const savedRows = mockRowRepository.save.mock.calls[0][0];
      expect(savedRows[0].errors).toContain(
        'A member with this email already exists',
      );
    });

    it('flags duplicate emails within the same file', async () => {
      const buffer = await buildXlsxBuffer([
        [
          'Jane',
          'Doe',
          'dup@test.com',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
        ],
        [
          'John',
          'Doe',
          'dup@test.com',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
        ],
      ]);

      await service.previewImport(makeFile(buffer), admin);

      const savedRows = mockRowRepository.save.mock.calls[0][0];
      expect(savedRows[1].errors[0]).toMatch(/Duplicate email in file/);
    });

    it('flags an unknown department', async () => {
      const buffer = await buildXlsxBuffer([
        [
          'Jane',
          'Doe',
          'jane@test.com',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          'Nonexistent Dept',
          '',
          '',
        ],
      ]);

      await service.previewImport(makeFile(buffer), admin);

      const savedRows = mockRowRepository.save.mock.calls[0][0];
      expect(savedRows[0].errors).toContain(
        'Unknown department: "Nonexistent Dept"',
      );
    });

    it('throws BadRequestException when the file has no data rows', async () => {
      const buffer = await buildXlsxBuffer([]);

      await expect(
        service.previewImport(makeFile(buffer), admin),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('commitImport', () => {
    const admin = { id: 'admin-1' } as any;

    it('creates members for valid rows and reports failures separately', async () => {
      const validRow = {
        rowNumber: 2,
        data: { firstname: 'Jane', lastname: 'Doe', email: 'jane@test.com' },
        errors: [],
        status: MemberImportRowStatus.PENDING,
      };
      const invalidRowAlreadyExists = {
        rowNumber: 3,
        data: { firstname: 'John', lastname: 'Doe', email: 'john@test.com' },
        errors: [],
        status: MemberImportRowStatus.PENDING,
      };

      mockJobRepository.findOneBy.mockResolvedValue({
        id: 'job-1',
        status: 'READY_FOR_REVIEW',
      });
      (service.getJob as jest.Mock).mockResolvedValue({
        id: 'job-1',
        status: 'READY_FOR_REVIEW',
      });
      mockRowRepository.find.mockResolvedValue([
        validRow,
        invalidRowAlreadyExists,
      ]);

      // Batched existence check: john@test.com was taken between preview
      // and commit (race), jane@test.com is still free.
      mockMemberRepository.find.mockResolvedValue([{ email: 'john@test.com' }]);
      mockMemberRepository.manager.transaction.mockImplementation(
        async (cb: any) =>
          cb({
            save: jest.fn((entities: any) =>
              Promise.resolve(
                (Array.isArray(entities) ? entities : [entities]).map(
                  (e: any) => ({ id: 'new-member', ...e }),
                ),
              ),
            ),
          }),
      );

      const result = await service.commitImport('job-1', admin);

      expect(result.createdCount).toBe(1);
      expect(result.failedRows).toHaveLength(1);
      expect(result.failedRows[0].rowNumber).toBe(3);
      expect(result.failedRows[0].reason).toBe(
        'A member with this email already exists',
      );
    });

    it('skips the transaction entirely when every row fails validation', async () => {
      const invalidRow = {
        rowNumber: 2,
        data: { firstname: 'Jane', lastname: 'Doe', email: 'jane@test.com' },
        errors: [],
        status: MemberImportRowStatus.PENDING,
      };

      (service.getJob as jest.Mock).mockResolvedValue({
        id: 'job-1',
        status: 'READY_FOR_REVIEW',
      });
      mockRowRepository.find.mockResolvedValue([invalidRow]);
      mockMemberRepository.find.mockResolvedValue([{ email: 'jane@test.com' }]);

      const result = await service.commitImport('job-1', admin);

      expect(result.createdCount).toBe(0);
      expect(result.failedRows).toEqual([
        { rowNumber: 2, reason: 'A member with this email already exists' },
      ]);
      expect(mockMemberRepository.manager.transaction).not.toHaveBeenCalled();
    });

    it('rejects committing an already-committed job', async () => {
      (service.getJob as jest.Mock).mockResolvedValue({
        id: 'job-1',
        status: 'COMMITTED',
      });

      await expect(service.commitImport('job-1', admin)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
