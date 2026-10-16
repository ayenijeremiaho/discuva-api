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
import { EncryptionService } from '../../utility/service/encryption.service';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';

const MODULE_KEY = 'social_media';
// Churches often open the stream a little before the service starts.
const LEAD_MS = 15 * 60_000;
const TOKEN_MARGIN_MS = 5 * 60_000;
const MIN_WATCH_MS = 2 * 60_000;
const CHECK_CONCURRENCY = 10;

const PLATFORM_LABEL: Partial<Record<SocialPlatform, string>> = {
  [SocialPlatform.FACEBOOK]: 'Facebook',
  [SocialPlatform.INSTAGRAM]: 'Instagram',
};

interface WatchedAccount {
  id: string;
  platform: SocialPlatform;
  externalId: string;
  // Encrypted, as in the database; decrypted only in memory for the call.
  token: string;
  lastLiveId: string | null;
}

export interface LiveWatch {
  until: number;
  eventName: string | null;
  accounts: WatchedAccount[];
}

interface LiveFound {
  id: string;
  title: string | null;
  url: string;
}

const watchKey = (tenantId: string) => `social-live:watch:${tenantId}`;
const ttlSeconds = (until: number, now: Date) =>
  Math.ceil((until - now.getTime()) / 1000) + 60;

// Neither Facebook (without pages_manage_metadata) nor Instagram tells us when a church goes live, so we ask them,
// only during scheduled services. One database run per service window stores what to watch in Redis; the checks
// every 2 minutes then read only Redis and call Meta with no transaction open, touching the database only to
// announce a new broadcast.
@Injectable()
export class SocialLiveScheduler {
  private static readonly LOCK_KEY = 'lock:social-live';
  private readonly logger = new Logger(SocialLiveScheduler.name);
  // One warning per account per window, not one every 2 minutes.
  private readonly warned = new Set<string>();

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
    private readonly encryption: EncryptionService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  @Cron('*/2 * * * *')
  async dispatchLiveChecks(): Promise<void> {
    if (
      !(await this.cacheService.acquireLock(SocialLiveScheduler.LOCK_KEY, 110))
    )
      return;
    try {
      // Planning first, so a window that opens now is checked on this tick.
      await this.gate.forEachDueTenant(
        'social-live',
        this.txHost,
        this.logger,
        () => this.plan(),
      );
      await this.checkWatches();
    } finally {
      this.cacheService.releaseLock(SocialLiveScheduler.LOCK_KEY);
    }
  }

