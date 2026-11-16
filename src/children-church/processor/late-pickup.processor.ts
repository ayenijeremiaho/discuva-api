import { Injectable, Logger } from '@nestjs/common';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { TenantJobEnvelope } from '../../tenant/utility/job-envelope';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';
import { ChildCheckIn } from '../entity/child-check-in.entity';
import { ChildGuardian } from '../entity/child-guardian.entity';
import { ChildCheckInStatusEnum } from '../enums/child-checkin-status.enum';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { CHILDREN_LATE_QUEUE } from '../children-church.constants';

export interface LatePickupJobData extends TenantJobEnvelope {
  slotId: string;
}

// Runs once per service slot, LATE_PICKUP_MINUTES after it ends.
@Injectable()
@Processor(CHILDREN_LATE_QUEUE)
export class LatePickupProcessor {
  private readonly logger = new Logger(LatePickupProcessor.name);

  constructor(
    @InjectRepository(ChildCheckIn)
    private readonly checkInRepo: Repository<ChildCheckIn>,
    @InjectRepository(ChildGuardian)
    private readonly guardianRepo: Repository<ChildGuardian>,
    private readonly push: PushNotificationService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  @Process('late-pickup')
  async handle(job: Job<LatePickupJobData>): Promise<void> {
    await runInTenantContext(this.cls, this.txHost, job.data, () =>
      this.notify(job.data.slotId),
    );
  }

  async notify(slotId: string): Promise<number> {
    const waiting = await this.checkInRepo.find({
      where: {
        serviceSlot: { id: slotId },
        status: ChildCheckInStatusEnum.CHECKED_IN,
        lateNotifiedAt: IsNull(),
      },
      relations: ['child', 'child.classGroup'],
      select: {
        id: true,
        child: {
          id: true,
          firstname: true,
          classGroup: { id: true, name: true },
        },
      },
    });
    if (!waiting.length) return 0;

    await this.checkInRepo.update(
      { id: In(waiting.map((w) => w.id)) },
      { lateNotifiedAt: new Date() },
    );
    const guardians = await this.guardianRepo
      .createQueryBuilder('g')
      .select('g.child_id', 'childId')
      .addSelect('g.member_id', 'memberId')
      .where('g.child_id IN (:...ids)', { ids: waiting.map((w) => w.child.id) })
      .andWhere('g.member_id IS NOT NULL')
      .andWhere('g.is_authorized_pickup = true')
      .getRawMany<{ childId: string; memberId: string }>();

    await Promise.all(
      waiting.map((w) =>
        this.push.dispatchToMemberIds(
          guardians
            .filter((g) => g.childId === w.child.id)
            .map((g) => g.memberId),
          {
            key: PushNotificationKey.CHILD_LATE_PICKUP,
            idempotencyKey: `cc-late:${w.id}`,
            vars: {
              child_name: w.child.firstname,
              room: w.child.classGroup?.name ?? "Children's Church",
            },
          },
        ),
      ),
    );
    return waiting.length;
  }

  @OnQueueFailed()
  onFailed(job: Job<LatePickupJobData>, error: Error): void {
    this.logger.error(
      `Late pickup check for slot ${job.data.slotId} failed: ${error.message}`,
    );
  }
}
