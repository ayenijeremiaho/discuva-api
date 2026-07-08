import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RentalAdminService } from './rental-admin.service';
import { RentalBookingService } from './rental-booking.service';
import { RentalBooking } from '../entity/rental-booking.entity';
import { RentalPayment } from '../entity/rental-payment.entity';
import { RentalBookingAddon } from '../entity/rental-booking-addon.entity';
import { RentalPricingTier } from '../entity/rental-pricing-tier.entity';
import { RentalAddon } from '../entity/rental-addon.entity';
import {
  RentalBookingStatus,
  RentalDiscountType,
  RentalMemberCategory,
  RentalPaymentStatus,
  RentalPaymentType,
} from '../enum/rental.enum';

const mockBookingRepo = { find: jest.fn(), save: jest.fn() };
const mockPaymentRepo = {
  findOne: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
};
const mockBookingAddonRepo = { find: jest.fn() };
const mockTierRepo = { findOne: jest.fn() };
const mockAddonRepo = {};

const mockBookingService = {
  getBookingById: jest.fn(),
  computePricing: jest.fn(),
};

describe('RentalAdminService', () => {
  let service: RentalAdminService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RentalAdminService,
        {
          provide: getRepositoryToken(RentalBooking),
          useValue: mockBookingRepo,
        },
        {
          provide: getRepositoryToken(RentalPayment),
          useValue: mockPaymentRepo,
        },
        {
          provide: getRepositoryToken(RentalBookingAddon),
          useValue: mockBookingAddonRepo,
        },
        {
          provide: getRepositoryToken(RentalPricingTier),
          useValue: mockTierRepo,
        },
        { provide: getRepositoryToken(RentalAddon), useValue: mockAddonRepo },
        { provide: RentalBookingService, useValue: mockBookingService },
      ],
    }).compile();
    service = module.get<RentalAdminService>(RentalAdminService);
  });

  it('should be defined', () => expect(service).toBeDefined());

  describe('confirmBooking', () => {
    it('throws if booking is not PENDING', async () => {
      mockBookingService.getBookingById.mockResolvedValue({
        id: 'b-1',
        status: RentalBookingStatus.CONFIRMED,
      });
      await expect(service.confirmBooking('b-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('confirms a pending booking', async () => {
      const booking = {
        id: 'b-1',
        status: RentalBookingStatus.PENDING,
        notes: null,
      };
      mockBookingService.getBookingById.mockResolvedValue(booking);
      mockBookingRepo.save.mockResolvedValue({
        ...booking,
        status: RentalBookingStatus.CONFIRMED,
      });
      const result = await service.confirmBooking('b-1', {});
      expect(result.status).toBe(RentalBookingStatus.CONFIRMED);
    });
  });

  describe('markPaymentPaid', () => {
    it('throws if payment not found', async () => {
      mockPaymentRepo.findOne.mockResolvedValue(null);
      await expect(service.markPaymentPaid('pay-1', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws if already paid', async () => {
      mockPaymentRepo.findOne.mockResolvedValue({
        id: 'pay-1',
        status: RentalPaymentStatus.PAID,
        type: RentalPaymentType.SERVICE_FEE,
      });
      await expect(service.markPaymentPaid('pay-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('marks payment as paid', async () => {
      const payment = {
        id: 'pay-1',
        status: RentalPaymentStatus.PENDING,
        type: RentalPaymentType.SERVICE_FEE,
      };
      mockPaymentRepo.findOne.mockResolvedValue(payment);
      mockPaymentRepo.save.mockResolvedValue({
        ...payment,
        status: RentalPaymentStatus.PAID,
      });
      const result = await service.markPaymentPaid('pay-1', {
        reference: 'TXN123',
      });
      expect(result.status).toBe(RentalPaymentStatus.PAID);
    });
  });

  describe('markCautionRefunded', () => {
    it('throws if not a caution payment', async () => {
      mockPaymentRepo.findOne.mockResolvedValue({
        id: 'pay-1',
        type: RentalPaymentType.SERVICE_FEE,
        status: RentalPaymentStatus.PAID,
      });
      await expect(service.markCautionRefunded('pay-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws if caution not yet paid', async () => {
      mockPaymentRepo.findOne.mockResolvedValue({
        id: 'pay-1',
        type: RentalPaymentType.CAUTION,
        status: RentalPaymentStatus.PENDING,
      });
      await expect(service.markCautionRefunded('pay-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('applyOverrideDiscount', () => {
    it('throws on completed booking', async () => {
      mockBookingService.getBookingById.mockResolvedValue({
        id: 'b-1',
        status: RentalBookingStatus.COMPLETED,
        memberCategory: RentalMemberCategory.MEMBER,
        basePrice: 50000,
      });
      await expect(
        service.applyOverrideDiscount('b-1', {
          overrideDiscountType: RentalDiscountType.FLAT,
          overrideDiscountValue: 5000,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
