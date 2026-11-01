import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import * as webPush from 'web-push';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { PushSubscription } from '../entity/push-subscription.entity';
import { PushJobData } from '../dto/push-notification.dto';
import { CacheService } from '../../utility/service/cache.service';
import {
  ANNOUNCEMENT_USAGE,
  NotificationUsageService,
} from '../../utility/service/notification-usage.service';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';

// Subscription was created with a different VAPID key, so it can never be delivered with the current one.
function isKeyMismatch(status: number | undefined, body: string): boolean {
  return (
    status === 403 && /VapidPkHashMismatch|do(?:es)? not correspond/i.test(body)
  );
}

@Injectable()
@Processor('push-notifications')
export class PushNotificationProcessor {
  private readonly logger = new Logger(PushNotificationProcessor.name);

  constructor(
    @InjectRepository(PushSubscription)
    private readonly subRepo: Repository<PushSubscription>,
    private readonly cacheService: CacheService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly usage: NotificationUsageService,
  ) {}

  @Process('send')
  async handle(job: Job<PushJobData>): Promise<void> {
    return runInTenantContext(this.cls, this.txHost, job.data, () =>
      this.doHandle(job.data),
    );
  }

  private async doHandle(data: PushJobData): Promise<void> {
    const { memberId, endpoint, p256dh, auth, payload } = data;
    const idempotencyKey = `notif:sent:${memberId}:${payload.idempotencyKey}`;

    const alreadySent = await this.cacheService.get(idempotencyKey);
    if (alreadySent) return;

    try {
      await webPush.sendNotification(
        { endpoint, keys: { p256dh, auth } },
        JSON.stringify({
          title: payload.title,
          body: payload.body,
          url: payload.url,
        }),
      );
      this.cacheService.set(idempotencyKey, '1', 86_400);
      this.usage.record('push', data.category ?? ANNOUNCEMENT_USAGE, 'sent');
    } catch (err: any) {
      const status: number | undefined = err?.statusCode;
      const body = String(err?.body ?? '').slice(0, 300);
      if (status === 410 || status === 404 || isKeyMismatch(status, body)) {
        await this.subRepo.delete({ memberId });
        this.logger.warn(
          `Removed unusable push subscription for member ${memberId} (${status}${body ? `: ${body}` : ''})`,
        );
        return;
      }
      throw new Error(
        `Push service responded ${status ?? 'with an error'}${body ? `: ${body}` : ''}`,
      );
    }
  }

  @OnQueueFailed()
  async onFailed(job: Job<PushJobData>, error: Error): Promise<void> {
    this.logger.error(
      `Push job failed for member ${job.data.memberId} (attempt ${job.attemptsMade}): ${error.message}`,
    );
    if (job.attemptsMade < (job.opts.attempts ?? 1)) return;
    await runInTenantContext(this.cls, this.txHost, job.data, () => {
      this.usage.record(
        'push',
        job.data.category ?? ANNOUNCEMENT_USAGE,
        'failed',
      );
      return Promise.resolve();
    }).catch((err: Error) =>
      this.logger.warn(`Could not count failed push: ${err.message}`),
    );
  }
}
