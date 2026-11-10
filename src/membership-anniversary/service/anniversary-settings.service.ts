import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChurchSetting } from '../../church-settings/entity/church-setting.entity';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import {
  AnniversarySettings,
  UpdateAnniversarySettingsDto,
} from '../dto/anniversary-settings.dto';

const STORAGE_KEY = 'anniversary:post';
const CACHE_KEY = 'anniversary-settings';
const CACHE_TTL = 300;

export const DEFAULT_ANNIVERSARY_SETTINGS: AnniversarySettings = {
  postEnabled: true,
  title: 'Celebrating {years} with {first_name}!',
  body: 'Today marks {years} since {full_name} joined our church family. Join us in celebrating this milestone!',
};

export function renderAnniversaryText(
  template: string,
  member: { firstname: string; lastname: string },
  years: number,
): string {
  return template
    .replaceAll('{years}', `${years} ${years === 1 ? 'year' : 'years'}`)
    .replaceAll('{first_name}', member.firstname)
    .replaceAll('{full_name}', `${member.firstname} ${member.lastname}`);
}

@Injectable()
export class AnniversarySettingsService {
  constructor(
    @InjectRepository(ChurchSetting)
    private readonly settingRepo: Repository<ChurchSetting>,
    private readonly cacheService: CacheService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async get(): Promise<AnniversarySettings> {
    const cached = await this.cacheService.get<AnniversarySettings>(CACHE_KEY);
    if (cached !== undefined) return cached;
    const row = await this.settingRepo.findOne({ where: { key: STORAGE_KEY } });
    const settings = {
      ...DEFAULT_ANNIVERSARY_SETTINGS,
      ...(row?.value as Partial<AnniversarySettings> | undefined),
    };
    this.cacheService.set(CACHE_KEY, settings, CACHE_TTL);
    return settings;
  }

  async update(
    dto: UpdateAnniversarySettingsDto,
    actorId: string,
  ): Promise<AnniversarySettings> {
    const current = await this.get();
    const next: AnniversarySettings = {
      postEnabled: dto.postEnabled ?? current.postEnabled,
      title: dto.title?.trim() || current.title,
      body: dto.body?.trim() || current.body,
    };
    const row =
      (await this.settingRepo.findOne({ where: { key: STORAGE_KEY } })) ??
      this.settingRepo.create({
        key: STORAGE_KEY,
        moduleName: 'Membership Anniversary',
      });
    row.value = { ...next };
    await this.settingRepo.save(row);
    this.cacheService.del(CACHE_KEY);
    this.auditLogService.log('ANNIVERSARY_SETTINGS_UPDATED', {
      actorId,
      metadata: { postEnabled: next.postEnabled },
    });
    return next;
  }
}
