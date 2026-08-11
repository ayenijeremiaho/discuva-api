import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformSetting } from '../entity/platform-setting.entity';
import {
  PlatformSettingResponseDto,
  UpdatePlatformSettingDto,
} from '../dto/platform-setting.dto';
import { PlatformSettingKey } from '../enum/platform-setting-key.enum';
import { KNOWN_PLATFORM_SETTINGS } from '../constant/known-platform-settings.constant';
import { CacheService } from '../../utility/service/cache.service';

@Injectable()
export class PlatformSettingsService {
  private readonly CACHE_TTL = 300;

  constructor(
    @InjectRepository(PlatformSetting)
    private readonly settingRepo: Repository<PlatformSetting>,
    private readonly cacheService: CacheService,
  ) {}

  private cacheKey(key: PlatformSettingKey): string {
    return `platform-settings:${key}`;
  }

  async findAll(): Promise<PlatformSettingResponseDto[]> {
    const rows = await this.settingRepo.find();
    const overrides = new Map(
      rows.map((r) => [r.key, r.value as { value: number }]),
    );
    return Object.values(PlatformSettingKey).map((key) => {
      const known = KNOWN_PLATFORM_SETTINGS[key];
      const override = overrides.get(key);
      return {
        key,
        label: known.label,
        unit: known.unit,
        value: override?.value ?? known.defaultValue,
      };
    });
  }

  async findOne(key: PlatformSettingKey): Promise<PlatformSettingResponseDto> {
    this.assertKnownKey(key);
    const known = KNOWN_PLATFORM_SETTINGS[key];
    const row = await this.settingRepo.findOne({ where: { key } });
    const value = row?.value as { value: number } | undefined;
    return {
      key,
      label: known.label,
      unit: known.unit,
      value: value?.value ?? known.defaultValue,
    };
  }

  async upsert(
    key: PlatformSettingKey,
    dto: UpdatePlatformSettingDto,
  ): Promise<PlatformSettingResponseDto> {
    this.assertKnownKey(key);
    const known = KNOWN_PLATFORM_SETTINGS[key];

    let row = await this.settingRepo.findOne({ where: { key } });
    if (!row) {
      row = this.settingRepo.create({ key, value: { value: dto.value } });
    } else {
      row.value = { value: dto.value };
    }
    await this.settingRepo.save(row);
    this.cacheService.del(this.cacheKey(key));

    return { key, label: known.label, unit: known.unit, value: dto.value };
  }

  async getSubscriptionGracePeriodDays(): Promise<number> {
    const key = PlatformSettingKey.SUBSCRIPTION_GRACE_PERIOD_DAYS;
    const cacheKey = this.cacheKey(key);
    const cached = await this.cacheService.get<number>(cacheKey);
    if (cached !== undefined) return cached;

    const row = await this.settingRepo.findOne({ where: { key } });
    const value =
      (row?.value as { value: number } | undefined)?.value ??
      KNOWN_PLATFORM_SETTINGS[key].defaultValue;
    this.cacheService.set(cacheKey, value, this.CACHE_TTL);
    return value;
  }

  private assertKnownKey(key: PlatformSettingKey): void {
    if (!Object.values(PlatformSettingKey).includes(key)) {
      throw new NotFoundException(`Unknown platform setting key: ${key}`);
    }
  }
}
