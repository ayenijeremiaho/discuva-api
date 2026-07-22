import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChurchSetting } from '../entity/church-setting.entity';
import {
  ChurchSettingResponseDto,
  UpdateChurchSettingDto,
} from '../dto/church-setting.dto';
import { KNOWN_MODULES } from '../constants/known-modules.constant';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

@Injectable()
export class ChurchSettingsService {
  private readonly CACHE_TTL = 300;

  constructor(
    @InjectRepository(ChurchSetting)
    private readonly settingRepo: Repository<ChurchSetting>,
    private readonly cacheService: CacheService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private cacheKey(key: string): string {
    return `church-settings:module:${key}`;
  }

  async findAll(): Promise<ChurchSettingResponseDto[]> {
    const rows = await this.settingRepo.find();
    const overrides = new Map(
      rows.map((r) => [
        r.key,
        r.value as { enabled: boolean; displayName?: string },
      ]),
    );
    return KNOWN_MODULES.map((m) => {
      const override = overrides.get(m.key);
      return {
        key: m.key,
        moduleName: m.moduleName,
        required: m.required,
        enabled: override?.enabled ?? true,
        displayName: override?.displayName,
      };
    });
  }

  async findOne(key: string): Promise<ChurchSettingResponseDto> {
    this.assertKnownKey(key);
    const module = KNOWN_MODULES.find((m) => m.key === key)!;
    const row = await this.settingRepo.findOne({ where: { key } });
    const value = row?.value as
      | { enabled: boolean; displayName?: string }
      | undefined;
    return {
      key,
      moduleName: module.moduleName,
      required: module.required,
      enabled: value?.enabled ?? true,
      displayName: value?.displayName,
    };
  }

  async upsert(
    key: string,
    dto: UpdateChurchSettingDto,
    actorMemberId?: string,
  ): Promise<ChurchSettingResponseDto> {
    this.assertKnownKey(key);
    const module = KNOWN_MODULES.find((m) => m.key === key)!;

    if (module.required && !dto.enabled) {
      throw new BadRequestException(
        `Module '${module.moduleName}' is required and cannot be disabled.`,
      );
    }

    let row = await this.settingRepo.findOne({ where: { key } });
    // PATCH semantics: an omitted displayName means "leave it as-is", not
    // "clear it" — e.g. toggling enabled via the settings-page switch never
    // sends displayName, and must not wipe a previously-set rename.
    const existingDisplayName = (
      row?.value as { displayName?: string } | undefined
    )?.displayName;
    const displayName = dto.displayName ?? existingDisplayName;
    const value = { enabled: dto.enabled, displayName };

    if (!row) {
      row = this.settingRepo.create({
        key,
        moduleName: module.moduleName,
        value,
      });
    } else {
      row.value = value;
    }
    await this.settingRepo.save(row);
    this.cacheService.del(this.cacheKey(key));

    this.auditLogService.log('CHURCH_SETTING_UPDATED', {
      actorId: actorMemberId,
      targetId: key,
      metadata: { moduleName: module.moduleName, enabled: dto.enabled },
    });

    return {
      key,
      moduleName: module.moduleName,
      required: module.required,
      enabled: dto.enabled,
      displayName,
    };
  }

  async isEnabled(key: string): Promise<boolean> {
    const cacheKey = this.cacheKey(key);
    const cached = await this.cacheService.get<{ enabled: boolean }>(cacheKey);
    if (cached !== undefined) return cached.enabled;

    const row = await this.settingRepo.findOne({ where: { key } });
    const value = row?.value as { enabled: boolean } | undefined;
    const enabled = value?.enabled ?? true;
    this.cacheService.set(cacheKey, { enabled }, this.CACHE_TTL);
    return enabled;
  }

  // Public-facing, module-agnostic state — consumed by both frontends for
  // nav/tile visibility. Unlike findAll(), this doesn't require AdminGuard,
  // since regular workers/members also need to know which mobile features
  // are enabled for their church.
  async getPublicModuleState(): Promise<
    { key: string; enabled: boolean; displayName: string }[]
  > {
    const all = await this.findAll();
    return all.map((m) => ({
      key: m.key,
      enabled: m.enabled,
      displayName: m.displayName ?? m.moduleName,
    }));
  }

  private assertKnownKey(key: string): void {
    if (!KNOWN_MODULES.some((m) => m.key === key)) {
      throw new NotFoundException(`Unknown module key: ${key}`);
    }
  }
}
