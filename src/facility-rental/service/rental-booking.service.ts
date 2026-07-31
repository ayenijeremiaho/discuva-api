import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import {
  RentalBookingStatus,
  RentalDiscountSource,
  RentalDiscountType,
  RentalMemberCategory,
  RentalPaymentStatus,
  RentalPaymentType,
} from '../enum/rental.enum';
import { CreateRentalBookingDto } from '../dto/rental-booking.dto';

@Injectable()
export class RentalBookingService {
  private readonly logger = new Logger(RentalBookingService.name);

  constructor(
    @InjectRepository(RentalBooking)
    private readonly bookingRepo: Repository<RentalBooking>,
    @InjectRepository(RentalBookingAddon)
    private readonly bookingAddonRepo: Repository<RentalBookingAddon>,
    @InjectRepository(RentalPayment)
    private readonly paymentRepo: Repository<RentalPayment>,
    @InjectRepository(RentalFacility)
    private readonly facilityRepo: Repository<RentalFacility>,
    @InjectRepository(RentalPricingTier)
    private readonly tierRepo: Repository<RentalPricingTier>,
    @InjectRepository(RentalAddon)
    private readonly addonRepo: Repository<RentalAddon>,
    @InjectRepository(RentalCalendarBlock)
    private readonly blockRepo: Repository<RentalCalendarBlock>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    @InjectRepository(DepartmentLead)
    private readonly deptLeadRepo: Repository<DepartmentLead>,
    @InjectRepository(WorkerProfile)
    private readonly workerRepo: Repository<WorkerProfile>,
  ) {}

  async createBooking(
    memberId: string,
    dto: CreateRentalBookingDto,
  ): Promise<RentalBooking> {
    const facility = await this.facilityRepo.findOne({
      where: { id: dto.facilityId, isActive: true },
    });
    if (!facility) throw new NotFoundException('Facility not found');

    const member = await this.memberRepo.findOneBy({ id: memberId });
    if (!member) throw new NotFoundException('Member not found');

    const start = new Date(dto.startDateTime);
    const end = new Date(dto.endDateTime);
    if (end <= start) {
      throw new BadRequestException('End date/time must be after start');
    }

    await this.assertNoOverlap(facility.id, start, end, null);

    const memberCategory = await this.determineMemberCategory(member);
    const tier = await this.tierRepo.findOne({
      where: { memberCategory, isActive: true },
    });

    const addonLines = await this.resolveAddons(dto.addons ?? []);
    const pricing = this.computePricing(
      facility.basePrice,
      addonLines,
      tier,
      null,
    );

    const booking = this.bookingRepo.create({
      facility,
      member,
      startDateTime: start,
      endDateTime: end,
      status: RentalBookingStatus.PENDING,
      memberCategory,
      basePrice: facility.basePrice,
      discountType: pricing.discountType,
      discountValue: pricing.discountValue,
      discountSource: pricing.discountSource,
      serviceFee: pricing.serviceFee,
      cautionTotal: pricing.cautionTotal,
      grandTotal: pricing.grandTotal,
      purpose: dto.purpose,
    });

    const saved = await this.bookingRepo.save(booking);

    if (addonLines.length) {
      const bookingAddons = addonLines.map((l) =>
        this.bookingAddonRepo.create({
          booking: saved,
          addon: l.addon,
          quantity: l.quantity,
          unitPrice: l.addon.price,
          unitCaution: l.addon.cautionAmount,
        }),
      );
      await this.bookingAddonRepo.save(bookingAddons);
    }

    const payments: Partial<RentalPayment>[] = [
      {
        booking: saved,
        type: RentalPaymentType.SERVICE_FEE,
        amount: pricing.serviceFee,
        status: RentalPaymentStatus.PENDING,
      },
    ];
    if (pricing.cautionTotal > 0) {
      payments.push({
        booking: saved,
        type: RentalPaymentType.CAUTION,
        amount: pricing.cautionTotal,
        status: RentalPaymentStatus.PENDING,
      });
    }
    await this.paymentRepo.save(payments);

    this.logger.log(
      `Booking ${saved.id} created for member ${memberId} — ${facility.name}`,
    );
    return this.getBookingById(saved.id);
  }

