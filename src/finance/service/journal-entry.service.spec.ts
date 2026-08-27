import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { JournalEntryService } from './journal-entry.service';
import { JournalEntry } from '../entity/journal-entry.entity';
import { JournalEntryLine } from '../entity/journal-entry-line.entity';
import { Account } from '../entity/account.entity';
import { AccountingPeriod } from '../entity/accounting-period.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';
import {
  AccountingPeriodStatus,
  JournalEntryStatus,
  JournalEntrySource,
  JournalEntryType,
  JournalLineType,
  NormalBalance,
} from '../enum/finance.enum';
import { Admin } from '../../admin/entity/admin.entity';

const mockEntryRepo = {};
const mockAccountRepo = {};
const mockPeriodRepo = {};
const mockAuditLogService = { log: jest.fn() };

const mockQueryBuilder = {
  where: jest.fn().mockReturnThis(),
  setLock: jest.fn().mockReturnThis(),
  getOne: jest.fn(),
  getMany: jest.fn(),
};

const mockManager = {
  query: jest.fn().mockResolvedValue(undefined),
  findOne: jest.fn().mockResolvedValue(null),
  create: jest.fn((_entity: unknown, data: object) => data),
  save: jest.fn((_entity: unknown, data: any) =>
    Promise.resolve(Array.isArray(data) ? data : { id: 'entry-1', ...data }),
  ),
  createQueryBuilder: jest.fn(() => mockQueryBuilder),
};

const mockTxHost = {
  tx: mockManager,
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};

const admin = { id: 'admin-1' } as Admin;
const otherAdmin = { id: 'admin-2' } as Admin;

const openPeriod = {
  id: 'period-1',
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  status: AccountingPeriodStatus.OPEN,
};

const closedPeriod = { ...openPeriod, status: AccountingPeriodStatus.CLOSED };

const expenseAccount = {
  id: 'acc-expense',
  name: 'Utilities',
  normalBalance: NormalBalance.DEBIT,
  currentBalance: 100,
};

const bankAccount = {
  id: 'acc-bank',
  name: 'Main Bank',
  normalBalance: NormalBalance.CREDIT,
  currentBalance: 100,
};

