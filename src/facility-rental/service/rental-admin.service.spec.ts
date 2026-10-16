import { Test, TestingModule } from '@nestjs/testing';
import { RentalNotifierService } from './rental-notifier.service';

const mockNotifier = {
  confirmed: jest.fn().mockResolvedValue(undefined),
  rejected: jest.fn().mockResolvedValue(undefined),
  paymentReceived: jest.fn().mockResolvedValue(undefined),
  cautionRefunded: jest.fn().mockResolvedValue(undefined),
};
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
        { provide: RentalNotifierService, useValue: mockNotifier },
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
      expect(mockNotifier.confirmed).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'b-1' }),
      );
    });

    it('counts the confirmation as the reminder when the booking starts within a day', async () => {
      const soon = {
        id: 'b-2',
        status: RentalBookingStatus.PENDING,
        startDateTime: new Date(Date.now() + 3_600_000),
      };
      const later = {
        id: 'b-3',
        status: RentalBookingStatus.PENDING,
        startDateTime: new Date(Date.now() + 5 * 86_400_000),
      };
      mockBookingRepo.save.mockImplementation((b) => Promise.resolve(b));
      mockBookingService.getBookingById.mockResolvedValueOnce(soon);
      await service.confirmBooking('b-2', {});
      mockBookingService.getBookingById.mockResolvedValueOnce(later);
      await service.confirmBooking('b-3', {});
      expect(soon).toEqual(
        expect.objectContaining({ reminderSentAt: expect.any(Date) }),
      );
      expect(later).not.toHaveProperty('reminderSentAt');
    });

    it('tells the renter when a booking is not approved', async () => {
      const booking = { id: 'b-4', status: RentalBookingStatus.PENDING };
      mockBookingService.getBookingById.mockResolvedValue(booking);
      mockBookingRepo.save.mockImplementation((b) => Promise.resolve(b));
      await service.rejectBooking('b-4', { rejectionReason: 'Closed' });
      expect(mockNotifier.rejected).toHaveBeenCalledWith(
        expect.objectContaining({ rejectionReason: 'Closed' }),
      );
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
      expect(mockPaymentRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          relations: ['booking', 'booking.member', 'booking.facility'],
        }),
      );
      expect(mockNotifier.paymentReceived).toHaveBeenCalled();
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
