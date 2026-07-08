import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RentalConfigService } from './rental-config.service';
import { RentalFacility } from '../entity/rental-facility.entity';
import { RentalPricingTier } from '../entity/rental-pricing-tier.entity';
import { RentalAddon } from '../entity/rental-addon.entity';
import { RentalCalendarBlock } from '../entity/rental-calendar-block.entity';
import { Asset } from '../../asset-management/entity/asset.entity';
import { RentalDiscountType, RentalMemberCategory } from '../enum/rental.enum';

const mockFacilityRepo = {
  exists: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findOneBy: jest.fn(),
};
const mockTierRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findOneBy: jest.fn(),
  remove: jest.fn(),
};
const mockAddonRepo = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
};
const mockBlockRepo = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findOneBy: jest.fn(),
  remove: jest.fn(),
};
const mockAssetRepo = { findOne: jest.fn() };

describe('RentalConfigService', () => {
  let service: RentalConfigService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RentalConfigService,
        {
          provide: getRepositoryToken(RentalFacility),
          useValue: mockFacilityRepo,
        },
        {
          provide: getRepositoryToken(RentalPricingTier),
          useValue: mockTierRepo,
        },
        { provide: getRepositoryToken(RentalAddon), useValue: mockAddonRepo },
        {
          provide: getRepositoryToken(RentalCalendarBlock),
          useValue: mockBlockRepo,
        },
        { provide: getRepositoryToken(Asset), useValue: mockAssetRepo },
      ],
    }).compile();
    service = module.get<RentalConfigService>(RentalConfigService);
  });

  it('should be defined', () => expect(service).toBeDefined());

  describe('createFacility', () => {
    it('throws if name already exists', async () => {
      mockFacilityRepo.exists.mockResolvedValue(true);
      await expect(
        service.createFacility({ name: 'Hall A', basePrice: 50000 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates and returns facility', async () => {
      mockFacilityRepo.exists.mockResolvedValue(false);
      const facility = { id: 'fac-1', name: 'Hall A', basePrice: 50000 };
      mockFacilityRepo.create.mockReturnValue(facility);
      mockFacilityRepo.save.mockResolvedValue(facility);
      const result = await service.createFacility({
        name: 'Hall A',
        basePrice: 50000,
      });
      expect(result).toEqual(facility);
    });
  });

  describe('upsertPricingTier', () => {
    it('creates new tier if none exists', async () => {
      mockTierRepo.findOne.mockResolvedValue(null);
      const tier = {
        id: 'tier-1',
        memberCategory: RentalMemberCategory.WORKER,
      };
      mockTierRepo.create.mockReturnValue(tier);
      mockTierRepo.save.mockResolvedValue(tier);
      const result = await service.upsertPricingTier({
        memberCategory: RentalMemberCategory.WORKER,
        discountType: RentalDiscountType.PERCENTAGE,
        discountValue: 20,
      });
      expect(result).toEqual(tier);
    });

    it('updates existing tier', async () => {
      const existing = {
        id: 'tier-1',
        memberCategory: RentalMemberCategory.WORKER,
        discountValue: 10,
      };
      mockTierRepo.findOne.mockResolvedValue(existing);
      mockTierRepo.save.mockResolvedValue({ ...existing, discountValue: 20 });
      const result = await service.upsertPricingTier({
        memberCategory: RentalMemberCategory.WORKER,
        discountType: RentalDiscountType.PERCENTAGE,
        discountValue: 20,
      });
      expect(result.discountValue).toBe(20);
    });
  });

  describe('getFacilityById', () => {
    it('throws if not found', async () => {
      mockFacilityRepo.findOneBy.mockResolvedValue(null);
      await expect(service.getFacilityById('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
