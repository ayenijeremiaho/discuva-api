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
import { TenantVerificationService } from '../../utility/service/tenant-verification.service';
import {
  AccountTypeProfile,
  AccountTypeService,
} from '../../account-type/account-type.service';
import { applyWording } from '../../account-type/apply-wording';

@Injectable()
export class ChurchSettingsService {
  private readonly CACHE_TTL = 300;

  constructor(
    @InjectRepository(ChurchSetting)
    private readonly settingRepo: Repository<ChurchSetting>,
    private readonly cacheService: CacheService,
    private readonly auditLogService: AuditLogService,
    private readonly accountTypes: AccountTypeService,
    private readonly verification: TenantVerificationService,
  ) {}

  private async profile(): Promise<AccountTypeProfile> {
    return this.accountTypes.getProfile(await this.verification.orgType());
  }

  // The church's own choice wins unless its account type doesn't offer the module at all.
  private view(
    module: (typeof KNOWN_MODULES)[number],
    value: { enabled: boolean; displayName?: string } | undefined,
    profile: AccountTypeProfile,
  ): ChurchSettingResponseDto {
    const availability = profile.modules[module.key];
    return {
      key: module.key,
      moduleName: applyWording(module.moduleName, profile.wording),
      required: module.required && availability === 'on',
      available: availability !== 'hidden',
      enabled:
        availability !== 'hidden' && (value?.enabled ?? availability === 'on'),
      displayName: value?.displayName,
    };
  }

  private cacheKey(key: string): string {
    return `church-settings:module:${key}`;
  }

  async findAll(): Promise<ChurchSettingResponseDto[]> {
    const [rows, profile] = await Promise.all([
      this.settingRepo.find(),
      this.profile(),
    ]);
    const overrides = new Map(
      rows.map((r) => [
        r.key,
        r.value as { enabled: boolean; displayName?: string },
      ]),
    );
    return KNOWN_MODULES.map((m) =>
      this.view(m, overrides.get(m.key), profile),
    );
  }

  async findOne(key: string): Promise<ChurchSettingResponseDto> {
    this.assertKnownKey(key);
    const module = KNOWN_MODULES.find((m) => m.key === key)!;
    const [row, profile] = await Promise.all([
      this.settingRepo.findOne({ where: { key } }),
      this.profile(),
    ]);
    return this.view(
      module,
      row?.value as { enabled: boolean; displayName?: string } | undefined,
      profile,
    );
  }

  async upsert(
    key: string,
    dto: UpdateChurchSettingDto,
    actorMemberId?: string,
  ): Promise<ChurchSettingResponseDto> {
    this.assertKnownKey(key);
    const module = KNOWN_MODULES.find((m) => m.key === key)!;

    const profile = await this.profile();
    const availability = profile.modules[key];
    if (availability === 'hidden' && dto.enabled) {
      throw new BadRequestException(
        `Module '${module.moduleName}' isn't available for this account.`,
      );
    }
    if (module.required && availability === 'on' && !dto.enabled) {
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

    return this.view(module, value, profile);
  }

  async isEnabled(key: string): Promise<boolean> {
    const cacheKey = this.cacheKey(key);
    const cached = await this.cacheService.get<{ enabled: boolean }>(cacheKey);
    if (cached !== undefined) return cached.enabled;

    const [row, profile] = await Promise.all([
      this.settingRepo.findOne({ where: { key } }),
      this.profile(),
    ]);
    const availability = profile.modules[key] ?? 'on';
    const value = row?.value as { enabled: boolean } | undefined;
    const enabled =
      availability !== 'hidden' && (value?.enabled ?? availability === 'on');
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