describe('JournalEntryService', () => {
  let service: JournalEntryService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockManager.query.mockResolvedValue(undefined);
    mockManager.findOne.mockResolvedValue(null);
    mockManager.create.mockImplementation((_e: unknown, data: object) => data);
    mockManager.save.mockImplementation((_e: unknown, data: any) =>
      Promise.resolve(Array.isArray(data) ? data : { id: 'entry-1', ...data }),
    );
    mockQueryBuilder.where.mockReturnThis();
    mockQueryBuilder.setLock.mockReturnThis();
    mockQueryBuilder.getOne.mockResolvedValue(null);
    mockQueryBuilder.getMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JournalEntryService,
        { provide: getRepositoryToken(JournalEntry), useValue: mockEntryRepo },
        { provide: getRepositoryToken(Account), useValue: mockAccountRepo },
        {
          provide: getRepositoryToken(AccountingPeriod),
          useValue: mockPeriodRepo,
        },
        { provide: TransactionHost, useValue: mockTxHost },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get<JournalEntryService>(JournalEntryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    const balancedDto = {
      date: '2026-01-01',
      description: 'Test entry',
      source: JournalEntrySource.MANUAL,
      entryType: JournalEntryType.STANDARD,
      accountingPeriodId: 'period-1',
      idempotencyKey: 'idem-1',
      lines: [
        {
          accountId: 'acc-expense',
          entryType: JournalLineType.DEBIT,
          amount: 50,
        },
        {
          accountId: 'acc-bank',
          entryType: JournalLineType.CREDIT,
          amount: 50,
        },
      ],
    } as any;

    it('rejects an unbalanced entry before touching the manager', async () => {
      const dto = {
        ...balancedDto,
        lines: [
          {
            accountId: 'acc-expense',
            entryType: JournalLineType.DEBIT,
            amount: 60,
          },
          {
            accountId: 'acc-bank',
            entryType: JournalLineType.CREDIT,
            amount: 50,
          },
        ],
      };

      await expect(service.create(dto, admin)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockManager.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the accounting period does not exist', async () => {
      mockManager.findOne.mockResolvedValueOnce(null);

      await expect(service.create(balancedDto, admin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when the accounting period is closed', async () => {
      mockManager.findOne.mockResolvedValueOnce(closedPeriod);

      await expect(service.create(balancedDto, admin)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when one or more accounts are not found', async () => {
      mockManager.findOne.mockResolvedValueOnce(openPeriod);
      mockQueryBuilder.getMany.mockResolvedValue([expenseAccount]); // only 1 of 2

      await expect(service.create(balancedDto, admin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('translates a 23505 idempotency-key constraint violation into ConflictException', async () => {
      mockManager.findOne.mockResolvedValueOnce(openPeriod);
      mockQueryBuilder.getMany.mockResolvedValue([expenseAccount, bankAccount]);
      mockManager.save.mockRejectedValueOnce({
        code: '23505',
        constraint: 'uq_finance_journal_entries_idempotency_key',
      });

      await expect(service.create(balancedDto, admin)).rejects.toThrow(
        ConflictException,
      );
    });

    it('rethrows non-23505 errors unchanged', async () => {
      mockManager.findOne.mockResolvedValueOnce(openPeriod);
      mockQueryBuilder.getMany.mockResolvedValue([expenseAccount, bankAccount]);
      mockManager.save.mockRejectedValueOnce(new Error('boom'));

      await expect(service.create(balancedDto, admin)).rejects.toThrow('boom');
    });

    it('creates a PENDING_APPROVAL entry, saves lines, and logs the audit event on success', async () => {
      mockManager.findOne.mockResolvedValueOnce(openPeriod);
      mockQueryBuilder.getMany.mockResolvedValue([expenseAccount, bankAccount]);

      const result = await service.create(balancedDto, admin);

      expect(mockManager.save).toHaveBeenCalledWith(
        JournalEntry,
        expect.objectContaining({
          status: JournalEntryStatus.PENDING_APPROVAL,
          idempotencyKey: 'idem-1',
        }),
      );
      expect(mockManager.save).toHaveBeenCalledWith(
        JournalEntryLine,
        expect.arrayContaining([
          expect.objectContaining({
            entryType: JournalLineType.DEBIT,
            amount: 50,
          }),
          expect.objectContaining({
            entryType: JournalLineType.CREDIT,
            amount: 50,
          }),
        ]),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'JOURNAL_ENTRY_CREATED',
        expect.objectContaining({ actorId: 'admin-1' }),
      );
      expect(result.status).toBe(JournalEntryStatus.PENDING_APPROVAL);
    });
  });

  // ── approve ─────────────────────────────────────────────────────────────

  describe('approve', () => {
    const pendingEntry = {
      id: 'entry-1',
      status: JournalEntryStatus.PENDING_APPROVAL,
      createdBy: { id: 'admin-1' },
      accountingPeriod: openPeriod,
      lines: [
        {
          entryType: JournalLineType.DEBIT,
          amount: 40,
          account: { id: 'acc-expense' },
        },
        {
          entryType: JournalLineType.DEBIT,
          amount: 40,
          account: { id: 'acc-bank' },
        },
      ],
    };

    it('throws NotFoundException when the entry does not exist (lock query)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);

      await expect(service.approve('entry-1', admin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when status is not PENDING_APPROVAL', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(pendingEntry);
      mockManager.findOne.mockResolvedValueOnce({
        ...pendingEntry,
        status: JournalEntryStatus.POSTED,
      });

      await expect(service.approve('entry-1', admin)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ForbiddenException when the approver is the creator', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(pendingEntry);
      mockManager.findOne.mockResolvedValueOnce(pendingEntry);

      await expect(service.approve('entry-1', admin)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws BadRequestException when the accounting period is closed', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(pendingEntry);
      mockManager.findOne
        .mockResolvedValueOnce(pendingEntry)
        .mockResolvedValueOnce(closedPeriod);

      await expect(service.approve('entry-1', otherAdmin)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('increases the normal-side account and decreases the contra-side account, and posts the entry', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(pendingEntry);
      mockManager.findOne
        .mockResolvedValueOnce(pendingEntry)
        .mockResolvedValueOnce(openPeriod);
      mockQueryBuilder.getMany.mockResolvedValue([
        { ...expenseAccount }, // DEBIT-normal, line is DEBIT -> normal side, +40
        { ...bankAccount }, // CREDIT-normal, line is DEBIT -> contra side, -40
      ]);

      const result = await service.approve('entry-1', otherAdmin);

      expect(mockManager.save).toHaveBeenCalledWith(
        Account,
        expect.arrayContaining([
          expect.objectContaining({ id: 'acc-expense', currentBalance: 140 }),
          expect.objectContaining({ id: 'acc-bank', currentBalance: 60 }),
        ]),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'JOURNAL_ENTRY_APPROVED',
        expect.objectContaining({ actorId: 'admin-2' }),
      );
      expect(result.status).toBe(JournalEntryStatus.POSTED);
    });
  });

  // ── void ────────────────────────────────────────────────────────────────

  describe('void', () => {
    const postedEntry = {
      id: 'entry-1',
      status: JournalEntryStatus.POSTED,
      idempotencyKey: 'idem-1',
      description: 'Original entry',
      source: JournalEntrySource.MANUAL,
      accountingPeriod: openPeriod,
      lines: [
        {
          entryType: JournalLineType.DEBIT,
          amount: 40,
          account: { id: 'acc-expense' },
        },
        {
          entryType: JournalLineType.CREDIT,
          amount: 40,
          account: { id: 'acc-bank' },
        },
      ],
    };

    it('throws NotFoundException when the entry does not exist', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);

      await expect(service.void('entry-1', admin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when already VOIDED', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(postedEntry);
      mockManager.findOne.mockResolvedValueOnce({
        ...postedEntry,
        status: JournalEntryStatus.VOIDED,
      });

      await expect(service.void('entry-1', admin)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws BadRequestException when status is not POSTED', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(postedEntry);
      mockManager.findOne.mockResolvedValueOnce({
        ...postedEntry,
        status: JournalEntryStatus.PENDING_APPROVAL,
      });

      await expect(service.void('entry-1', admin)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the accounting period is closed', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(postedEntry);
      mockManager.findOne.mockResolvedValueOnce({
        ...postedEntry,
        accountingPeriod: closedPeriod,
      });

      await expect(service.void('entry-1', admin)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ConflictException when a reversal already exists', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(postedEntry);
      mockManager.findOne
        .mockResolvedValueOnce(postedEntry)
        .mockResolvedValueOnce({ id: 'existing-reversal' });

      await expect(service.void('entry-1', admin)).rejects.toThrow(
        ConflictException,
      );
    });

    it('reverses account balances, creates a flipped-line reversal entry, and marks the original VOIDED', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(postedEntry);
      mockManager.findOne
        .mockResolvedValueOnce(postedEntry)
        .mockResolvedValueOnce(null); // no existing reversal
      mockQueryBuilder.getMany.mockResolvedValue([
        { ...expenseAccount },
        { ...bankAccount },
      ]);

      const result = await service.void('entry-1', admin);

      expect(mockManager.save).toHaveBeenCalledWith(
        JournalEntry,
        expect.objectContaining({
          id: 'entry-1',
          status: JournalEntryStatus.VOIDED,
        }),
      );
      expect(mockManager.save).toHaveBeenCalledWith(
        JournalEntryLine,
        expect.arrayContaining([
          expect.objectContaining({
            account: { id: 'acc-expense' },
            entryType: JournalLineType.CREDIT,
            amount: 40,
          }),
          expect.objectContaining({
            account: { id: 'acc-bank' },
            entryType: JournalLineType.DEBIT,
            amount: 40,
          }),
        ]),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'JOURNAL_ENTRY_VOIDED',
        expect.objectContaining({ actorId: 'admin-1', targetId: 'entry-1' }),
      );
      expect(result.status).toBe(JournalEntryStatus.POSTED);
      expect(result.entryType).toBe(JournalEntryType.REVERSAL);
    });
  });
});
