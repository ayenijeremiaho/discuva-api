import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { RentalFacility } from './rental-facility.entity';
import { Member } from '../../member/entity/member.entity';
import { RentalBookingAddon } from './rental-booking-addon.entity';
import { RentalPayment } from './rental-payment.entity';
import {
  RentalBookingStatus,
  RentalDiscountSource,
  RentalDiscountType,
  RentalMemberCategory,
} from '../enum/rental.enum';

@Entity({ name: 'rental_bookings' })
export class RentalBooking extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => RentalFacility, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn()
  facility: RentalFacility;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn()
  member: Member;

  @Column({ type: 'timestamptz' })
  startDateTime: Date;

  @Column({ type: 'timestamptz' })
  endDateTime: Date;

  @Column({ type: 'varchar', default: RentalBookingStatus.PENDING })
  status: RentalBookingStatus;

  @Column({ type: 'varchar' })
  memberCategory: RentalMemberCategory;

  // --- price snapshot ---
  @Column({ type: 'decimal', precision: 15, scale: 2 })
  basePrice: number;

  @Column({ type: 'varchar', nullable: true })
  discountType: RentalDiscountType;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  discountValue: number;

  @Column({ type: 'varchar', default: RentalDiscountSource.NONE })
  discountSource: RentalDiscountSource;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  serviceFee: number;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  cautionTotal: number;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  grandTotal: number;

  // --- override discount (admin only) ---
  @Column({ type: 'varchar', nullable: true })
  overrideDiscountType: RentalDiscountType;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  overrideDiscountValue: number;

  @Column({ type: 'text', nullable: true })
  overrideDiscountNote: string;

  @Column({ type: 'text', nullable: true })
  purpose: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'text', nullable: true })
  rejectionReason: string;

  // Set once the day-before reminder is sent, so the scheduler (every 10 minutes) sends it once.
  @Column({ type: 'timestamptz', nullable: true })
  reminderSentAt: Date | null;

  @OneToMany(() => RentalBookingAddon, (ba) => ba.booking, { cascade: true })
  bookingAddons: RentalBookingAddon[];

  @OneToMany(() => RentalPayment, (p) => p.booking, { cascade: true })
  payments: RentalPayment[];
}
