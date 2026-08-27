import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ChurchSetting } from '../../church-settings/entity/church-setting.entity';
import {
  ReminderSettingResponseDto,
  UpdateReminderSettingDto,
} from '../dto/reminder-setting.dto';
import { ReminderSettingKey } from '../enum/reminder-setting-key.enum';
import { KNOWN_REMINDER_SETTINGS } from '../constant/known-reminder-settings.constant';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

type ReminderSettingValue = {
  enabled: boolean;
  thresholds: number[];
  smsEnabled?: boolean;
};

@Injectable()
export class ReminderSettingsService {
  private readonly CACHE_TTL = 300;

  constructor(
    @InjectRepository(ChurchSetting)
    private readonly settingRepo: Repository<ChurchSetting>,
    private readonly cacheService: CacheService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private storageKey(key: ReminderSettingKey): string {
    return `reminder:${key}`;
  }

  private cacheKey(key: ReminderSettingKey): string {
    return `reminder-settings:${key}`;
  }

  async findAll(): Promise<ReminderSettingResponseDto[]> {
    const rows = await this.settingRepo.find({
      where: {
        key: In(
          Object.values(ReminderSettingKey).map((k) => this.storageKey(k)),
        ),
      },
    });
    const overrides = new Map(
      rows.map((r) => [r.key, r.value as ReminderSettingValue]),
    );
    return Object.values(ReminderSettingKey).map((key) => {
      const known = KNOWN_REMINDER_SETTINGS[key];
      const override = overrides.get(this.storageKey(key));
      return {
        key,
        label: known.label,
        unit: known.unit,
        enabled: override?.enabled ?? true,
        thresholds: override?.thresholds ?? known.defaultThresholds,
        smsEnabled: override?.smsEnabled ?? false,
      };
    });
  }

  async findOne(key: ReminderSettingKey): Promise<ReminderSettingResponseDto> {
    this.assertKnownKey(key);
    const known = KNOWN_REMINDER_SETTINGS[key];
    const row = await this.settingRepo.findOne({
      where: { key: this.storageKey(key) },
    });
    const value = row?.value as ReminderSettingValue | undefined;
    return {
      key,
      label: known.label,
      unit: known.unit,
      enabled: value?.enabled ?? true,
      thresholds: value?.thresholds ?? known.defaultThresholds,
      smsEnabled: value?.smsEnabled ?? false,
    };
  }

  async upsert(
    key: ReminderSettingKey,
    dto: UpdateReminderSettingDto,
    actorMemberId?: string,
  ): Promise<ReminderSettingResponseDto> {
    this.assertKnownKey(key);
    const known = KNOWN_REMINDER_SETTINGS[key];
    const storageKey = this.storageKey(key);

    let row = await this.settingRepo.findOne({ where: { key: storageKey } });
    const value: ReminderSettingValue = {
      enabled: dto.enabled,
      thresholds: dto.thresholds,
      smsEnabled: dto.smsEnabled,
    };

    if (!row) {
      row = this.settingRepo.create({
        key: storageKey,
        moduleName: known.label,
        value,
      });
    } else {
      row.value = value;
    }
    await this.settingRepo.save(row);
    this.cacheService.del(this.cacheKey(key));

    this.auditLogService.log('REMINDER_SETTING_UPDATED', {
      actorId: actorMemberId,
      targetId: key,
      metadata: {
        enabled: dto.enabled,
        thresholds: dto.thresholds,
        smsEnabled: dto.smsEnabled,
      },
    });

    return {
      key,
      label: known.label,
      unit: known.unit,
      enabled: dto.enabled,
      thresholds: dto.thresholds,
      smsEnabled: dto.smsEnabled,
    };
  }

  async getConfig(key: ReminderSettingKey): Promise<ReminderSettingValue> {
    const cacheKey = this.cacheKey(key);
    const cached = await this.cacheService.get<ReminderSettingValue>(cacheKey);
    if (cached !== undefined) return cached;

    const known = KNOWN_REMINDER_SETTINGS[key];
    const row = await this.settingRepo.findOne({
      where: { key: this.storageKey(key) },
    });
    const value = row?.value as ReminderSettingValue | undefined;
    const config: ReminderSettingValue = {
      enabled: value?.enabled ?? true,
      thresholds: value?.thresholds ?? known.defaultThresholds,
      smsEnabled: value?.smsEnabled ?? false,
    };
    this.cacheService.set(cacheKey, config, this.CACHE_TTL);
    return config;
  }

  private assertKnownKey(key: ReminderSettingKey): void {
    if (!Object.values(ReminderSettingKey).includes(key)) {
      throw new NotFoundException(`Unknown reminder setting key: ${key}`);
    }
  }
}
