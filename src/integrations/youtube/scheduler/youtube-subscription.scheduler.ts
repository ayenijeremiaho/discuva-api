import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { YoutubeSubscriptionService } from '../service/youtube-subscription.service';
import { CacheService } from '../../../utility/service/cache.service';
import { CHURCH_TIMEZONE } from '../../../utility/constants/app.constants';

const RESUBSCRIBE_LOCK = 'lock:youtube-websub-resubscribe';

@Injectable()
export class YoutubeSubscriptionScheduler {
  private readonly logger = new Logger(YoutubeSubscriptionScheduler.name);

  constructor(
    private readonly youtubeSubscriptionService: YoutubeSubscriptionService,
    private readonly cacheService: CacheService,
  ) {}

  // WebSub leases expire (~5-10 days) — re-subscribing daily keeps every
  // active tenant's subscription comfortably ahead of expiry regardless of
  // the hub's actual grant, and is a no-op (fast, cheap) when no tenant has
  // configured this integration. One lock for the whole batch, not
  // per-tenant — this guards against two app instances both running the
  // cron, not against tenants racing each other.
  @Cron('0 2 * * *', { timeZone: CHURCH_TIMEZONE })
  async resubscribe(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(RESUBSCRIBE_LOCK, 270);
    if (!acquired) {
      this.logger.debug(
        'YouTube WebSub re-subscription skipped — another instance holds the lock',
      );
      return;
    }
    await this.youtubeSubscriptionService.renewAllActive();
  }
}
