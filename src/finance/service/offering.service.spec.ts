import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OfferingService } from './offering.service';
import { Offering } from '../entity/offering.entity';
import { JournalEntry } from '../entity/journal-entry.entity';
import { JournalEntryLine } from '../entity/journal-entry-line.entity';
import { Account } from '../entity/account.entity';
import { AccountingPeriod } from '../entity/accounting-period.entity';
import {
  AccountingPeriodStatus,
  JournalEntryStatus,
  JournalLineType,
  OfferingType,
} from '../enum/finance.enum';
import { AuditLogService } from '../../utility/service/audit-log.service';

const mockAdmin = { id: 'admin-1' } as any;

const mockOfferingRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockQb = {
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getOne: jest.fn(),
  getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
};

const mockAuditLogService = { log: jest.fn() };

const mockAccountRepo = { findOne: jest.fn(), save: jest.fn() };
const mockPeriodRepo = { findOne: jest.fn() };

const mockManager = {
  findOne: jest.fn(),
  create: jest.fn((_e: unknown, data: unknown) => data),
  save: jest.fn((_e: unknown, data: unknown) => Promise.resolve(data)),
};

const mockTxHost = { tx: mockManager };

describe('OfferingService', () => {
  let service: OfferingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockOfferingRepo.createQueryBuilder.mockReturnValue(mockQb);
    mockManager.findOne.mockReset().mockResolvedValue(null);
    mockManager.create
      .mockReset()
      .mockImplementation((_e: unknown, data: unknown) => data);
    mockManager.save
      .mockReset()
      .mockImplementation((_e: unknown, data: unknown) =>
        Promise.resolve(data),
      );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OfferingService,
        { provide: getRepositoryToken(Offering), useValue: mockOfferingRepo },
        {
          provide: getRepositoryToken(JournalEntry),
          useValue: { create: jest.fn(), save: jest.fn() },
        },
        {
          provide: getRepositoryToken(JournalEntryLine),
          useValue: { create: jest.fn(), save: jest.fn() },
        },
        { provide: getRepositoryToken(Account), useValue: mockAccountRepo },
        {
          provide: getRepositoryToken(AccountingPeriod),
          useValue: mockPeriodRepo,
        },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: TransactionHost, useValue: mockTxHost },
      ],
    }).compile();
    service = module.get<OfferingService>(OfferingService);
  });

  describe('create', () => {
    it('records a new offering', async () => {
      const offering = {
        id: 'o-1',
        type: OfferingType.GENERAL,
        cashAmount: 5000,
      };
      mockOfferingRepo.create.mockReturnValue(offering);
      mockOfferingRepo.save.mockResolvedValue(offering);

      const result = await service.create(
        { fundId: 'f-1', type: OfferingType.GENERAL, cashAmount: 5000 },
        mockAdmin,
      );
      expect(result.id).toBe('o-1');
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'OFFERING_RECORDED',
        expect.any(Object),
      );
    });
  });

  describe('reconcile', () => {
    it('marks offering as reconciled', async () => {
      const offering = {
        id: 'o-1',
        isReconciled: false,
        reconciledAt: null,
        notes: null,
      };
      const reconciled = { ...offering, isReconciled: true };
      mockQb.getOne
        .mockResolvedValueOnce(offering)
        .mockResolvedValueOnce(reconciled);
      mockOfferingRepo.save.mockResolvedValue(reconciled);

      const result = await service.reconcile(
        'o-1',
        { notes: 'Verified' },
        mockAdmin,
      );
      expect(result.isReconciled).toBe(true);
    });

    it('throws NotFoundException when offering missing', async () => {
      mockQb.getOne.mockResolvedValueOnce(null);
      await expect(
        service.reconcile('missing', { notes: 'x' }, mockAdmin),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when reconciler is the same admin who recorded it', async () => {
      mockQb.getOne.mockResolvedValueOnce({
        id: 'o-1',
        isReconciled: false,
        recordedBy: { id: 'admin-1' },
        reconciledAt: null,
        notes: null,
      });
      await expect(
        service.reconcile('o-1', { notes: 'self-review' }, mockAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    describe('autoJournal', () => {
      // Factory, not a shared object — OfferingService.reconcile() mutates
      // the offering it loads in place (offering.isReconciled = true), so a
      // single shared object would stay mutated across tests.
      const makeOffering = () => ({
        id: 'o-1',
        type: OfferingType.GENERAL,
        cashAmount: 3000,
        expectedTransferAmount: 2000,
        createdAt: new Date('2026-01-05'),
        isReconciled: false,
        reconciledAt: null,
        notes: null,
      });
      const autoJournalDto = {
        notes: 'Verified',
        autoJournal: true,
        debitAccountId: 'acc-debit',
        creditAccountId: 'acc-credit',
        accountingPeriodId: 'period-1',
      };
      const openPeriod = {
        id: 'period-1',
        status: AccountingPeriodStatus.OPEN,
      };

      beforeEach(() => {
        mockQb.getOne.mockReset();
        const offering = makeOffering();
        mockQb.getOne
          .mockResolvedValueOnce(offering)
          .mockResolvedValue({ ...offering, isReconciled: true });
        mockOfferingRepo.save.mockResolvedValue({
          ...offering,
          isReconciled: true,
        });
      });

      it('throws BadRequestException when the accounting period is closed', async () => {
        mockAccountRepo.findOne
          .mockResolvedValueOnce({ id: 'acc-debit' })
          .mockResolvedValueOnce({ id: 'acc-credit' });
        mockPeriodRepo.findOne.mockResolvedValue({
          id: 'period-1',
          status: AccountingPeriodStatus.CLOSED,
        });

        await expect(
          service.reconcile('o-1', autoJournalDto, mockAdmin),
        ).rejects.toThrow(BadRequestException);
      });

      it('is idempotent — skips creating a duplicate entry when one already exists', async () => {
        mockAccountRepo.findOne
          .mockResolvedValueOnce({ id: 'acc-debit' })
          .mockResolvedValueOnce({ id: 'acc-credit' });
        mockPeriodRepo.findOne.mockResolvedValue(openPeriod);
        mockManager.findOne.mockResolvedValueOnce({ id: 'existing-entry' });

        await service.reconcile('o-1', autoJournalDto, mockAdmin);

        expect(mockManager.save).not.toHaveBeenCalled();
      });

      it('creates a PENDING_APPROVAL journal entry with balanced debit/credit lines', async () => {
        mockAccountRepo.findOne
          .mockResolvedValueOnce({ id: 'acc-debit' })
          .mockResolvedValueOnce({ id: 'acc-credit' });
        mockPeriodRepo.findOne.mockResolvedValue(openPeriod);
        mockManager.findOne.mockResolvedValueOnce(null);
        mockManager.save.mockImplementation((_e: unknown, data: unknown) =>
          Promise.resolve(
            Array.isArray(data) ? data : { id: 'entry-1', ...(data as object) },
          ),
        );

        await service.reconcile('o-1', autoJournalDto, mockAdmin);

        expect(mockManager.save).toHaveBeenCalledWith(
          JournalEntry,
          expect.objectContaining({
            status: JournalEntryStatus.PENDING_APPROVAL,
            idempotencyKey: 'offering-auto-journal:o-1',
          }),
        );
        expect(mockManager.save).toHaveBeenCalledWith(
          JournalEntryLine,
          expect.arrayContaining([
            expect.objectContaining({
              entryType: JournalLineType.DEBIT,
              amount: 5000,
            }),
            expect.objectContaining({
              entryType: JournalLineType.CREDIT,
              amount: 5000,
            }),
          ]),
        );
        expect(mockAuditLogService.log).toHaveBeenCalledWith(
          'JOURNAL_ENTRY_CREATED',
          expect.objectContaining({ actorId: 'admin-1' }),
        );
      });
    });
  });
});
