import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { CacheService } from './cache.service';

const TTL_SECONDS = 10 * 60;
export const churchTimezoneKey = (tenantId: string) => `church-tz:${tenantId}`;

// The current church's timezone (falls back to TIMEZONE), so series land on the right local day and time.
@Injectable()
export class ChurchTimezoneService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly cls: ClsService<AppClsStore>,
    private readonly config: ConfigService,
    private readonly cache: CacheService,
  ) {}

  get fallback(): string {
    return this.config.get<string>('TIMEZONE') ?? 'Africa/Lagos';
  }

  async get(): Promise<string> {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) return this.fallback;
    // Shared across API machines, and cleared when the church changes its timezone.
    const hit = await this.cache.getGlobal<string>(churchTimezoneKey(tenantId));
    if (hit) return hit;
    const tenant = await this.tenantRepo.findOne({
      where: { id: tenantId },
      select: { id: true, timezone: true },
    });
    const tz = tenant?.timezone || this.fallback;
    this.cache.setGlobal(churchTimezoneKey(tenantId), tz, TTL_SECONDS);
    return tz;
  }
}
