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

async function buildXlsxBuffer(rows: ExcelJS.CellValue[][]): Promise<Buffer> {
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
    findOne: jest.fn(),
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
    find: jest.fn().mockResolvedValue([]),
  };

  const mockExcelService = {
    buildWorkbook: jest.fn().mockResolvedValue(Buffer.from('xlsx')),
  };

  const mockUtilityService = {
    sendEmailWithTemplate: jest.fn(),
    resolveChurchName: jest.fn(),
  };
  const mockAuditLogService = { log: jest.fn() };
  const mockConfigService = { get: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockUtilityService.resolveChurchName.mockResolvedValue('Test Church');
    mockMemberRepository.findOneBy.mockResolvedValue(null);
    mockMemberRepository.find.mockResolvedValue([]);
    mockDepartmentRepository.find.mockResolvedValue([]);

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

  describe('updateImportRow', () => {
    const admin = { id: 'admin-1', member: { id: 'member-1' } } as any;
    const makeRow = (
      id: string,
      rowNumber: number,
      email: string,
      errors: string[] = [],
    ) => ({
      id,
      rowNumber,
      data: { firstname: 'Jane', lastname: 'Doe', email },
      errors,
      status: MemberImportRowStatus.PENDING,
      commitError: null,
    });

    beforeEach(() => {
      (service.getJob as jest.Mock).mockResolvedValue({
        id: 'job-1',
        originalFilename: 'import.xlsx',
        status: 'READY_FOR_REVIEW',
        totalRows: 2,
        validRows: 0,
      });
    });

    it('saves normalized corrections and recomputes every row and the valid count', async () => {
      mockRowRepository.find.mockResolvedValueOnce([
        makeRow('row-1', 2, '[object object]', ['email must be an email']),
        makeRow('row-2', 3, 'other@test.com'),
      ]);

      const result = await service.updateImportRow(
        'job-1',
        'row-1',
        { email: ' Fixed@Test.com ', department: ' Media ' },
        admin,
      );

      expect(result.rows[0].data.email).toBe('fixed@test.com');
      expect(result.rows[0].data.department).toBe('Media');
      expect(result.rows[0].errors).toContain('Unknown department: "Media"');
      expect(result.validRows).toBe(1);
      expect(service.getJob).toHaveBeenCalledWith('job-1', true);
      expect(mockMemberRepository.find).toHaveBeenCalledTimes(1);
      expect(mockDepartmentRepository.find).toHaveBeenCalledTimes(1);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'MEMBER_IMPORT_ROW_UPDATED',
        expect.objectContaining({
          actorId: 'member-1',
          metadata: expect.objectContaining({
            changedFields: ['email', 'department'],
          }),
        }),
      );
    });

    it('clears another row duplicate error when the earlier email is corrected', async () => {
      mockRowRepository.find.mockResolvedValueOnce([
        makeRow('row-1', 2, 'dup@test.com'),
        makeRow('row-2', 3, 'dup@test.com', ['Duplicate email in file']),
      ]);
      const result = await service.updateImportRow(
        'job-1',
        'row-1',
        { email: 'unique@test.com' },
        admin,
      );
      expect(result.rows.every((row) => row.errors.length === 0)).toBe(true);
      expect(result.validRows).toBe(2);
      expect(mockMemberRepository.create).not.toHaveBeenCalled();
      expect(mockMemberRepository.manager.transaction).not.toHaveBeenCalled();
    });

    it('flags duplicates introduced by a correction', async () => {
      mockRowRepository.find.mockResolvedValueOnce([
        makeRow('row-1', 2, 'first@test.com'),
        makeRow('row-2', 3, 'second@test.com'),
      ]);
      const result = await service.updateImportRow(
        'job-1',
        'row-1',
        { email: 'second@test.com' },
        admin,
      );
      expect(result.rows[1].errors).toContain(
        'Duplicate email in file — also used on row 2',
      );
      expect(result.validRows).toBe(1);
    });

    it('retains invalid numeric-field errors across later corrections', async () => {
      mockRowRepository.find.mockResolvedValueOnce([
        makeRow('row-1', 2, 'first@test.com'),
      ]);
      const first = await service.updateImportRow(
        'job-1',
        'row-1',
        { birthDay: 'invalid' },
        admin,
      );
      expect(first.rows[0].errors).toContain(
        'birthDay must be an integer number',
      );
      mockRowRepository.find.mockResolvedValueOnce(first.rows);
      const second = await service.updateImportRow(
        'job-1',
        'row-1',
        { lastname: 'Corrected' },
        admin,
      );
      expect(second.rows[0].errors).toContain(
        'birthDay must be an integer number',
      );
    });

    it('supports clearing optional fields', async () => {
      const row = makeRow('row-1', 2, 'first@test.com');
      Object.assign(row.data, { department: 'Unknown', phoneNumber: 'bad' });
      mockRowRepository.find.mockResolvedValueOnce([row]);
      const result = await service.updateImportRow(
        'job-1',
        'row-1',
        { department: null, phoneNumber: '' },
        admin,
      );
      expect(result.rows[0].data.department).toBeUndefined();
      expect(result.rows[0].errors).toEqual([]);
    });

    it('rejects a row belonging to another job', async () => {
      mockRowRepository.find.mockResolvedValueOnce([
        makeRow('row-1', 2, 'first@test.com'),
      ]);
      await expect(
        service.updateImportRow(
          'job-1',
          'other-row',
          { email: 'fixed@test.com' },
          admin,
        ),
      ).rejects.toThrow('Import row not found in this job');
      expect(mockRowRepository.save).not.toHaveBeenCalled();
    });

    it('rejects editing a committed job', async () => {
      (service.getJob as jest.Mock).mockResolvedValueOnce({
        id: 'job-1',
        status: 'COMMITTED',
      });
      await expect(
        service.updateImportRow(
          'job-1',
          'row-1',
          { email: 'fixed@test.com' },
          admin,
        ),
      ).rejects.toThrow('Only imports ready for review can be edited');
      expect(mockRowRepository.find).not.toHaveBeenCalled();
    });

    it.each([{ role: 'ADMIN' }, { email: { text: 'bad' } }, {}])(
      'rejects unsupported fields or structured draft values',
      async (changes) => {
        await expect(
          service.updateImportRow('job-1', 'row-1', changes, admin),
        ).rejects.toThrow(BadRequestException);
        expect(mockRowRepository.save).not.toHaveBeenCalled();
      },
    );
  });

  describe('generateTemplate', () => {
    it('uses the existing job primary key for a shared pessimistic write lock', async () => {
      (service.getJob as jest.Mock).mockRestore();
      mockJobRepository.findOne.mockResolvedValueOnce({ id: 'job-1' });
      await service.getJob('job-1', true);
      expect(mockJobRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        lock: { mode: 'pessimistic_write' },
      });
    });

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

    it.each([
      { text: ' Jane@Test.com ', hyperlink: 'mailto:Jane@Test.com' },
      { richText: [{ text: ' Jane@' }, { text: 'Test.com ' }] },
      { formula: 'LOWER("Jane@Test.com")', result: 'jane@test.com' },
    ] as ExcelJS.CellValue[])(
      'extracts the email text from structured Excel cells',
      async (emailCell) => {
        const buffer = await buildXlsxBuffer([['Jane', 'Doe', emailCell]]);

        await service.previewImport(makeFile(buffer), admin);

        const savedRows = mockRowRepository.save.mock.calls[0][0];
        expect(savedRows).toHaveLength(1);
        expect(savedRows[0].data.email).toBe('jane@test.com');
        expect(savedRows[0].errors).toEqual([]);
        expect(mockMemberRepository.find).toHaveBeenCalledWith(
          expect.objectContaining({
            select: ['email'],
          }),
        );
      },
    );

    it('does not replace invalid displayed text with the hyperlink destination', async () => {
      const buffer = await buildXlsxBuffer([
        [
          'Jane',
          'Doe',
          {
            text: 'Contact Jane',
            hyperlink: 'mailto:jane@test.com',
          },
        ],
      ]);

      await service.previewImport(makeFile(buffer), admin);

      const savedRows = mockRowRepository.save.mock.calls[0][0];
      expect(savedRows[0].data.email).toBe('contact jane');
      expect(savedRows[0].errors).toContain('email must be an email');
    });

    it('detects duplicates across hyperlink and plain-text email cells', async () => {
      const buffer = await buildXlsxBuffer([
        [
          'Jane',
          'Doe',
          { text: ' Jane@Test.com ', hyperlink: 'mailto:Jane@Test.com' },
        ],
        ['John', 'Doe', 'jane@test.com'],
      ]);

      await service.previewImport(makeFile(buffer), admin);

      const savedRows = mockRowRepository.save.mock.calls[0][0];
      expect(savedRows[0].errors).toEqual([]);
      expect(savedRows[1].errors).toContain(
        'Duplicate email in file — also used on row 2',
      );
      expect(mockMemberRepository.find).toHaveBeenCalledTimes(1);
    });

    it('retains invalid numeric spreadsheet text in persisted draft data', async () => {
      const buffer = await buildXlsxBuffer([
        ['Jane', 'Doe', 'jane@test.com', '', '', 'not-a-day'],
      ]);
      await service.previewImport(makeFile(buffer), admin);
      const savedRows = mockRowRepository.save.mock.calls[0][0];
      const persisted = JSON.parse(JSON.stringify(savedRows[0].data));
      expect(persisted.birthDay).toBe('not-a-day');
      expect(savedRows[0].errors).toContain(
        'birthDay must be an integer number',
      );
    });

    it('retains unrecognized boolean text as a validation error', async () => {
      const values: ExcelJS.CellValue[] = ['Jane', 'Doe', 'jane@test.com'];
      values[11] = 'not sure';
      const buffer = await buildXlsxBuffer([values]);
      await service.previewImport(makeFile(buffer), admin);
      const savedRows = mockRowRepository.save.mock.calls[0][0];
      expect(savedRows[0].data.baptizedWithHolyGhost).toBe('not sure');
      expect(savedRows[0].errors).toContain(
        'baptizedWithHolyGhost must be a boolean value',
      );
    });

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

    it('normalizes a national-format phone number to E.164 in the import preview', async () => {
      mockConfigService.get.mockImplementation((key: string) =>
        key === 'CURRENCY_LOCALE' ? 'en-NG' : undefined,
      );
      const buffer = await buildXlsxBuffer([
        [
          'Jane',
          'Doe',
          'jane-phone@test.com',
          '08012345678',
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
      expect(savedRows[0].data.phoneNumber).toBe('+2348012345678');
    });

    it('flags an invalid phone number during import preview', async () => {
      const buffer = await buildXlsxBuffer([
        [
          'Jane',
          'Doe',
          'jane-invalid-phone@test.com',
          '07012',
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
        'Phone Number is invalid for NG; include the country code for international numbers.',
      );
    });

    it('flags a row whose email already exists in the DB', async () => {
      mockMemberRepository.find.mockResolvedValueOnce([
        { email: 'jane@test.com' },
      ]);
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
