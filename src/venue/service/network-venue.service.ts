import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { CacheService } from '../../utility/service/cache.service';
import { NetworkVenue } from '../../branch/entity/network-venue.entity';
import { Venue } from '../entity/venue.entity';

const TTL_SECONDS = 60 * 60;
export const networkVenuesKey = (rootId: string) => `network-venues:${rootId}`;

// Keeps the root copy of a networked church's venues in step with its own, and serves a network's venues from cache.
@Injectable()
export class NetworkVenueService {
  constructor(
    @InjectRepository(NetworkVenue)
    private readonly copyRepo: Repository<NetworkVenue>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Venue)
    private readonly venueRepo: Repository<Venue>,
    private readonly cache: CacheService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  // The current church's venues, copied again whole: a handful of rows, and only when a venue changes.
  async syncCurrent(knownRootId?: string): Promise<void> {
    const tenantId = this.cls.get('tenantId');
    const rootId =
      knownRootId ??
      (
        await this.tenantRepo.findOne({
          where: { id: tenantId },
          select: { id: true, networkRootId: true },
        })
      )?.networkRootId;
    if (!rootId) return;
    const venues = await this.venueRepo.find({
      select: { id: true, name: true, latitude: true, longitude: true },
    });
    await this.copyRepo.delete({ tenantId });
    if (venues.length) {
      await this.copyRepo.insert(
        venues.map((v) => ({
          tenantId,
          venueId: v.id,
          networkRootId: rootId,
          name: v.name,
          latitude: v.latitude,
          longitude: v.longitude,
        })),
      );
    }
    this.cache.delGlobal(networkVenuesKey(rootId));
  }

  async forNetwork(rootId: string): Promise<NetworkVenue[]> {
    const key = networkVenuesKey(rootId);
    const cached = await this.cache.getGlobal<NetworkVenue[]>(key);
    if (cached) return cached;
    const rows = await this.copyRepo.find({ where: { networkRootId: rootId } });
    this.cache.setGlobal(key, rows, TTL_SECONDS);
    return rows;
  }
}
