import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AccountService } from './account.service';
import { Account } from '../entity/account.entity';
import {
  AccountSubtype,
  AccountType,
  NormalBalance,
} from '../enum/finance.enum';
import { AuditLogService } from '../../utility/service/audit-log.service';

const mockAdmin = { id: 'admin-1' } as any;

const mockAccountRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockQb = {
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  addOrderBy: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([]),
};

const mockAuditLogService = { log: jest.fn() };

const baseCreateDto = {
  code: '1001',
  name: 'Main Bank',
  type: AccountType.ASSET,
  subtype: AccountSubtype.BANK,
  normalBalance: NormalBalance.DEBIT,
};

describe('AccountService', () => {
  let service: AccountService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAccountRepo.createQueryBuilder.mockReturnValue(mockQb);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: getRepositoryToken(Account), useValue: mockAccountRepo },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();
    service = module.get<AccountService>(AccountService);
  });

  describe('create', () => {
    it('creates a new account', async () => {
      mockAccountRepo.findOne.mockResolvedValue(null);
      const account = { id: 'a-1', ...baseCreateDto, currentBalance: 0 };
      mockAccountRepo.create.mockReturnValue(account);
      mockAccountRepo.save.mockResolvedValue(account);

      const result = await service.create(baseCreateDto, mockAdmin);
      expect(result.id).toBe('a-1');
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'ACCOUNT_CREATED',
        expect.any(Object),
      );
    });

    it('throws ConflictException when name already exists', async () => {
      mockAccountRepo.findOne.mockResolvedValue({ id: 'a-1' });
      await expect(service.create(baseCreateDto, mockAdmin)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException when code is already in use', async () => {
      mockAccountRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'a-2' });
      await expect(service.create(baseCreateDto, mockAdmin)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when not found', async () => {
      mockAccountRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('prevents deactivating an account with non-zero balance', async () => {
      const account = {
        id: 'a-1',
        currentBalance: 500,
        isActive: true,
        ...baseCreateDto,
      };
      mockAccountRepo.findOne.mockResolvedValue(account);
      await expect(
        service.update('a-1', { isActive: false }, mockAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows deactivating an account with zero balance', async () => {
      const account = {
        id: 'a-1',
        currentBalance: 0,
        isActive: true,
        code: '1001',
        name: 'Main Bank',
        fund: null,
        description: null,
        bankName: null,
        accountNumber: null,
        lowBalanceAlertThreshold: null,
      };
      mockAccountRepo.findOne.mockResolvedValue(account);
      mockAccountRepo.save.mockResolvedValue({ ...account, isActive: false });
      const result = await service.update(
        'a-1',
        { isActive: false },
        mockAdmin,
      );
      expect(result.isActive).toBe(false);
    });
  });
});
