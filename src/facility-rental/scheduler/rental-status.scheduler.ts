import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { RentalBooking } from '../entity/rental-booking.entity';
import { RentalBookingStatus } from '../enum/rental.enum';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';

@Injectable()
export class RentalStatusScheduler {
  private readonly logger = new Logger(RentalStatusScheduler.name);

  constructor(
    @InjectRepository(RentalBooking)
    private readonly bookingRepo: Repository<RentalBooking>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async transitionBookingStatuses(): Promise<void> {
    await forEachActiveTenant(
      this.tenantRepo,
      this.cls,
      this.txHost,
      this.logger,
      () => this.runTransitions(),
    );
  }

  private async runTransitions(): Promise<void> {
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
