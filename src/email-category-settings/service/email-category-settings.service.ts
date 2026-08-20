import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ChurchSetting } from '../../church-settings/entity/church-setting.entity';
import {
  EmailCategorySettingResponseDto,
  UpdateEmailCategorySettingDto,
} from '../dto/email-category-setting.dto';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { KNOWN_EMAIL_CATEGORIES } from '../constant/known-email-categories.constant';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

type EmailCategorySettingValue = { enabled: boolean };

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
  ) {}

  private storageKey(category: EmailCategory): string {
    return `email_category:${category}`;
  }

  private cacheKey(category: EmailCategory): string {
    return `email-category-settings:${category}`;
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
    return Object.values(EmailCategory).map((category) => {
      const known = KNOWN_EMAIL_CATEGORIES[category];
      const override = overrides.get(this.storageKey(category));
      return {
        category,
        label: known.label,
        description: known.description,
        enabled: override?.enabled ?? true,
      };
    });
  }

  async findOne(
    category: EmailCategory,
  ): Promise<EmailCategorySettingResponseDto> {
    this.assertKnownCategory(category);
    const known = KNOWN_EMAIL_CATEGORIES[category];
    const row = await this.settingRepo.findOne({
      where: { key: this.storageKey(category) },
    });
    const value = row?.value as EmailCategorySettingValue | undefined;
    return {
      category,
      label: known.label,
      description: known.description,
      enabled: value?.enabled ?? true,
    };
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
    const value: EmailCategorySettingValue = { enabled: dto.enabled };

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

    this.auditLogService.log('EMAIL_CATEGORY_SETTING_UPDATED', {
      actorId: actorMemberId,
      targetId: category,
      metadata: { enabled: dto.enabled },
    });

    return {
      category,
      label: known.label,
      description: known.description,
      enabled: dto.enabled,
    };
  }

  // Called by EmailQueueService before every category-tagged send — cached
  // so this doesn't add a DB round trip to every queued email.
  async isEnabled(category: EmailCategory): Promise<boolean> {
    const cacheKey = this.cacheKey(category);
    const cached = await this.cacheService.get<boolean>(cacheKey);
    if (cached !== undefined) return cached;

    const row = await this.settingRepo.findOne({
      where: { key: this.storageKey(category) },
    });
    const value = row?.value as EmailCategorySettingValue | undefined;
    const enabled = value?.enabled ?? true;
    this.cacheService.set(cacheKey, enabled, this.CACHE_TTL);
    return enabled;
  }

  private assertKnownCategory(category: EmailCategory): void {
    if (!Object.values(EmailCategory).includes(category)) {
      throw new NotFoundException(`Unknown email category: ${category}`);
    }
  }
}
