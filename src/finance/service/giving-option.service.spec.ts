import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { GivingOptionService } from './giving-option.service';
import { GivingOption } from '../entity/giving-option.entity';
import { Fund } from '../entity/fund.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';

const mockAdmin = { id: 'admin-1' } as any;

const mockGivingOptionRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
};

const mockFundRepo = {
  findOne: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };

describe('GivingOptionService', () => {
  let service: GivingOptionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GivingOptionService,
        {
          provide: getRepositoryToken(GivingOption),
          useValue: mockGivingOptionRepo,
        },
        { provide: getRepositoryToken(Fund), useValue: mockFundRepo },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();
    service = module.get<GivingOptionService>(GivingOptionService);
  });

  describe('create', () => {
    it('creates a giving option with no fund', async () => {
      mockGivingOptionRepo.findOne.mockResolvedValue(null);
      const option = { id: 'go-1', name: 'General Giving', fund: null };
      mockGivingOptionRepo.create.mockReturnValue(option);
      mockGivingOptionRepo.save.mockResolvedValue(option);

      const result = await service.create(
        { name: 'General Giving' },
        mockAdmin,
      );

      expect(result).toEqual(option);
      expect(mockFundRepo.findOne).not.toHaveBeenCalled();
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'GIVING_OPTION_CREATED',
        expect.any(Object),
      );
    });

    it('resolves and attaches the fund when fundId is given', async () => {
      mockGivingOptionRepo.findOne.mockResolvedValue(null);
      const fund = { id: 'fund-1', name: 'Building Fund' };
      mockFundRepo.findOne.mockResolvedValue(fund);
      mockGivingOptionRepo.create.mockImplementation((v) => v);
      mockGivingOptionRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.create(
        { name: 'Building', fundId: 'fund-1' },
        mockAdmin,
      );

      expect(result.fund).toEqual(fund);
    });

    it('throws NotFoundException when fundId does not resolve', async () => {
      mockGivingOptionRepo.findOne.mockResolvedValue(null);
      mockFundRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create({ name: 'Building', fundId: 'missing' }, mockAdmin),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when name already exists', async () => {
      mockGivingOptionRepo.findOne.mockResolvedValue({
        id: 'go-1',
        name: 'Tithe',
      });
      await expect(
        service.create({ name: 'Tithe' }, mockAdmin),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAllActive', () => {
    it('returns only active giving options ordered by name', async () => {
      const options = [{ id: 'go-1', name: 'Tithe', isActive: true }];
      mockGivingOptionRepo.find.mockResolvedValue(options);

      const result = await service.findAllActive();

      expect(mockGivingOptionRepo.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { name: 'ASC' },
      });
      expect(result).toEqual(options);
    });
  });

  describe('findOne', () => {
    it('returns the giving option when found', async () => {
      const option = { id: 'go-1', name: 'Tithe' };
      mockGivingOptionRepo.findOne.mockResolvedValue(option);
      await expect(service.findOne('go-1')).resolves.toEqual(option);
    });

    it('throws NotFoundException when not found', async () => {
      mockGivingOptionRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates fields and keeps the existing fund when fundId is not provided', async () => {
      const option = {
        id: 'go-1',
        name: 'Tithe',
        description: null,
        isActive: true,
        fund: { id: 'fund-1' },
      };
      mockGivingOptionRepo.findOne.mockResolvedValue(option);
      mockGivingOptionRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.update(
        'go-1',
        { name: 'Updated' },
        mockAdmin,
      );

      expect(result.name).toBe('Updated');
      expect(result.fund).toEqual({ id: 'fund-1' });
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'GIVING_OPTION_UPDATED',
        expect.any(Object),
      );
    });

    it('re-resolves the fund when a new fundId is provided', async () => {
      const option = {
        id: 'go-1',
        name: 'Tithe',
        description: null,
        isActive: true,
        fund: { id: 'fund-1' },
      };
      mockGivingOptionRepo.findOne.mockResolvedValue(option);
      mockGivingOptionRepo.save.mockImplementation((v) => Promise.resolve(v));
      mockFundRepo.findOne.mockResolvedValue({ id: 'fund-2' });

      const result = await service.update(
        'go-1',
        { fundId: 'fund-2' },
        mockAdmin,
      );

      expect(result.fund).toEqual({ id: 'fund-2' });
    });
  });
});
