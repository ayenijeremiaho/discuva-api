import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { Repository } from 'typeorm';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { CacheService } from './cache.service';

const CACHE_TTL_SECONDS = 300;
const cacheKey = (tenantId: string) => `tenant-verified:${tenantId}`;

// Cached, because the email path asks this for every unverified send.
@Injectable()
export class TenantVerificationService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly cls: ClsService<AppClsStore>,
    private readonly cacheService: CacheService,
  ) {}

  async isVerified(tenantId = this.cls.get('tenantId')): Promise<boolean> {
    if (!tenantId) return true;
    const cached = await this.cacheService.getGlobal<boolean>(
      cacheKey(tenantId),
    );
    if (cached !== undefined) return cached;
    const tenant = await this.tenantRepo.findOne({
      select: { id: true, verifiedAt: true },
      where: { id: tenantId },
    });
    const verified = !!tenant?.verifiedAt;
    this.cacheService.setGlobal(
      cacheKey(tenantId),
      verified,
      CACHE_TTL_SECONDS,
    );
    return verified;
  }

  async assertVerified(action: string): Promise<void> {
    if (!(await this.isVerified())) {
      throw new ForbiddenException(
        `Please verify your account before you ${action}.`,
      );
    }
  }

  clear(tenantId: string): void {
    this.cacheService.delGlobal(cacheKey(tenantId));
  }
}
