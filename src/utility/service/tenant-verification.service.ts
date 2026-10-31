import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { Repository } from 'typeorm';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { OrganisationTypeEnum } from '../../tenant/enum/organisation-type.enum';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { PlatformSettingKey } from '../../platform-admin/enum/platform-setting-key.enum';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { CacheService } from './cache.service';

const CACHE_TTL_SECONDS = 300;
const cacheKey = (tenantId: string) => `tenant-verified:${tenantId}`;
const groupKey = (tenantId: string) => `tenant-is-group:${tenantId}`;

// Cached, because the email path asks this for every unverified send.
@Injectable()
export class TenantVerificationService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly cls: ClsService<AppClsStore>,
    private readonly cacheService: CacheService,
    private readonly settings: PlatformSettingsService,
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

  // Verified accounts never reach the second lookup, so the common case costs one cached read.
  async isPrivateGroup(tenantId = this.cls.get('tenantId')): Promise<boolean> {
    if (!tenantId || (await this.isVerified(tenantId))) return false;
    const key = groupKey(tenantId);
    const cached = await this.cacheService.getGlobal<boolean>(key);
    if (cached !== undefined) return cached;
    const tenant = await this.tenantRepo.findOne({
      select: { id: true, orgType: true },
      where: { id: tenantId },
    });
    const isGroup = tenant?.orgType === OrganisationTypeEnum.GROUP;
    this.cacheService.setGlobal(key, isGroup, CACHE_TTL_SECONDS);
    return isGroup;
  }

  async assertNotPrivateGroup(action: string): Promise<void> {
    if (await this.isPrivateGroup()) {
      throw new ForbiddenException(
        `Please verify your group before you ${action}.`,
      );
    }
  }

  // Takes a function so churches and verified groups never pay for the count.
  async assertRoomForMembers(
    currentCount: () => Promise<number>,
    adding = 1,
  ): Promise<void> {
    if (!(await this.isPrivateGroup())) return;
    const limit = await this.settings.getNumber(
      PlatformSettingKey.UNVERIFIED_GROUP_MEMBER_LIMIT,
    );
    if ((await currentCount()) + adding > limit) {
      throw new ForbiddenException(
        `A private group can have up to ${limit} people. Please verify your group to add more.`,
      );
    }
  }

  clear(tenantId: string): void {
    this.cacheService.delGlobal(groupKey(tenantId));
    this.cacheService.delGlobal(cacheKey(tenantId));
  }
}
