import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { CacheService } from './cache.service';

// Third call site (after EmailQueueService, PdfService) resolving a
// tenant's own config instead of a single global value — pulled out into
// its own service since currency alone doesn't need PdfService's full
// branding shape. Shares the same `tenant-branding:${tenantId}` cache entry
// those two populate — one Tenant lookup serves all three.
@Injectable()
export class TenantCurrencyService {
  private readonly cacheTtl: number;

  constructor(
    private readonly config: ConfigService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly cacheService: CacheService,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
  ) {
    this.cacheTtl = this.config.get<number>('CACHE_TTL_REFERENCE_SECONDS', 300);
  }

  // No tenant CLS context (schedulers — see job-envelope.ts) falls back to
  // the env default, same as today's behavior.
  async resolveCurrencyCode(): Promise<string> {
    const fallback = this.config.get<string>('CURRENCY_CODE');

    const tenantId = this.cls.get('tenantId');
    if (!tenantId) return fallback;

    const tenant = await this.cacheService.getOrSet(
      `tenant-branding:${tenantId}`,
      () => this.tenantRepository.findOneBy({ id: tenantId }),
      this.cacheTtl,
    );
    return tenant?.currency || fallback;
  }
}
