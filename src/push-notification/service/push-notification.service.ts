import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import * as webPush from 'web-push';
import { PushSubscription } from '../entity/push-subscription.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import {
  PushJobData,
  PushPayload,
  SubscribePushDto,
} from '../dto/push-notification.dto';

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
    for (const sub of subscriptions) {
      const jobId = `push:${sub.memberId}:${payload.idempotencyKey}`;
      await this.queue.add(
        'send',
        {
          memberId: sub.memberId,
          endpoint: sub.endpoint,
          p256dh: sub.p256dh,
          auth: sub.auth,
          payload,
        },
        {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    }
  }

}
