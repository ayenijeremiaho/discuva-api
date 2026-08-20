import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChurchSetting } from '../../church-settings/entity/church-setting.entity';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';

const STORAGE_KEY = 'attendance:enforce_distance_check';
const CACHE_KEY = 'attendance-settings:enforce-distance-check';
const CACHE_TTL = 300;

export interface EnforceDistanceCheckConfig {
  enabled: boolean;
  // false once this church has set its own value — lets the admin UI show
  // "following the platform default" vs. "set for your church specifically".
  isPlatformDefault: boolean;
}

// One-off, ChurchSetting-backed per-tenant override for whether attendance
// check-in enforces the venue distance check — same table/pattern as
// ReminderSettingsService/EmailCategorySettingsService, but only a single
// key (not a whole family), so it lives inside AttendanceModule rather
// than getting its own top-level module.
@Injectable()
export class AttendanceSettingsService {
  constructor(
    @InjectRepository(ChurchSetting)
    private readonly settingRepo: Repository<ChurchSetting>,
    private readonly cacheService: CacheService,
    private readonly auditLogService: AuditLogService,
    private readonly platformSettingsService: PlatformSettingsService,
  ) {}

  async getConfig(): Promise<EnforceDistanceCheckConfig> {
    const row = await this.settingRepo.findOne({
      where: { key: STORAGE_KEY },
    });
    if (row) {
      return {
        enabled: (row.value as { enabled: boolean }).enabled,
        isPlatformDefault: false,
      };
    }
    const enabled =
      await this.platformSettingsService.getEnforceDistanceCheckDefault();
    return { enabled, isPlatformDefault: true };
  }

  // Called by AttendanceService.validateLocation() on every check-in with
  // a location — cached so this doesn't add a DB round trip per check-in.
  async isEnabled(): Promise<boolean> {
    const cached = await this.cacheService.get<boolean>(CACHE_KEY);
    if (cached !== undefined) return cached;

    const config = await this.getConfig();
    this.cacheService.set(CACHE_KEY, config.enabled, CACHE_TTL);
    return config.enabled;
  }

  async setEnabled(
    enabled: boolean,
    actorMemberId?: string,
  ): Promise<EnforceDistanceCheckConfig> {
    let row = await this.settingRepo.findOne({
      where: { key: STORAGE_KEY },
    });
    if (!row) {
      row = this.settingRepo.create({
        key: STORAGE_KEY,
        moduleName: 'Attendance',
        value: { enabled },
      });
    } else {
      row.value = { enabled };
    }
    await this.settingRepo.save(row);
    this.cacheService.del(CACHE_KEY);

    this.auditLogService.log('ATTENDANCE_DISTANCE_CHECK_SETTING_UPDATED', {
      actorId: actorMemberId,
      metadata: { enabled },
    });

    return { enabled, isPlatformDefault: false };
  }
}
