import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { RentalBooking } from '../entity/rental-booking.entity';
import { RentalBookingStatus } from '../enum/rental.enum';

@Injectable()
export class RentalStatusScheduler {
  private readonly logger = new Logger(RentalStatusScheduler.name);

  constructor(
    @InjectRepository(RentalBooking)
    private readonly bookingRepo: Repository<RentalBooking>,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async transitionBookingStatuses(): Promise<void> {
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
  }
}
