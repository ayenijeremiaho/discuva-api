import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { DepartmentGoalImportService } from './department-goal-import.service';
import { DepartmentGoalImportJob } from '../entity/department-goal-import-job.entity';
import { DepartmentGoalImportRow } from '../entity/department-goal-import-row.entity';
import { DepartmentGoalImportJobStatus } from '../enum/department-goal-import-job-status.enum';
import { DepartmentGoalImportRowStatus } from '../enum/department-goal-import-row-status.enum';
import { DepartmentGoal } from '../entity/department-goal.entity';
import { Department } from '../../department/entity/department.entity';
import { DepartmentGoalService } from './department-goal.service';
import { ExcelService } from '../../utility/service/excel.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { Admin } from '../../admin/entity/admin.entity';

const mockJobRepo = {
  create: jest.fn((v) => v),
  save: jest.fn((v) =>
    Promise.resolve(Array.isArray(v) ? v : { id: 'job-1', ...v }),
  ),
  findOne: jest.fn(),
};
const mockRowRepo = {
  create: jest.fn((v) => v),
  save: jest.fn((v) =>
    Promise.resolve(
      Array.isArray(v)
        ? v.map((r, i) => ({ id: `row-${i}`, ...r }))
        : { id: 'row-1', ...v },
    ),
  ),
  find: jest.fn().mockResolvedValue([]),
};
const mockGoalRepo = {
  create: jest.fn((v) => v),
  save: jest.fn((v) =>
    Promise.resolve(
      Array.isArray(v)
        ? v.map((g, i) => ({ id: `goal-${i}`, ...g }))
        : { id: 'goal-1', ...v },
    ),
  ),
};
const mockDepartmentRepo = {
  findOneBy: jest.fn(),
};
const mockGoalService = {
  getCycleOrThrow: jest.fn(),
  assertGoalWritable: jest.fn().mockResolvedValue(undefined),
};
const mockExcelService = {
  buildWorkbook: jest.fn().mockResolvedValue(Buffer.from('xlsx')),
};
const mockAuditLogService = {
  log: jest.fn(),
};

const admin = { id: 'admin-1' } as Admin;
const cycle = { id: 'cycle-1', name: 'Q3 2026 Goals' } as any;
const department = { id: 'dept-1', name: 'Ushering' } as Department;

async function buildUploadFile(rows: string[][]): Promise<Express.Multer.File> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Goals');
  sheet.addRow(['KPI', 'KPI Description', 'Timeline to Achieve Target']);
  for (const row of rows) sheet.addRow(row);
  const buffer = await workbook.xlsx.writeBuffer();
  return {
    originalname: 'goals.xlsx',
    buffer: Buffer.from(buffer),
  } as Express.Multer.File;
}

describe('DepartmentGoalImportService', () => {
  let service: DepartmentGoalImportService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGoalService.getCycleOrThrow.mockResolvedValue(cycle);
    mockDepartmentRepo.findOneBy.mockResolvedValue(department);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepartmentGoalImportService,
        {
          provide: getRepositoryToken(DepartmentGoalImportJob),
          useValue: mockJobRepo,
        },
        {
          provide: getRepositoryToken(DepartmentGoalImportRow),
          useValue: mockRowRepo,
        },
        { provide: getRepositoryToken(DepartmentGoal), useValue: mockGoalRepo },
        {
          provide: getRepositoryToken(Department),
          useValue: mockDepartmentRepo,
        },
        { provide: DepartmentGoalService, useValue: mockGoalService },
        { provide: ExcelService, useValue: mockExcelService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get(DepartmentGoalImportService);
  });

  describe('previewImport', () => {
    it('rejects when the cycle is not writable for this department', async () => {
      mockGoalService.assertGoalWritable.mockRejectedValueOnce(
        new BadRequestException(
          'Goals can only be added, edited, or removed while the cycle is open.',
        ),
      );
      const file = await buildUploadFile([
        ['Grow attendance', 'Reach 200 members', 'Q3'],
      ]);
      await expect(
        service.previewImport('cycle-1', 'dept-1', file, admin),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for an unknown department', async () => {
      mockDepartmentRepo.findOneBy.mockResolvedValueOnce(null);
      const file = await buildUploadFile([['Grow attendance', '', '']]);
      await expect(
        service.previewImport('cycle-1', 'missing-dept', file, admin),
      ).rejects.toThrow(NotFoundException);
    });

    it('parses valid rows and flags rows missing a required title', async () => {
      const file = await buildUploadFile([
        ['Grow attendance', 'Reach 200 members', 'Q3 2026'],
        ['', 'Description with no title', ''],
      ]);
      const result = await service.previewImport(
        'cycle-1',
        'dept-1',
        file,
        admin,
      );

      expect(mockJobRepo.save).toHaveBeenCalled();
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].errors).toEqual([]);
      expect(result.rows[1].errors.length).toBeGreaterThan(0);
    });

    it('skips fully blank rows', async () => {
      const file = await buildUploadFile([
        ['Grow attendance', '', ''],
        ['', '', ''],
      ]);
      const result = await service.previewImport(
        'cycle-1',
        'dept-1',
        file,
        admin,
      );
      expect(result.rows).toHaveLength(1);
    });
  });

  describe('commitImport', () => {
    it('rejects a job that has already been committed', async () => {
      mockJobRepo.findOne.mockResolvedValueOnce({
        id: 'job-1',
        status: DepartmentGoalImportJobStatus.COMMITTED,
        cycle,
        department,
      });
      await expect(service.commitImport('job-1', admin)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('creates goals only for rows without errors and tags them with createdByAdmin', async () => {
      mockJobRepo.findOne.mockResolvedValueOnce({
        id: 'job-1',
        status: DepartmentGoalImportJobStatus.READY_FOR_REVIEW,
        cycle,
        department,
      });
      mockRowRepo.find.mockResolvedValueOnce([
        {
          id: 'row-1',
          rowNumber: 2,
          data: { title: 'Grow attendance' },
          errors: [],
          status: DepartmentGoalImportRowStatus.PENDING,
        },
        {
          id: 'row-2',
          rowNumber: 3,
          data: { title: '' },
          errors: ['title should not be empty'],
          status: DepartmentGoalImportRowStatus.PENDING,
        },
      ]);

      const result = await service.commitImport('job-1', admin);

      expect(result.createdCount).toBe(1);
      expect(result.failedRows).toHaveLength(1);
      expect(mockGoalRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ createdByAdmin: admin }),
      ]);
    });

    it('re-checks writability at commit time, not just at preview time', async () => {
      mockJobRepo.findOne.mockResolvedValueOnce({
        id: 'job-1',
        status: DepartmentGoalImportJobStatus.READY_FOR_REVIEW,
        cycle,
        department,
      });
      mockGoalService.assertGoalWritable.mockRejectedValueOnce(
        new BadRequestException(
          "This department's goals have been fully approved and can no longer be edited.",
        ),
      );
      await expect(service.commitImport('job-1', admin)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockGoalRepo.save).not.toHaveBeenCalled();
    });
  });
});
