import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChurchSetting } from '../../church-settings/entity/church-setting.entity';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { memberExportFields } from '../utility/member-csv';

@Injectable()
export class MemberExportSettingsService {
  constructor(
    @InjectRepository(ChurchSetting)
    private readonly settings: Repository<ChurchSetting>,
    private readonly cache: CacheService,
    private readonly audit: AuditLogService,
  ) {}

  private key(workers: boolean): string {
    return `member-export:${workers ? 'workers' : 'members'}`;
  }

  private normalise(fields: unknown, workers: boolean): string[] {
    const selected = new Set(Array.isArray(fields) ? fields : []);
    return memberExportFields(workers)
      .filter((field) => !field.required && selected.has(field.key))
      .map((field) => field.key);
  }

  async get(workers = false): Promise<{ fields: string[] }> {
    const key = this.key(workers);
    const cached = await this.cache.get<{ fields: string[] }>(key);
    if (cached) return { fields: this.normalise(cached.fields, workers) };
    const row = await this.settings.findOne({
      where: { key },
      select: { value: true },
    });
    const result = { fields: this.normalise(row?.value?.fields, workers) };
    this.cache.set(key, result, 300);
    return result;
  }

  async save(
    fields: string[],
    workers = false,
    actorId?: string,
  ): Promise<{ fields: string[] }> {
    const key = this.key(workers);
    const value = { fields: this.normalise(fields, workers) };
    await this.settings.upsert({ key, moduleName: 'Member Exports', value }, [
      'key',
    ]);
    this.cache.del(key);
    this.audit.log('CHURCH_SETTING_UPDATED', {
      actorId,
      metadata: { key, ...value },
    });
    return value;
  }
}