  // Database run, in the church's context: stores or clears its watch and returns when to plan again.
  async plan(now = new Date()): Promise<Date | null> {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) return null;
    const { watch, next } = await this.buildWatch(now);
    if (watch)
      await this.cacheService.setGlobal(
        watchKey(tenantId),
        watch,
        ttlSeconds(watch.until, now),
      );
    else await this.cacheService.delGlobal(watchKey(tenantId));
    return next;
  }

  // Redis and Meta only; a transaction opens just to announce a broadcast not announced before.
  async checkWatches(now = new Date()): Promise<void> {
    const tenants = await this.gate.activeTenants();
    // Bounded, so a busy Sunday neither queues every church behind the slowest nor floods Meta.
    for (let i = 0; i < tenants.length; i += CHECK_CONCURRENCY)
      await Promise.all(
        tenants
          .slice(i, i + CHECK_CONCURRENCY)
          .map((tenant) => this.checkTenant(tenant, now)),
      );
  }

  private async checkTenant(
    tenant: { id: string; schemaName: string },
    now: Date,
  ): Promise<void> {
    const key = watchKey(tenant.id);
    const watch = await this.cacheService
      .getGlobal<LiveWatch>(key)
      .catch(() => undefined);
    if (!watch || watch.until <= now.getTime()) return;
    const found = await Promise.all(
      watch.accounts.map((account) => this.findLive(account, watch.until)),
    );
    let changed = false;
    // One at a time, so a second platform joins the first one's announcement.
    for (const [i, account] of watch.accounts.entries()) {
      const live = found[i];
      if (!live || live.id === account.lastLiveId) continue;
      // Recorded first: a failed announcement is skipped rather than repeated every 2 minutes.
      account.lastLiveId = live.id;
      changed = true;
      await this.announce(tenant, account, {
        ...live,
        title: live.title ?? watch.eventName,
      });
    }
    if (changed)
      await this.cacheService
        .setGlobal(key, watch, ttlSeconds(watch.until, now))
        .catch(() => undefined);
  }

  private async buildWatch(
    now: Date,
  ): Promise<{ watch: LiveWatch | null; next: Date | null }> {
    if (!(await this.hasModule())) return { watch: null, next: null };
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
        tokenExpiresAt: true,
      },
    });
    if (!accounts.length) return { watch: null, next: null };

    const current = await this.slotRepo.findOne({
      where: {
        startTime: LessThanOrEqual(new Date(now.getTime() + LEAD_MS)),
        endTime: MoreThanOrEqual(now),
      },
      relations: { event: true },
      order: { startTime: 'ASC' },
      select: { id: true, endTime: true, event: { id: true, name: true } },
    });
    if (!current) {
      const upcoming = await this.slotRepo.findOne({
        where: { startTime: MoreThan(new Date(now.getTime() + LEAD_MS)) },
        order: { startTime: 'ASC' },
        select: { id: true, startTime: true },
      });
      return {
        watch: null,
        next: upcoming
          ? new Date(upcoming.startTime.getTime() - LEAD_MS)
          : null,
      };
    }

    // A token expiring mid-service ends the watch early, so the next plan renews it.
    let until = current.endTime.getTime();
    const watched: WatchedAccount[] = [];
    for (const account of accounts) {
      if (!account.externalAccountId) continue;
      try {
        const token = await this.tokens.getValidAccessToken(account.id);
        watched.push({
          id: account.id,
          platform: account.platform,
          externalId: account.externalAccountId,
          token: this.encryption.encrypt(token),
          lastLiveId: account.lastLiveId,
        });
        if (account.tokenExpiresAt)
          until = Math.min(
            until,
            Math.max(
              account.tokenExpiresAt.getTime() - TOKEN_MARGIN_MS,
              now.getTime() + MIN_WATCH_MS,
            ),
          );
      } catch (err) {
        this.logger.warn(
          `Can't watch ${account.platform} account ${account.id} for live: ${(err as Error).message}`,
        );
      }
    }
    const next = new Date(until);
    if (!watched.length) return { watch: null, next };
    return {
      watch: {
        until,
        eventName: current.event?.name ?? null,
        accounts: watched,
      },
      next,
    };
  }

  private async hasModule(): Promise<boolean> {
    if (!(await this.churchSettings.isEnabled(MODULE_KEY))) return false;
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) return false;
    const { features, overrides } = await this.planFeatures.resolve(tenantId);
    const override = overrides[MODULE_KEY];
    return override ?? features.includes(MODULE_KEY);
  }

  private async findLive(
    account: WatchedAccount,
    until: number,
  ): Promise<LiveFound | null> {
    try {
      const token = this.encryption.decrypt(account.token);
      return account.platform === SocialPlatform.FACEBOOK
        ? await this.meta.getLiveFacebookVideo(account.externalId, token)
        : await this.meta.getLiveInstagramMedia(account.externalId, token);
    } catch (err) {
      const once = `${account.id}:${until}`;
      if (!this.warned.has(once)) {
        if (this.warned.size > 1000) this.warned.clear();
        this.warned.add(once);
        this.logger.warn(
          `Live check for ${account.platform} account ${account.id} failed: ${(err as Error).message}`,
        );
      }
      return null;
    }
  }

  private async announce(
    tenant: { id: string; schemaName: string },
    account: WatchedAccount,
    live: LiveFound,
  ): Promise<void> {
    try {
      await runInTenantContext(
        this.cls,
        this.txHost,
        { tenantId: tenant.id, schemaName: tenant.schemaName },
        async () => {
          await this.accountRepo.update(account.id, { lastLiveId: live.id });
          await this.liveAnnouncements.announce({
            platform: PLATFORM_LABEL[account.platform] ?? account.platform,
            title: live.title,
            url: live.url,
          });
        },
      );
    } catch (err) {
      this.logger.warn(
        `Live announcement for ${account.platform} account ${account.id} failed: ${(err as Error).message}`,
      );
    }
  }
}