  async cancelBooking(bookingId: string, memberId: string): Promise<void> {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId, member: { id: memberId } },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (
      ![RentalBookingStatus.PENDING, RentalBookingStatus.CONFIRMED].includes(
        booking.status,
      )
    ) {
      throw new BadRequestException(
        'Only pending or confirmed bookings can be cancelled',
      );
    }
    booking.status = RentalBookingStatus.CANCELLED;
    await this.bookingRepo.save(booking);
  }

  async getMyBookings(memberId: string): Promise<RentalBooking[]> {
    return this.bookingRepo.find({
      where: { member: { id: memberId } },
      relations: [
        'facility',
        'bookingAddons',
        'bookingAddons.addon',
        'payments',
      ],
      order: { startDateTime: 'DESC' },
    });
  }

  async getBookingById(id: string): Promise<RentalBooking> {
    const booking = await this.bookingRepo.findOne({
      where: { id },
      relations: [
        'facility',
        'member',
        'bookingAddons',
        'bookingAddons.addon',
        'payments',
      ],
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  async getMyBookingById(memberId: string, id: string): Promise<RentalBooking> {
    const booking = await this.bookingRepo.findOne({
      where: { id, member: { id: memberId } },
      relations: [
        'facility',
        'bookingAddons',
        'bookingAddons.addon',
        'payments',
      ],
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  async getAvailability(
    facilityId: string,
    from: string,
    to: string,
  ): Promise<{ blocked: { start: Date; end: Date; reason: string }[] }> {
    const facility = await this.facilityRepo.findOneBy({ id: facilityId });
    if (!facility) throw new NotFoundException('Facility not found');

    const start = new Date(from);
    const end = new Date(to);

    const bookings = await this.bookingRepo
      .createQueryBuilder('b')
      .where('b.facility_id = :fid', { fid: facilityId })
      .andWhere('b.status NOT IN (:...excluded)', {
        excluded: [RentalBookingStatus.CANCELLED, RentalBookingStatus.REJECTED],
      })
      .andWhere('b.startDateTime < :end AND b.endDateTime > :start', {
        start,
        end,
      })
      .getMany();

    const adminBlocks = await this.blockRepo
      .createQueryBuilder('bl')
      .where('bl.facility_id = :fid', { fid: facilityId })
      .andWhere('bl.startDateTime < :end AND bl.endDateTime > :start', {
        start,
        end,
      })
      .getMany();

    const blocked = [
      ...bookings.map((b) => ({
        start: b.startDateTime,
        end: b.endDateTime,
        reason: 'Booked',
      })),
      ...adminBlocks.map((b) => ({
        start: b.startDateTime,
        end: b.endDateTime,
        reason: b.reason ?? 'Unavailable',
      })),
    ].sort((a, b) => a.start.getTime() - b.start.getTime());

    return { blocked };
  }

  // ── Pricing calculation ──────────────────────────────────────────────────────

  computePricing(
    basePrice: number,
    addonLines: { addon: RentalAddon; quantity: number }[],
    tier: RentalPricingTier | null,
    override: {
      type: RentalDiscountType;
      value: number;
    } | null,
  ): {
    serviceFee: number;
    cautionTotal: number;
    grandTotal: number;
    discountType: RentalDiscountType | null;
    discountValue: number | null;
    discountSource: RentalDiscountSource;
  } {
    const activeDiscount =
      override ??
      (tier ? { type: tier.discountType, value: tier.discountValue } : null);
    const discountSource = override
      ? RentalDiscountSource.OVERRIDE
      : tier
        ? RentalDiscountSource.TIER
        : RentalDiscountSource.NONE;

    const addonServiceTotal = addonLines.reduce(
      (sum, l) => sum + Number(l.addon.price) * l.quantity,
      0,
    );
    const cautionTotal = addonLines.reduce(
      (sum, l) => sum + Number(l.addon.cautionAmount) * l.quantity,
      0,
    );

    const gross = Number(basePrice) + addonServiceTotal;
    let serviceFee = gross;

    if (activeDiscount) {
      if (activeDiscount.type === RentalDiscountType.PERCENTAGE) {
        serviceFee = gross * (1 - activeDiscount.value / 100);
      } else {
        serviceFee = Math.max(0, gross - activeDiscount.value);
      }
    }

    serviceFee = Math.round(serviceFee * 100) / 100;
    const grandTotal = Math.round((serviceFee + cautionTotal) * 100) / 100;

    return {
      serviceFee,
      cautionTotal,
      grandTotal,
      discountType: activeDiscount?.type ?? null,
      discountValue: activeDiscount?.value ?? null,
      discountSource,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  async assertNoOverlap(
    facilityId: string,
    start: Date,
    end: Date,
    excludeBookingId: string | null,
  ): Promise<void> {
    const qb = this.bookingRepo
      .createQueryBuilder('b')
      .where('b.facility_id = :fid', { fid: facilityId })
      .andWhere('b.status NOT IN (:...excluded)', {
        excluded: [RentalBookingStatus.CANCELLED, RentalBookingStatus.REJECTED],
      })
      .andWhere('b.startDateTime < :end AND b.endDateTime > :start', {
        start,
        end,
      });

    if (excludeBookingId) {
      qb.andWhere('b.id != :excludeId', { excludeId: excludeBookingId });
    }

    const overlap = await qb.getOne();
    if (overlap) {
      throw new ConflictException(
        'The facility is already booked for this time slot',
      );
    }

    const block = await this.blockRepo
      .createQueryBuilder('bl')
      .where('bl.facility_id = :fid', { fid: facilityId })
      .andWhere('bl.startDateTime < :end AND bl.endDateTime > :start', {
        start,
        end,
      })
      .getOne();

    if (block) {
      throw new ConflictException(
        `The facility is unavailable during this period${block.reason ? ': ' + block.reason : ''}`,
      );
    }
  }

  async resolveAddons(
    items: { addonId: string; quantity: number }[],
  ): Promise<{ addon: RentalAddon; quantity: number }[]> {
    if (items.length === 0) return [];
    const addons = await this.addonRepo.find({
      where: { id: In(items.map((item) => item.addonId)), isActive: true },
    });
    const addonById = new Map(addons.map((addon) => [addon.id, addon]));
    return items.map((item) => {
      const addon = addonById.get(item.addonId);
      if (!addon)
        throw new NotFoundException(`Add-on ${item.addonId} not found`);
      return { addon, quantity: item.quantity };
    });
  }

  private async determineMemberCategory(
    member: Member,
  ): Promise<RentalMemberCategory> {
    const workerProfile = await this.workerRepo.findOne({
      where: { member: { id: member.id } },
    });
    if (workerProfile) {
      const isLead = await this.deptLeadRepo.exists({
        where: { workerProfile: { id: workerProfile.id } },
      });
      if (isLead) return RentalMemberCategory.LEADER;
      if (member.role === MemberRoleEnum.WORKER)
        return RentalMemberCategory.WORKER;
    }
    return RentalMemberCategory.MEMBER;
  }
}
