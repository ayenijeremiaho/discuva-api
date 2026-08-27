import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { TransactionHost } from '@nestjs-cls/transactional';
import { BadRequestException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { ReconciliationService } from './reconciliation.service';
import { BulkUploadJob } from '../entity/bulk-upload-job.entity';
import { ReconciliationRow } from '../entity/reconciliation-row.entity';
import { JournalEntry } from '../entity/journal-entry.entity';
import { JournalEntryLine } from '../entity/journal-entry-line.entity';
import {
  BulkUploadJobStatus,
  JournalLineType,
  ReconciliationRowStatus,
} from '../enum/finance.enum';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { RECONCILIATION_QUEUE } from '../processor/reconciliation.processor';
import { BankImportProfileService } from './bank-import-profile.service';

const mockClsService = {
  get: jest.fn(),
  isActive: jest.fn().mockReturnValue(false),
  getId: jest.fn(),
};

const mockJobRepo = {
  findOne: jest.fn(),
};

const mockRowRepo = {
  find: jest.fn(),
};

const mockJournalEntryRepo = {
  find: jest.fn().mockResolvedValue([]),
};

const mockJournalEntryLineRepo = {};

const mockQueue = { add: jest.fn() };

const mockAuditLogService = { log: jest.fn() };

const mockBankImportProfileService = {
  findOne: jest.fn(),
  findDefault: jest.fn(),
};

const mockTxManager = {
  create: jest.fn((entity, data) => data),
  save: jest.fn(),
  query: jest.fn().mockResolvedValue(undefined),
};

const mockTxHost = { tx: mockTxManager };

describe('ReconciliationService', () => {
  let service: ReconciliationService;
  const admin = { id: 'admin-1' } as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockJournalEntryRepo.find.mockResolvedValue([]);
    mockTxManager.create.mockImplementation((_entity, data) => data);
    mockTxManager.query.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        { provide: getRepositoryToken(BulkUploadJob), useValue: mockJobRepo },
        {
          provide: getRepositoryToken(ReconciliationRow),
          useValue: mockRowRepo,
        },
        {
          provide: getRepositoryToken(JournalEntry),
          useValue: mockJournalEntryRepo,
        },
        {
          provide: getRepositoryToken(JournalEntryLine),
          useValue: mockJournalEntryLineRepo,
        },
        { provide: getQueueToken(RECONCILIATION_QUEUE), useValue: mockQueue },
        { provide: TransactionHost, useValue: mockTxHost },
        {
          provide: BankImportProfileService,
          useValue: mockBankImportProfileService,
        },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: ClsService, useValue: mockClsService },
      ],
    }).compile();

    service = module.get<ReconciliationService>(ReconciliationService);
  });

  describe('postConfirmedRows', () => {
    const job = { id: 'job-1', status: BulkUploadJobStatus.READY_FOR_REVIEW };
    const dto = {
      bankAccountId: 'bank-acct',
      accountingPeriodId: 'period-1',
    } as any;

    const makeRow = (overrides: Partial<ReconciliationRow> = {}) => ({
      id: 'row-1',
      creditDebit: 'CREDIT',
      amount: 1000,
      transactionDate: '2026-01-01',
      narration: 'Deposit',
      confirmedAccount: { id: 'acct-1' },
      status: ReconciliationRowStatus.CONFIRMED,
      ...overrides,
    });

    it('throws BadRequestException when the job has not been processed yet', async () => {
      mockJobRepo.findOne.mockResolvedValue({
        id: 'job-1',
        status: BulkUploadJobStatus.QUEUED,
      });

      await expect(
        service.postConfirmedRows('job-1', dto, admin),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when there are no confirmed rows', async () => {
      mockJobRepo.findOne.mockResolvedValue(job);
      mockRowRepo.find.mockResolvedValue([]);

      await expect(
        service.postConfirmedRows('job-1', dto, admin),
      ).rejects.toThrow(BadRequestException);
    });

    it('posts an eligible row: creates one entry, debit/credit lines, and marks the row POSTED', async () => {
      mockJobRepo.findOne.mockResolvedValue(job);
      const row = makeRow();
      mockRowRepo.find.mockResolvedValue([row]);
      mockJournalEntryRepo.find.mockResolvedValue([]); // nothing already posted
      mockTxManager.save.mockImplementation((entity, data) =>
        Promise.resolve(
          Array.isArray(data) ? data : { id: 'entry-1', ...data },
        ),
      );

      const result = await service.postConfirmedRows('job-1', dto, admin);

      expect(result).toEqual({ created: 1 });
      expect(row.status).toBe(ReconciliationRowStatus.POSTED);
      const lineSaveCall = mockTxManager.save.mock.calls.find((c) =>
        Array.isArray(c[1]),
      );
      const lines = lineSaveCall![1];
      expect(lines).toHaveLength(2);
      // Bank statement shows a CREDIT (money received) → the bank/asset
      // account is debited, the confirmed (income) account is credited.
      expect(
        lines.find((l: any) => l.entryType === JournalLineType.DEBIT).account
          .id,
      ).toBe('bank-acct');
      expect(
        lines.find((l: any) => l.entryType === JournalLineType.CREDIT).account
          .id,
      ).toBe('acct-1');
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'RECONCILIATION_ROWS_POSTED',
        expect.objectContaining({
          targetId: 'job-1',
          metadata: { created: 1 },
        }),
      );
      expect(mockTxManager.query).toHaveBeenCalledWith(
        expect.stringContaining('SAVEPOINT'),
      );
      expect(mockTxManager.query).toHaveBeenCalledWith(
        expect.stringContaining('RELEASE SAVEPOINT'),
      );
    });

    it('skips a row already posted, per the batched idempotency pre-check, without opening a savepoint for it', async () => {
      mockJobRepo.findOne.mockResolvedValue(job);
      const row = makeRow({ id: 'row-already-posted' });
      mockRowRepo.find.mockResolvedValue([row]);
      mockJournalEntryRepo.find.mockResolvedValue([
        { idempotencyKey: 'reconciliation-row:row-already-posted' },
      ]);

      const result = await service.postConfirmedRows('job-1', dto, admin);

      expect(result).toEqual({ created: 0 });
      expect(mockTxManager.query).not.toHaveBeenCalled();
    });

    it('skips a confirmed row with no confirmedAccount', async () => {
      mockJobRepo.findOne.mockResolvedValue(job);
      const row = makeRow({ confirmedAccount: null as any });
      mockRowRepo.find.mockResolvedValue([row]);

      const result = await service.postConfirmedRows('job-1', dto, admin);

      expect(result).toEqual({ created: 0 });
      expect(mockTxManager.query).not.toHaveBeenCalled();
    });

    it('rolls back to the savepoint and propagates a non-idempotency error from a row, matching pre-existing fail-fast behaviour', async () => {
      mockJobRepo.findOne.mockResolvedValue(job);
      const rowA = makeRow({ id: 'row-a' });
      const rowB = makeRow({ id: 'row-b' });
      mockRowRepo.find.mockResolvedValue([rowA, rowB]);
      mockJournalEntryRepo.find.mockResolvedValue([]);

      mockTxManager.save.mockRejectedValueOnce(
        new Error('unexpected FK violation'),
      );

      await expect(
        service.postConfirmedRows('job-1', dto, admin),
      ).rejects.toThrow('unexpected FK violation');

      // row-a's failure propagates (matches pre-existing no-catch-all
      // behaviour), but only after being attempted, and rolls back to its
      // own savepoint first — row-b is never reached since the loop stops
      // at the thrown error, same as before this fix.
      expect(mockTxManager.query).toHaveBeenCalledWith(
        expect.stringContaining('ROLLBACK TO SAVEPOINT'),
      );
      expect(mockTxManager.save).toHaveBeenCalledTimes(1);
    });

    it('treats a unique-constraint violation on insert as "already posted" rather than failing the batch', async () => {
      mockJobRepo.findOne.mockResolvedValue(job);
      const row = makeRow();
      mockRowRepo.find.mockResolvedValue([row]);
      mockJournalEntryRepo.find.mockResolvedValue([]);

      const dupError = new QueryFailedError('INSERT', [], new Error('dup'));
      (dupError as any).driverError = { code: '23505' };
      mockTxManager.save.mockRejectedValueOnce(dupError);

      const result = await service.postConfirmedRows('job-1', dto, admin);

      expect(result).toEqual({ created: 0 });
      expect(mockTxManager.query).toHaveBeenCalledWith(
        expect.stringContaining('ROLLBACK TO SAVEPOINT'),
      );
    });
  });
});
