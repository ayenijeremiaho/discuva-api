import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { RentalBooking } from '../entity/rental-booking.entity';
import { RentalBookingStatus } from '../enum/rental.enum';
import { SchedulerGateService } from '../../tenant/scheduler-gate/scheduler-gate.service';

@Injectable()
export class RentalStatusScheduler {
  private readonly logger = new Logger(RentalStatusScheduler.name);

  constructor(
    @InjectRepository(RentalBooking)
    private readonly bookingRepo: Repository<RentalBooking>,
    private readonly gate: SchedulerGateService,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
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

  // Returns when this church's next booking starts or ends (null if none).
  async runTransitions(): Promise<Date | null> {
    const now = new Date();

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
    return row?.next ? new Date(row.next) : null;
  }
}
