import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
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
    private readonly configService: ConfigService,
  ) {}

  private cacheKey(key: PlatformSettingKey): string {
    return `platform-settings:${key}`;
  }

  // Every setting's "no row yet" fallback is its hardcoded
  // KNOWN_PLATFORM_SETTINGS default, except ENFORCE_DISTANCE_CHECK_DEFAULT —
  // that one already had a live env var (ENFORCE_DISTANCE_CHECK) governing
  // every tenant before this setting existed, so a hardcoded default here
  // would silently flip behavior for any environment where ops had already
  // set that env var to something other than the default. Reading it live
  // instead means shipping this changes nothing until a platform admin (or
  // a tenant, via their own override) actually touches it.
  private resolveDefault(key: PlatformSettingKey): number {
    if (key === PlatformSettingKey.ENFORCE_DISTANCE_CHECK_DEFAULT) {
      return this.configService.get<boolean>('ENFORCE_DISTANCE_CHECK') ? 1 : 0;
    }
    return KNOWN_PLATFORM_SETTINGS[key].defaultValue;
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
        value: override?.value ?? this.resolveDefault(key),
        min: known.min,
        max: known.max,
        type: known.type ?? 'number',
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
      value: value?.value ?? this.resolveDefault(key),
      min: known.min,
      max: known.max,
      type: known.type ?? 'number',
    };
  }

  async upsert(
    key: PlatformSettingKey,
    dto: UpdatePlatformSettingDto,
  ): Promise<PlatformSettingResponseDto> {
    this.assertKnownKey(key);
    const known = KNOWN_PLATFORM_SETTINGS[key];
    if (dto.value < known.min || dto.value > known.max) {
      throw new BadRequestException(
        `${known.label} must be between ${known.min} and ${known.max} (${known.unit}).`,
      );
    }

    let row = await this.settingRepo.findOne({ where: { key } });
    if (!row) {
      row = this.settingRepo.create({ key, value: { value: dto.value } });
    } else {
      row.value = { value: dto.value };
    }
    await this.settingRepo.save(row);
    this.cacheService.delGlobal(this.cacheKey(key));

    return {
      key,
      label: known.label,
      unit: known.unit,
      value: dto.value,
      min: known.min,
      max: known.max,
      type: known.type ?? 'number',
    };
  }

  async getSubscriptionGracePeriodDays(): Promise<number> {
    const key = PlatformSettingKey.SUBSCRIPTION_GRACE_PERIOD_DAYS;
    const cacheKey = this.cacheKey(key);
    const cached = await this.cacheService.getGlobal<number>(cacheKey);
    if (cached !== undefined) return cached;

    const row = await this.settingRepo.findOne({ where: { key } });
    const value =
      (row?.value as { value: number } | undefined)?.value ??
      this.resolveDefault(key);
    this.cacheService.setGlobal(cacheKey, value, this.CACHE_TTL);
    return value;
  }

  // Platform-wide default for AttendanceSettingsService — a tenant with no
  // override of their own follows this. See resolveDefault() for why "no
  // row yet" reads the live env var instead of a hardcoded default.
  async getEnforceDistanceCheckDefault(): Promise<boolean> {
    const key = PlatformSettingKey.ENFORCE_DISTANCE_CHECK_DEFAULT;
    const cacheKey = this.cacheKey(key);
    const cached = await this.cacheService.getGlobal<number>(cacheKey);
    if (cached !== undefined) return cached === 1;

    const row = await this.settingRepo.findOne({ where: { key } });
    const value =
      (row?.value as { value: number } | undefined)?.value ??
      this.resolveDefault(key);
    this.cacheService.setGlobal(cacheKey, value, this.CACHE_TTL);
    return value === 1;
  }

  // Shared by every DynamicLimitedFileInterceptor consumer — stored value is
  // MB (see PlatformSettingKey), converted to bytes here since that's what
  // Multer/the interceptor actually need.
  async getMaxUploadBytes(
    key:
      | PlatformSettingKey.MAX_LOGO_UPLOAD_MB
      | PlatformSettingKey.MAX_AVATAR_UPLOAD_MB
      | PlatformSettingKey.MAX_CLASS_MATERIAL_UPLOAD_MB
      | PlatformSettingKey.MAX_FINANCE_PROOF_UPLOAD_MB,
  ): Promise<number> {
    const cacheKey = this.cacheKey(key);
    const cached = await this.cacheService.getGlobal<number>(cacheKey);
    if (cached !== undefined) return cached * 1024 * 1024;

    const row = await this.settingRepo.findOne({ where: { key } });
    const valueMb =
      (row?.value as { value: number } | undefined)?.value ??
      this.resolveDefault(key);
    this.cacheService.setGlobal(cacheKey, valueMb, this.CACHE_TTL);
    return valueMb * 1024 * 1024;
  }

  private assertKnownKey(key: PlatformSettingKey): void {
    if (!Object.values(PlatformSettingKey).includes(key)) {
      throw new NotFoundException(`Unknown platform setting key: ${key}`);
    }
  }
}
