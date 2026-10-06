import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChurchSetting } from '../../church-settings/entity/church-setting.entity';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { UpdateEvangelismSettingsDto } from '../dto/convert.dto';

export interface EvangelismSettings {
  // A convert not contacted for longer than this (and not yet a member) needs follow-up.
  overdueDays: number;
  // Off = new converts stay unassigned until an admin assigns them.
  autoAssign: boolean;
}

const STORAGE_KEY = 'evangelism:settings';
const CACHE_KEY = 'evangelism-settings';
const CACHE_TTL = 300;
const DEFAULTS: EvangelismSettings = { overdueDays: 7, autoAssign: true };

@Injectable()
export class EvangelismSettingsService {
  constructor(
    @InjectRepository(ChurchSetting)
    private readonly settingRepo: Repository<ChurchSetting>,
    private readonly cacheService: CacheService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async get(): Promise<EvangelismSettings> {
    const cached = await this.cacheService.get<EvangelismSettings>(CACHE_KEY);
    if (cached !== undefined) return cached;
    const row = await this.settingRepo.findOne({ where: { key: STORAGE_KEY } });
    const stored = (row?.value ?? {}) as Partial<EvangelismSettings>;
    const settings: EvangelismSettings = {
      overdueDays:
        typeof stored.overdueDays === 'number'
          ? stored.overdueDays
          : DEFAULTS.overdueDays,
      autoAssign:
        typeof stored.autoAssign === 'boolean'
          ? stored.autoAssign
          : DEFAULTS.autoAssign,
    };
    this.cacheService.set(CACHE_KEY, settings, CACHE_TTL);
    return settings;
  }

  async update(
    dto: UpdateEvangelismSettingsDto,
    actorId: string,
  ): Promise<EvangelismSettings> {
    const current = await this.get();
    const next: EvangelismSettings = {
      overdueDays: dto.overdueDays ?? current.overdueDays,
      autoAssign: dto.autoAssign ?? current.autoAssign,
    };
    let row = await this.settingRepo.findOne({ where: { key: STORAGE_KEY } });
    if (!row) {
      row = this.settingRepo.create({
        key: STORAGE_KEY,
        moduleName: 'Evangelism',
        value: { ...next },
      });
    } else {
      row.value = { ...next };
    }
    await this.settingRepo.save(row);
    this.cacheService.del(CACHE_KEY);

    this.auditLogService.log('EVANGELISM_SETTINGS_UPDATED', {
      actorId,
      metadata: { ...dto },
    });
    return next;
  }
}
