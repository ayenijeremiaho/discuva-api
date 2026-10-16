import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In,
  LessThanOrEqual,
  MoreThan,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { SocialAccount } from '../entity/social-account.entity';
import { SocialPlatform } from '../enum/social-media.enum';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { MetaGraphApiService } from '../platform/meta/meta-graph-api.service';
import { SocialTokenResolverService } from '../service/social-token-resolver.service';
import { LiveAnnouncementService } from '../../announcement/service/live-announcement.service';
import { SchedulerGateService } from '../../tenant/scheduler-gate/scheduler-gate.service';
import { ChurchSettingsService } from '../../church-settings/service/church-settings.service';
import { PlanFeatureResolverService } from '../../billing/service/plan-feature-resolver.service';
import { CacheService } from '../../utility/service/cache.service';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';

const MODULE_KEY = 'social_media';
// Churches often open the stream a little before the service starts.
const LEAD_MS = 15 * 60_000;
const CHECK_EVERY_MS = 2 * 60_000;

const PLATFORM_LABEL: Partial<Record<SocialPlatform, string>> = {
  [SocialPlatform.FACEBOOK]: 'Facebook',
  [SocialPlatform.INSTAGRAM]: 'Instagram',
};

// Neither Facebook (without pages_manage_metadata) nor Instagram tells us when a church goes live, so this asks them,
// but only around scheduled services, and announces each broadcast once.
@Injectable()
export class SocialLiveScheduler {
  private static readonly LOCK_KEY = 'lock:social-live';
  private readonly logger = new Logger(SocialLiveScheduler.name);

  constructor(
    @InjectRepository(SocialAccount)
    private readonly accountRepo: Repository<SocialAccount>,
    @InjectRepository(ServiceSlot)
    private readonly slotRepo: Repository<ServiceSlot>,
    private readonly meta: MetaGraphApiService,
    private readonly tokens: SocialTokenResolverService,
    private readonly liveAnnouncements: LiveAnnouncementService,
    private readonly gate: SchedulerGateService,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly churchSettings: ChurchSettingsService,
    private readonly planFeatures: PlanFeatureResolverService,
    private readonly cacheService: CacheService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  @Cron('*/2 * * * *')
  async dispatchLiveChecks(): Promise<void> {
    if (
      !(await this.cacheService.acquireLock(SocialLiveScheduler.LOCK_KEY, 110))
    )
      return;
    try {
      await this.gate.forEachDueTenant(
        'social-live',
        this.txHost,
        this.logger,
        () => this.runChecks(),
      );
    } finally {
      this.cacheService.releaseLock(SocialLiveScheduler.LOCK_KEY);
    }
  }

  // Returns when this church next needs a check (null when there's nothing to watch).
  async runChecks(now = new Date()): Promise<Date | null> {
    if (!(await this.hasModule())) return null;
    const accounts = await this.accountRepo.find({
      where: {
        platform: In([SocialPlatform.FACEBOOK, SocialPlatform.INSTAGRAM]),
        isConnected: true,
        announceLive: true,
      },
      select: {
        id: true,
        platform: true,
        externalAccountId: true,
        lastLiveId: true,
      },
    });
    if (!accounts.length) return null;

    const current = await this.slotRepo.findOne({
      where: {
        startTime: LessThanOrEqual(new Date(now.getTime() + LEAD_MS)),
        endTime: MoreThanOrEqual(now),
      },
      relations: { event: true },
      order: { startTime: 'ASC' },
      select: { id: true, event: { id: true, name: true } },
    });
    if (!current) {
      const next = await this.slotRepo.findOne({
        where: { startTime: MoreThan(new Date(now.getTime() + LEAD_MS)) },
        order: { startTime: 'ASC' },
        select: { id: true, startTime: true },
      });
      return next ? new Date(next.startTime.getTime() - LEAD_MS) : null;
    }

    for (const account of accounts)
      await this.check(account, current.event?.name ?? null);
    return new Date(now.getTime() + CHECK_EVERY_MS);
  }

  private async hasModule(): Promise<boolean> {
    if (!(await this.churchSettings.isEnabled(MODULE_KEY))) return false;
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) return false;
    const { features, overrides } = await this.planFeatures.resolve(tenantId);
    const override = overrides[MODULE_KEY];
    return override ?? features.includes(MODULE_KEY);
  }

  private async check(
    account: SocialAccount,
    eventName: string | null,
  ): Promise<void> {
    if (!account.externalAccountId) return;
    try {
      const token = await this.tokens.getValidAccessToken(account.id);
      const live =
        account.platform === SocialPlatform.FACEBOOK
          ? await this.meta.getLiveFacebookVideo(
              account.externalAccountId,
              token,
            )
          : await this.meta.getLiveInstagramMedia(
              account.externalAccountId,
              token,
            );
      if (!live || live.id === account.lastLiveId) return;
      // Recorded first: a failed announcement is skipped rather than repeated every two minutes.
      await this.accountRepo.update(account.id, { lastLiveId: live.id });
      await this.liveAnnouncements.announce({
        platform: PLATFORM_LABEL[account.platform] ?? account.platform,
        title: live.title ?? eventName,
        url: live.url,
      });
    } catch (err) {
      this.logger.warn(
        `Live check for ${account.platform} account ${account.id} failed: ${(err as Error).message}`,
      );
    }
  }
}
