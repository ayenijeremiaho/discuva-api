import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';

const TTL_MS = 10 * 60_000;

// The current church's timezone (falls back to TIMEZONE), so series land on the right local day and time.
@Injectable()
export class ChurchTimezoneService {
  private readonly cache = new Map<string, { tz: string; at: number }>();

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly cls: ClsService<AppClsStore>,
    private readonly config: ConfigService,
  ) {}

  get fallback(): string {
    return this.config.get<string>('TIMEZONE') ?? 'Africa/Lagos';
  }

  async get(): Promise<string> {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) return this.fallback;
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.tz;
    const tenant = await this.tenantRepo.findOne({
      where: { id: tenantId },
      select: { id: true, timezone: true },
    });
    const tz = tenant?.timezone || this.fallback;
    this.cache.set(tenantId, { tz, at: Date.now() });
    return tz;
  }
}
