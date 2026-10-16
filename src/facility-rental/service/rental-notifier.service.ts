import { Injectable, Logger } from '@nestjs/common';
import { RentalBooking } from '../entity/rental-booking.entity';
import { RentalPayment } from '../entity/rental-payment.entity';
import { RentalPaymentType } from '../enum/rental.enum';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { DateService } from '../../utility/service/date.service';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import { TenantCurrencyService } from '../../utility/service/tenant-currency.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';

// The reminder goes out this long before a confirmed booking starts.
export const REMINDER_LEAD_MS = 24 * 3_600_000;

// Tells the renter what happened to their booking. Each booking needs `member` and `facility` loaded.
// Never throws: callers run inside the request's transaction, and a failed notice mustn't undo the booking change.
@Injectable()
export class RentalNotifierService {
  private readonly logger = new Logger(RentalNotifierService.name);

  constructor(
    private readonly notificationDispatchService: NotificationDispatchService,
    private readonly dateService: DateService,
    private readonly churchTimezone: ChurchTimezoneService,
    private readonly tenantCurrency: TenantCurrencyService,
  ) {}

  async confirmed(booking: RentalBooking): Promise<void> {
    try {
      const when = await this.when(booking);
      this.send(booking, {
        template: 'rental-booking-confirmed',
        subject: 'Your booking is confirmed',
        push: PushNotificationKey.RENTAL_BOOKING_CONFIRMED,
        idempotencyKey: `rental-confirmed:${booking.id}`,
        vars: when,
        data: { ...when, amountDue: await this.money(booking.grandTotal) },
      });
    } catch (err) {
      this.logger.warn(
        `Rental notice "confirmed" not sent: ${(err as Error).message}`,
      );
    }
  }

  async rejected(booking: RentalBooking): Promise<void> {
    try {
      const when = await this.when(booking);
      const reason = booking.rejectionReason ?? '';
      this.send(booking, {
        template: 'rental-booking-rejected',
        subject: "Your booking wasn't approved",
        push: PushNotificationKey.RENTAL_BOOKING_REJECTED,
        idempotencyKey: `rental-rejected:${booking.id}`,
        vars: {
          ...when,
          reason: reason || 'Please contact the church office.',
        },
        data: { ...when, reason },
      });
    } catch (err) {
      this.logger.warn(
        `Rental notice "rejected" not sent: ${(err as Error).message}`,
      );
    }
  }

  async paymentReceived(
    payment: RentalPayment,
    booking: RentalBooking,
  ): Promise<void> {
    try {
      const when = await this.when(booking);
      const amount = await this.money(payment.amount);
      const caution = payment.type === RentalPaymentType.CAUTION;
      this.send(booking, {
        template: 'rental-payment-received',
        subject: 'Payment received',
        push: PushNotificationKey.RENTAL_PAYMENT_RECEIVED,
        idempotencyKey: `rental-payment:${payment.id}`,
        vars: {
          ...when,
          amount,
          payment_label: caution ? 'caution deposit' : 'booking fee',
        },
        data: {
          ...when,
          amount,
          paymentLabel: caution ? 'Caution deposit' : 'Booking fee',
          reference: payment.reference ?? '',
        },
      });
    } catch (err) {
      this.logger.warn(
        `Rental notice "paymentReceived" not sent: ${(err as Error).message}`,
      );
    }
  }

  async cautionRefunded(
    payment: RentalPayment,
    booking: RentalBooking,
  ): Promise<void> {
    try {
      const when = await this.when(booking);
      const amount = await this.money(payment.amount);
      this.send(booking, {
        template: 'rental-caution-refunded',
        subject: 'Your caution deposit was refunded',
        push: PushNotificationKey.RENTAL_CAUTION_REFUNDED,
        idempotencyKey: `rental-refund:${payment.id}`,
        vars: { ...when, amount },
        data: { ...when, amount },
      });
    } catch (err) {
      this.logger.warn(
        `Rental notice "cautionRefunded" not sent: ${(err as Error).message}`,
      );
    }
  }

  async reminder(booking: RentalBooking): Promise<void> {
    try {
      const when = await this.when(booking);
      this.send(booking, {
        template: 'rental-booking-reminder',
        subject: 'Your booking is coming up',
        push: PushNotificationKey.RENTAL_BOOKING_REMINDER,
        idempotencyKey: `rental-reminder:${booking.id}`,
        vars: when,
        data: when,
      });
    } catch (err) {
      this.logger.warn(
        `Rental notice "reminder" not sent: ${(err as Error).message}`,
      );
    }
  }

  private send(
    booking: RentalBooking,
    n: {
      template: string;
      subject: string;
      push: PushNotificationKey;
      idempotencyKey: string;
      vars: Record<string, string>;
      data: Record<string, string>;
    },
  ): void {
    const member = booking.member;
    if (!member) return;
    // Push placeholders are snake_case; email data is camelCase like every other template.
    const vars = Object.fromEntries(
      Object.entries(n.vars).map(([k, v]) => [
        k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
        v,
      ]),
    );
    this.notificationDispatchService.notifyMember({
      category: EmailCategory.FACILITY_RENTAL,
      ...(member.email && {
        email: {
          to: member.email,
          recipientMemberId: member.id,
          subject: n.subject,
          template: n.template,
          data: { name: member.firstname, ...n.data },
        },
      }),
      push: {
        memberIds: [member.id],
        key: n.push,
        vars,
        idempotencyKey: n.idempotencyKey,
      },
    });
  }

  // "Sat 7 Nov" and "10:00 AM–4:00 PM" in the church's timezone; a booking over several days shows its end date.
  private async when(booking: RentalBooking): Promise<{
    facilityName: string;
    bookingDate: string;
    bookingTime: string;
  }> {
    const tz = await this.churchTimezone.get();
    const day = (d: Date) => this.dateService.format(d, 'EEE d MMM', tz);
    const time = (d: Date) =>
      this.dateService.format(d, DateService.PATTERNS.TIME_SHORT, tz);
    const start = new Date(booking.startDateTime);
    const end = new Date(booking.endDateTime);
    const sameDay = day(start) === day(end);
    return {
      facilityName: booking.facility?.name ?? 'your booking',
      bookingDate: day(start),
      bookingTime: sameDay
        ? `${time(start)}–${time(end)}`
        : `${time(start)} – ${day(end)}, ${time(end)}`,
    };
  }

  private async money(amount: number | string): Promise<string> {
    const code = await this.tenantCurrency.resolveCurrencyCode();
    return `${code} ${Number(amount).toLocaleString('en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}
