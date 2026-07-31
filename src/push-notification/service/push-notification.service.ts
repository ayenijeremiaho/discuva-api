import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import * as webPush from 'web-push';
import { PushSubscription } from '../entity/push-subscription.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import {
  PushJobData,
  PushPayload,
  SubscribePushDto,
} from '../dto/push-notification.dto';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { buildJobEnvelope } from '../../tenant/utility/job-envelope';

@Injectable()
export class PushNotificationService implements OnModuleInit {
  constructor(
    @InjectRepository(PushSubscription)
    private readonly subRepo: Repository<PushSubscription>,
    @InjectRepository(WorkerProfile)
    private readonly workerRepo: Repository<WorkerProfile>,
    @InjectQueue('push-notifications')
    private readonly queue: Queue<PushJobData>,
    private readonly config: ConfigService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  onModuleInit(): void {
    webPush.setVapidDetails(
      this.config.get<string>('VAPID_SUBJECT'),
      this.config.get<string>('VAPID_PUBLIC_KEY'),
      this.config.get<string>('VAPID_PRIVATE_KEY'),
    );
  }

  async subscribe(memberId: string, dto: SubscribePushDto): Promise<void> {
    await this.subRepo.delete({ memberId });
    await this.subRepo.save(
      this.subRepo.create({
        memberId,
        endpoint: dto.endpoint,
        p256dh: dto.p256dh,
        auth: dto.auth,
      }),
    );
  }

  async unsubscribe(memberId: string): Promise<void> {
    await this.subRepo.delete({ memberId });
  }

  async dispatchToWorkerProfileIds(
    workerProfileIds: string[],
    payload: PushPayload,
  ): Promise<void> {
    if (!workerProfileIds.length) return;
    const rows = await this.workerRepo
      .createQueryBuilder('wp')
      .select('wp.member_id', 'memberId')
      .where('wp.id IN (:...ids)', { ids: workerProfileIds })
      .getRawMany<{ memberId: string }>();
    await this.dispatchToMemberIds(
      rows.map((r) => r.memberId),
      payload,
    );
  }

  async dispatchToMemberIds(
    memberIds: string[],
    payload: PushPayload,
  ): Promise<void> {
    if (!memberIds.length) return;
    const subscriptions = await this.subRepo.find({
      where: { memberId: In(memberIds) },
    });
    if (!subscriptions.length) return;
    const envelope = buildJobEnvelope(this.cls);
    await this.queue.addBulk(
      subscriptions.map((sub) => ({
        name: 'send',
        data: {
          memberId: sub.memberId,
          endpoint: sub.endpoint,
          p256dh: sub.p256dh,
          auth: sub.auth,
          payload,
          ...envelope,
        },
        opts: {
          jobId: `push:${sub.memberId}:${payload.idempotencyKey}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      })),
    );
  }
}
