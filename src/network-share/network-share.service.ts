import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { Tenant } from '../tenant/entity/tenant.entity';
import { AppClsStore } from '../tenant/interface/tenant-cls-store.interface';
import { CacheService } from '../utility/service/cache.service';
import { NETWORK_COPY_QUEUE, NetworkCopyJob } from './network-share.constants';

// A burst of event edits becomes one copy run a minute later.
const EVENTS_DELAY_MS = 60_000;
const ROOT_TTL_SECONDS = 600;
export const networkRootKey = (tenantId: string) =>
  `tenant-network-root:${tenantId}`;

// What a church shares with the branches under it, and the queue that carries it there.
@Injectable()
export class NetworkShareService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectQueue(NETWORK_COPY_QUEUE)
    private readonly queue: Queue<NetworkCopyJob>,
    private readonly cache: CacheService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async assertCanShare(): Promise<void> {
    const hasBranches = await this.tenantRepo.exists({
      where: { parentTenantId: this.cls.get('tenantId'), isActive: true },
    });
    if (!hasBranches) {
      throw new BadRequestException(
        'Only a church with branches can send to branches.',
      );
    }
  }

  // Copies (or removes) one announcement at every branch under the current church.
  async announcementChanged(announcementId: string): Promise<void> {
    await this.queue.add(
      {
        kind: 'announcement',
        sourceTenantId: this.cls.get('tenantId'),
        sourceId: announcementId,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
      },
    );
  }

  // Any change to a networked church's events: one delayed re-copy, however many edits land before it runs.
  async eventsChanged(): Promise<void> {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId || !(await this.networkRootOf(tenantId))) return;
    await this.queueEventsCopy(tenantId);
  }

  // A church that just joined a network: forget the cached "not in one" and copy its events now.
  async joinedNetwork(tenantId: string): Promise<void> {
    await this.cache.delGlobal(networkRootKey(tenantId));
    await this.queueEventsCopy(tenantId);
  }

  async queueEventsCopy(tenantId: string): Promise<void> {
    await this.queue.add(
      { kind: 'events', sourceTenantId: tenantId },
      {
        jobId: `events:${tenantId}`,
        delay: EVENTS_DELAY_MS,
        attempts: 3,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  async networkRootOf(tenantId: string): Promise<string | null> {
    const key = networkRootKey(tenantId);
    const cached = await this.cache.getGlobal<{ root: string | null }>(key);
    if (cached) return cached.root;
    const tenant = await this.tenantRepo.findOne({
      where: { id: tenantId },
      select: { id: true, networkRootId: true },
    });
    const root = tenant?.networkRootId ?? null;
    this.cache.setGlobal(key, { root }, ROOT_TTL_SECONDS);
    return root;
  }
}
