import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RentalBooking } from '../entity/rental-booking.entity';
import { RentalPayment } from '../entity/rental-payment.entity';
import { RentalBookingAddon } from '../entity/rental-booking-addon.entity';
import { RentalPricingTier } from '../entity/rental-pricing-tier.entity';
import { RentalAddon } from '../entity/rental-addon.entity';
import {
  RentalBookingStatus,
  RentalDiscountSource,
  RentalPaymentStatus,
} from '../enum/rental.enum';
import {
  ApplyOverrideDiscountDto,
  ConfirmBookingDto,
  RejectBookingDto,
} from '../dto/rental-booking.dto';
import { MarkPaymentPaidDto } from '../dto/rental-payment.dto';
import { RentalBookingService } from './rental-booking.service';

@Injectable()
export class RentalAdminService {
  private readonly logger = new Logger(RentalAdminService.name);

  constructor(
    @InjectRepository(RentalBooking)
    private readonly bookingRepo: Repository<RentalBooking>,
    @InjectRepository(RentalPayment)
    private readonly paymentRepo: Repository<RentalPayment>,
    @InjectRepository(RentalBookingAddon)
    private readonly bookingAddonRepo: Repository<RentalBookingAddon>,
    @InjectRepository(RentalPricingTier)
    private readonly tierRepo: Repository<RentalPricingTier>,
    @InjectRepository(RentalAddon)
    private readonly addonRepo: Repository<RentalAddon>,
    private readonly bookingService: RentalBookingService,
  ) {}

  async getAllBookings(status?: RentalBookingStatus): Promise<RentalBooking[]> {
    const where = status ? { status } : {};
    return this.bookingRepo.find({
      where,
      relations: [
        'facility',
        'member',
        'bookingAddons',
        'bookingAddons.addon',
        'payments',
      ],
      order: { startDateTime: 'DESC' },
    });
  }

  async confirmBooking(
    id: string,
    dto: ConfirmBookingDto,
  ): Promise<RentalBooking> {
    const booking = await this.bookingService.getBookingById(id);
    if (booking.status !== RentalBookingStatus.PENDING) {
      throw new BadRequestException('Only pending bookings can be confirmed');
    }
    booking.status = RentalBookingStatus.CONFIRMED;
    if (dto.notes) booking.notes = dto.notes;
    const saved = await this.bookingRepo.save(booking);
    this.logger.log(`Booking ${id} confirmed`);
    return saved;
  }

  async rejectBooking(
    id: string,
    dto: RejectBookingDto,
  ): Promise<RentalBooking> {
    const booking = await this.bookingService.getBookingById(id);
    if (booking.status !== RentalBookingStatus.PENDING) {
      throw new BadRequestException('Only pending bookings can be rejected');
    }
    booking.status = RentalBookingStatus.REJECTED;
    booking.rejectionReason = dto.rejectionReason;
    const saved = await this.bookingRepo.save(booking);
    this.logger.log(`Booking ${id} rejected`);
    return saved;
  }

  async applyOverrideDiscount(
    id: string,
    dto: ApplyOverrideDiscountDto,
  ): Promise<RentalBooking> {
    const booking = await this.bookingService.getBookingById(id);
    if (
      ![RentalBookingStatus.PENDING, RentalBookingStatus.CONFIRMED].includes(
        booking.status,
      )
    ) {
      throw new BadRequestException(
        'Discount override can only be applied to pending or confirmed bookings',
      );
    }

    booking.overrideDiscountType = dto.overrideDiscountType;
    booking.overrideDiscountValue = dto.overrideDiscountValue;
    booking.overrideDiscountNote = dto.overrideDiscountNote ?? null;

    const tier = await this.tierRepo.findOne({
      where: { memberCategory: booking.memberCategory, isActive: true },
    });
    const addonLines = await this.bookingAddonRepo.find({
      where: { booking: { id } },
      relations: ['addon'],
    });

    const pricing = this.bookingService.computePricing(
      booking.basePrice,
      addonLines.map((ba) => ({ addon: ba.addon, quantity: ba.quantity })),
      tier,
      { type: dto.overrideDiscountType, value: dto.overrideDiscountValue },
    );

    booking.discountType = pricing.discountType;
    booking.discountValue = pricing.discountValue;
    booking.discountSource = RentalDiscountSource.OVERRIDE;
    booking.serviceFee = pricing.serviceFee;
    booking.grandTotal = pricing.grandTotal;

    const saved = await this.bookingRepo.save(booking);

    await this.paymentRepo.update(
      { booking: { id }, type: 'SERVICE_FEE' as any },
      { amount: pricing.serviceFee },
    );

    this.logger.log(`Override discount applied to booking ${id}`);
    return this.bookingService.getBookingById(saved.id);
  }

  async removeOverrideDiscount(id: string): Promise<RentalBooking> {
    const booking = await this.bookingService.getBookingById(id);
    booking.overrideDiscountType = null;
    booking.overrideDiscountValue = null;
    booking.overrideDiscountNote = null;

    const tier = await this.tierRepo.findOne({
      where: { memberCategory: booking.memberCategory, isActive: true },
    });
    const addonLines = await this.bookingAddonRepo.find({
      where: { booking: { id } },
      relations: ['addon'],
    });

    const pricing = this.bookingService.computePricing(
      booking.basePrice,
      addonLines.map((ba) => ({ addon: ba.addon, quantity: ba.quantity })),
      tier,
      null,
    );

    booking.discountType = pricing.discountType;
    booking.discountValue = pricing.discountValue;
    booking.discountSource = pricing.discountSource;
    booking.serviceFee = pricing.serviceFee;
    booking.grandTotal = pricing.grandTotal;

    const saved = await this.bookingRepo.save(booking);

    await this.paymentRepo.update(
      { booking: { id }, type: 'SERVICE_FEE' as any },
      { amount: pricing.serviceFee },
    );

    return this.bookingService.getBookingById(saved.id);
  }

  async markPaymentPaid(
    paymentId: string,
    dto: MarkPaymentPaidDto,
  ): Promise<RentalPayment> {
    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId },
      relations: ['booking'],
    });
    if (!payment) throw new NotFoundException('Payment record not found');
    if (payment.status === RentalPaymentStatus.PAID) {
      throw new BadRequestException('Payment is already marked as paid');
    }
    payment.status = RentalPaymentStatus.PAID;
    payment.paidAt = new Date();
    if (dto.reference) payment.reference = dto.reference;
    if (dto.proofUrl) payment.proofUrl = dto.proofUrl;
    return this.paymentRepo.save(payment);
  }

  async markCautionRefunded(paymentId: string): Promise<RentalPayment> {
    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId },
      relations: ['booking'],
    });
    if (!payment) throw new NotFoundException('Payment record not found');
    if (payment.type !== 'CAUTION') {
      throw new BadRequestException('Only caution payments can be refunded');
    }
    if (payment.status !== RentalPaymentStatus.PAID) {
      throw new BadRequestException(
        'Caution must be marked paid before it can be refunded',
      );
    }
    payment.status = RentalPaymentStatus.REFUNDED;
    payment.refundedAt = new Date();
    return this.paymentRepo.save(payment);
  }
}
