import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { And, IsNull, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { RentalBooking } from '../entity/rental-booking.entity';
import { RentalBookingStatus } from '../enum/rental.enum';
import { SchedulerGateService } from '../../tenant/scheduler-gate/scheduler-gate.service';
import {
  REMINDER_LEAD_MS,
  RentalNotifierService,
} from '../service/rental-notifier.service';

@Injectable()
export class RentalStatusScheduler {
  private readonly logger = new Logger(RentalStatusScheduler.name);

  constructor(
    @InjectRepository(RentalBooking)
    private readonly bookingRepo: Repository<RentalBooking>,
    private readonly gate: SchedulerGateService,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly notifier: RentalNotifierService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async transitionBookingStatuses(): Promise<void> {
    await this.gate.forEachDueTenant(
      'rental-status',
      this.txHost,
      this.logger,
      () => this.runTransitions(),
    );
  }

  // Returns when this church next needs the job: a booking starting or ending, or a reminder due (null if none).
  async runTransitions(): Promise<Date | null> {
    const now = new Date();
    await this.sendReminders(now);

    const toInProgress = await this.bookingRepo.find({
      where: {
        status: RentalBookingStatus.CONFIRMED,
        startDateTime: LessThanOrEqual(now),
        endDateTime: MoreThan(now),
      },
    });

    if (toInProgress.length) {
      await this.bookingRepo.update(
        toInProgress.map((b) => b.id),
        { status: RentalBookingStatus.IN_PROGRESS },
      );
      this.logger.log(
        `Transitioned ${toInProgress.length} booking(s) to IN_PROGRESS`,
      );
    }

    const toCompleted = await this.bookingRepo.find({
      where: {
        status: RentalBookingStatus.IN_PROGRESS,
        endDateTime: LessThanOrEqual(now),
      },
    });

    if (toCompleted.length) {
      await this.bookingRepo.update(
        toCompleted.map((b) => b.id),
        { status: RentalBookingStatus.COMPLETED },
      );
      this.logger.log(
        `Transitioned ${toCompleted.length} booking(s) to COMPLETED`,
      );
    }

    return this.nextTransitionDue(now);
  }

  // The day before a confirmed booking (or straight away if it's sooner), once.
  private async sendReminders(now: Date): Promise<void> {
    const soon = await this.bookingRepo.find({
      where: {
        status: RentalBookingStatus.CONFIRMED,
        reminderSentAt: IsNull(),
        startDateTime: And(
          MoreThan(now),
          LessThanOrEqual(new Date(now.getTime() + REMINDER_LEAD_MS)),
        ),
      },
      relations: ['member', 'facility'],
    });
    if (!soon.length) return;
    // Marked before sending: a crash afterwards skips a reminder rather than sending it twice.
    await this.bookingRepo.update(
      soon.map((b) => b.id),
      { reminderSentAt: now },
    );
    for (const booking of soon) await this.notifier.reminder(booking);
    this.logger.log(`Sent ${soon.length} booking reminder(s)`);
  }

  async nextTransitionDue(now = new Date()): Promise<Date | null> {
    const row = await this.bookingRepo
      .createQueryBuilder('b')
      .select(
        `MIN(CASE WHEN b.status = :confirmed AND b.start_date_time > :now THEN b.start_date_time ELSE b.end_date_time END)`,
        'next',
      )
      .where('b.status IN (:...open)', {
        open: [RentalBookingStatus.CONFIRMED, RentalBookingStatus.IN_PROGRESS],
      })
      .andWhere('b.end_date_time > :now')
      .setParameters({ now, confirmed: RentalBookingStatus.CONFIRMED })
      .getRawOne<{ next: Date | string | null }>();
    const reminder = await this.bookingRepo
      .createQueryBuilder('b')
      .select('MIN(b.start_date_time)', 'start')
      .where('b.status = :confirmed', {
        confirmed: RentalBookingStatus.CONFIRMED,
      })
      .andWhere('b.reminder_sent_at IS NULL')
      .andWhere('b.start_date_time > :now', { now })
      .getRawOne<{ start: Date | string | null }>();
    const times = [
      row?.next ? new Date(row.next).getTime() : null,
      reminder?.start
        ? new Date(reminder.start).getTime() - REMINDER_LEAD_MS
        : null,
    ].filter((t): t is number => t !== null);
    return times.length ? new Date(Math.min(...times)) : null;
  }
}
