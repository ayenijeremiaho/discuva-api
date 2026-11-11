import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, MoreThanOrEqual, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';
import { Event } from '../../event/entity/event.entity';
import { Announcement } from '../../announcement/entity/announcement.entity';
import { AnnouncementService } from '../../announcement/service/announcement.service';
import { NetworkEvent } from '../entity/network-event.entity';
import { NetworkService } from './network.service';

const DAY_MS = 24 * 60 * 60 * 1000;
// Kept for two weeks after they end, so the agenda can look back a little.
const KEEP_PAST_MS = 14 * DAY_MS;
const MAX_EVENTS = 1000;

type Church = Pick<Tenant, 'id' | 'schemaName' | 'networkRootId' | 'isActive'>;

// Carries what a church shares into its network: announcements into each branch, events into the root copy.
@Injectable()
export class NetworkCopyService {
  private readonly logger = new Logger(NetworkCopyService.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Event)
    private readonly eventRepo: Repository<Event>,
    @InjectRepository(Announcement)
    private readonly announcementRepo: Repository<Announcement>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly network: NetworkService,
    private readonly announcements: AnnouncementService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  // Re-copies the church's events from two weeks ago onward, whole: a few hundred small rows at most.
  async copyEvents(tenantId: string): Promise<void> {
    const church = await this.church(tenantId);
    if (!church?.networkRootId || !church.isActive) {
      await this.dataSource.getRepository(NetworkEvent).delete({ tenantId });
      return;
    }
    const events = await this.inChurch(church, () =>
      this.eventRepo.find({
        where: {
          endTime: MoreThanOrEqual(new Date(Date.now() - KEEP_PAST_MS)),
        },
        relations: [
          'serviceSlots',
          'serviceSlots.config',
          'serviceSlots.config.defaultVenue',
          'serviceSlots.venueOverride',
        ],
        order: { startTime: 'ASC' },
        take: MAX_EVENTS,
      }),
    );
    const rows = events.map((e) => {
      const venue = e.serviceSlots
        ?.map((s) => s.venueOverride ?? s.config?.defaultVenue)
        .find(Boolean);
      return {
        tenantId,
        eventId: e.id,
        networkRootId: church.networkRootId!,
        name: e.name,
        description: e.description ? e.description.slice(0, 1000) : null,
        startTime: e.startTime,
        endTime: e.endTime,
        audience: e.audience,
        venueName: venue?.name ?? null,
        serviceCount: e.serviceSlots?.length ?? 0,
        shared: e.sendToBranches,
      };
    });
    await this.dataSource.transaction(async (em) => {
      await em.delete(NetworkEvent, { tenantId });
      if (rows.length) await em.insert(NetworkEvent, rows);
    });
  }

  // Each branch under the sender gets its own copy (and its own members' push); unsharing or deleting removes them.
  async copyAnnouncement(
    sourceTenantId: string,
    announcementId: string,
  ): Promise<void> {
    const source = await this.church(sourceTenantId);
    if (!source?.networkRootId) return;
    const original = await this.inChurch(source, () =>
      this.announcementRepo.findOne({ where: { id: announcementId } }),
    );
    const tree = await this.network.loadTree(source.networkRootId);
    const targetIds = this.network
      .subtreeIds(tree, source.id)
      .filter((id) => id !== source.id);
    if (!targetIds.length) return;
    const targets = await this.tenantRepo.find({
      where: { id: In(targetIds), isActive: true },
      select: {
        id: true,
        schemaName: true,
        networkRootId: true,
        isActive: true,
      },
    });
    const keep = original?.sendToBranches ? original : null;
    const from = keep
      ? ((await this.network.pathsOf(source.networkRootId, [source.id])).get(
          source.id,
        ) ?? '')
      : '';
    let failed = 0;
    for (const target of targets) {
      try {
        await this.inChurch(target, () =>
          keep
            ? this.announcements.upsertNetworkCopy(keep, source.id, from)
            : this.announcements.removeNetworkCopy(announcementId, source.id),
        );
      } catch (err) {
        failed++;
        this.logger.warn(
          `Announcement copy to ${target.id} failed: ${(err as Error).message}`,
        );
      }
    }
    // A retry redoes every branch; copies already there are updated in place, not sent again.
    if (failed)
      throw new Error(`${failed} of ${targets.length} branches failed`);
  }

  private church(id: string): Promise<Church | null> {
    return this.tenantRepo.findOne({
      where: { id },
      select: {
        id: true,
        schemaName: true,
        networkRootId: true,
        isActive: true,
      },
    });
  }

  private inChurch<T>(church: Church, fn: () => Promise<T>): Promise<T> {
    return runInTenantContext(
      this.cls,
      this.txHost,
      { tenantId: church.id, schemaName: church.schemaName },
      fn,
    );
  }
}
