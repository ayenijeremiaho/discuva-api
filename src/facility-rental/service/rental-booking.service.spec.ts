import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { RentalBookingService } from './rental-booking.service';
import { RentalBooking } from '../entity/rental-booking.entity';
import { RentalBookingAddon } from '../entity/rental-booking-addon.entity';
import { RentalPayment } from '../entity/rental-payment.entity';
import { RentalFacility } from '../entity/rental-facility.entity';
import { RentalPricingTier } from '../entity/rental-pricing-tier.entity';
import { RentalAddon } from '../entity/rental-addon.entity';
import { RentalCalendarBlock } from '../entity/rental-calendar-block.entity';
import { Member } from '../../member/entity/member.entity';
import { DepartmentLead } from '../../department/entity/department-lead.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import {
  RentalDiscountSource,
  RentalDiscountType,
  RentalMemberCategory,
} from '../enum/rental.enum';

const mockBookingRepo = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
};
const mockBookingAddonRepo = { create: jest.fn(), save: jest.fn() };
const mockPaymentRepo = { save: jest.fn() };
const mockFacilityRepo = { findOne: jest.fn(), findOneBy: jest.fn() };
const mockTierRepo = { findOne: jest.fn() };
const mockAddonRepo = { findOne: jest.fn() };
const mockBlockRepo = { createQueryBuilder: jest.fn() };
const mockMemberRepo = { findOneBy: jest.fn() };
const mockDeptLeadRepo = { exists: jest.fn() };
const mockWorkerRepo = { findOne: jest.fn() };

const makeQb = (result: any) => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getOne: jest.fn().mockResolvedValue(result),
  getMany: jest.fn().mockResolvedValue(result ?? []),
});

describe('RentalBookingService', () => {
  let service: RentalBookingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RentalBookingService,
        {
          provide: getRepositoryToken(RentalBooking),
          useValue: mockBookingRepo,
        },
        {
          provide: getRepositoryToken(RentalBookingAddon),
          useValue: mockBookingAddonRepo,
        },
        {
          provide: getRepositoryToken(RentalPayment),
          useValue: mockPaymentRepo,
        },
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
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        {
          provide: getRepositoryToken(DepartmentLead),
          useValue: mockDeptLeadRepo,
        },
        {
          provide: getRepositoryToken(WorkerProfile),
          useValue: mockWorkerRepo,
        },
      ],
    }).compile();
    service = module.get<RentalBookingService>(RentalBookingService);
  });

  it('should be defined', () => expect(service).toBeDefined());

  describe('computePricing', () => {
    it('applies no discount when tier is null', () => {
      const result = service.computePricing(50000, [], null, null);
      expect(result.serviceFee).toBe(50000);
      expect(result.discountSource).toBe(RentalDiscountSource.NONE);
    });

    it('applies percentage tier discount to total (base + addons)', () => {
      const tier = {
        discountType: RentalDiscountType.PERCENTAGE,
        discountValue: 20,
        memberCategory: RentalMemberCategory.WORKER,
        isActive: true,
      } as any;
      const addons = [
        { addon: { price: 10000, cautionAmount: 2000 } as any, quantity: 1 },
      ];
      const result = service.computePricing(50000, addons, tier, null);
      expect(result.serviceFee).toBe(48000); // (50000 + 10000) * 0.8
      expect(result.cautionTotal).toBe(2000); // caution not discounted
      expect(result.grandTotal).toBe(50000);
      expect(result.discountSource).toBe(RentalDiscountSource.TIER);
    });

    it('applies flat override discount, override takes precedence over tier', () => {
      const tier = {
        discountType: RentalDiscountType.PERCENTAGE,
        discountValue: 10,
        memberCategory: RentalMemberCategory.MEMBER,
        isActive: true,
      } as any;
      const result = service.computePricing(50000, [], tier, {
        type: RentalDiscountType.FLAT,
        value: 5000,
      });
      expect(result.serviceFee).toBe(45000);
      expect(result.discountSource).toBe(RentalDiscountSource.OVERRIDE);
    });

    it('does not discount below zero on flat discount', () => {
      const result = service.computePricing(1000, [], null, {
        type: RentalDiscountType.FLAT,
        value: 99999,
      });
      expect(result.serviceFee).toBe(0);
    });
  });

  describe('createBooking', () => {
    it('throws when facility not found', async () => {
      mockFacilityRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createBooking('mem-1', {
          facilityId: 'bad',
          startDateTime: '2026-08-01T09:00:00Z',
          endDateTime: '2026-08-01T17:00:00Z',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when end is before start', async () => {
      mockFacilityRepo.findOne.mockResolvedValue({
        id: 'fac-1',
        basePrice: 50000,
        isActive: true,
      });
      mockMemberRepo.findOneBy.mockResolvedValue({ id: 'mem-1' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(makeQb(null));
      mockBlockRepo.createQueryBuilder.mockReturnValue(makeQb(null));
      await expect(
        service.createBooking('mem-1', {
          facilityId: 'fac-1',
          startDateTime: '2026-08-01T17:00:00Z',
          endDateTime: '2026-08-01T09:00:00Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws on overlapping booking', async () => {
      mockFacilityRepo.findOne.mockResolvedValue({
        id: 'fac-1',
        basePrice: 50000,
        isActive: true,
      });
      mockMemberRepo.findOneBy.mockResolvedValue({ id: 'mem-1' });
      mockBookingRepo.createQueryBuilder.mockReturnValue(
        makeQb({ id: 'existing' }),
      );
      await expect(
        service.createBooking('mem-1', {
          facilityId: 'fac-1',
          startDateTime: '2026-08-01T09:00:00Z',
          endDateTime: '2026-08-01T17:00:00Z',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
