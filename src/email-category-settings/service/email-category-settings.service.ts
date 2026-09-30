import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { queryTenant } from '../../tenant/utility/query-tenant';
import { ChurchSetting } from '../../church-settings/entity/church-setting.entity';
import {
  EmailCategorySettingResponseDto,
  UpdateEmailCategorySettingDto,
} from '../dto/email-category-setting.dto';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { KNOWN_EMAIL_CATEGORIES } from '../constant/known-email-categories.constant';
import { CacheService } from '../../utility/service/cache.service';
import { PUSH_CATALOGUE } from '../../notification-catalogue/push-catalogue';
import { AuditLogService } from '../../utility/service/audit-log.service';

// pushEnabled absent on rows saved before Push had its own switch — those followed `enabled`.
type EmailCategorySettingValue = { enabled: boolean; pushEnabled?: boolean };

function pushEnabledOf(value?: EmailCategorySettingValue): boolean {
  return value?.pushEnabled ?? value?.enabled ?? true;
}

const PUSH_CATEGORIES = new Set(
  Object.values(PUSH_CATALOGUE).map((t) => t.category),
);

// Per-tenant on/off switch per EmailCategory — same ChurchSetting-backed
// pattern as ReminderSettingsService (own key namespace, 'email_category:'),
// deliberately a *narrower* concept than reminder settings: this is a plain
// enabled/disabled flag, not a schedule/threshold. EmailQueueService checks
// this in addition to the existing EMAIL_<CATEGORY>_ENABLED env var — the
// env var is a platform-wide kill switch, this is the per-church override.
@Injectable()
export class EmailCategorySettingsService {
  private readonly CACHE_TTL = 300;

  constructor(
    @InjectRepository(ChurchSetting)
    private readonly settingRepo: Repository<ChurchSetting>,
    private readonly cacheService: CacheService,
    private readonly auditLogService: AuditLogService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  // Read on the send path, which often runs after the caller's tenant transaction has closed.
  private async storedValue(
    category: EmailCategory,
  ): Promise<EmailCategorySettingValue | undefined> {
    const [row] = await queryTenant<{ value: EmailCategorySettingValue }>(
      this.dataSource,
      this.cls.get('schemaName'),
      (schema) => `SELECT value FROM ${schema}.church_settings WHERE key = $1`,
      [this.storageKey(category)],
    );
    return row?.value;
  }

  private storageKey(category: EmailCategory): string {
    return `email_category:${category}`;
  }

  private cacheKey(category: EmailCategory): string {
    return `email-category-settings:${category}`;
  }

  private pushCacheKey(category: EmailCategory): string {
    return `push-category-settings:${category}`;
  }

  private toDto(
    category: EmailCategory,
    value?: EmailCategorySettingValue,
  ): EmailCategorySettingResponseDto {
    const known = KNOWN_EMAIL_CATEGORIES[category];
    const hasPush = PUSH_CATEGORIES.has(category);
    return {
      category,
      label: known.label,
      description: known.description,
      enabled: value?.enabled ?? true,
      hasPush,
      pushEnabled: hasPush ? pushEnabledOf(value) : false,
    };
  }

  async findAll(): Promise<EmailCategorySettingResponseDto[]> {
    const rows = await this.settingRepo.find({
      where: {
        key: In(Object.values(EmailCategory).map((c) => this.storageKey(c))),
      },
    });
    const overrides = new Map(
      rows.map((r) => [r.key, r.value as EmailCategorySettingValue]),
    );
    return Object.values(EmailCategory).map((category) =>
      this.toDto(category, overrides.get(this.storageKey(category))),
    );
  }

  async findOne(
    category: EmailCategory,
  ): Promise<EmailCategorySettingResponseDto> {
    this.assertKnownCategory(category);
    const row = await this.settingRepo.findOne({
      where: { key: this.storageKey(category) },
    });
    return this.toDto(
      category,
      row?.value as EmailCategorySettingValue | undefined,
    );
  }

  async upsert(
    category: EmailCategory,
    dto: UpdateEmailCategorySettingDto,
    actorMemberId?: string,
  ): Promise<EmailCategorySettingResponseDto> {
    this.assertKnownCategory(category);
    const known = KNOWN_EMAIL_CATEGORIES[category];
    const storageKey = this.storageKey(category);

    let row = await this.settingRepo.findOne({ where: { key: storageKey } });
    const current = row?.value as EmailCategorySettingValue | undefined;
    const value: EmailCategorySettingValue = {
      enabled: dto.enabled ?? current?.enabled ?? true,
      pushEnabled: dto.pushEnabled ?? pushEnabledOf(current),
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
    this.cacheService.del(this.cacheKey(category));
    this.cacheService.del(this.pushCacheKey(category));

    this.auditLogService.log('EMAIL_CATEGORY_SETTING_UPDATED', {
      actorId: actorMemberId,
      targetId: category,
      metadata: { enabled: value.enabled, pushEnabled: value.pushEnabled },
    });

    return this.toDto(category, value);
  }

  // Called by EmailQueueService before every category-tagged send — cached
  // so this doesn't add a DB round trip to every queued email.
  async isEnabled(category: EmailCategory): Promise<boolean> {
    const cacheKey = this.cacheKey(category);
    const cached = await this.cacheService.get<boolean>(cacheKey);
    if (cached !== undefined) return cached;

    const value = await this.storedValue(category);
    const enabled = value?.enabled ?? true;
    this.cacheService.set(cacheKey, enabled, this.CACHE_TTL);
    return enabled;
  }

  // Checked before every catalogue push — cached like isEnabled.
  async isPushEnabled(category: EmailCategory): Promise<boolean> {
    const cacheKey = this.pushCacheKey(category);
    const cached = await this.cacheService.get<boolean>(cacheKey);
    if (cached !== undefined) return cached;

    const enabled = pushEnabledOf(await this.storedValue(category));
    this.cacheService.set(cacheKey, enabled, this.CACHE_TTL);
    return enabled;
  }

  private assertKnownCategory(category: EmailCategory): void {
    if (!Object.values(EmailCategory).includes(category)) {
      throw new NotFoundException(`Unknown email category: ${category}`);
    }
  }
}
