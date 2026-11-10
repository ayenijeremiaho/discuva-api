import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FirstTimerField } from '../entity/first-timer-field.entity';
import { FirstTimerAnswer } from '../entity/first-timer.entity';
import {
  CHOICE_FIELD_TYPES,
  FirstTimerFieldType,
} from '../enums/follow-up.enum';
import {
  CreateFirstTimerFieldDto,
  UpdateFirstTimerFieldDto,
} from '../dto/first-timer-field.dto';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

const CACHE_KEY = 'follow-up:card-fields';
const CACHE_TTL = 300;
const MAX_FIELDS = 40;
const MAX_TEXT = 1000;

export type PublicCardField = Pick<
  FirstTimerField,
  'id' | 'key' | 'label' | 'type' | 'options' | 'required'
>;

@Injectable()
export class FirstTimerCardService {
  constructor(
    @InjectRepository(FirstTimerField)
    private readonly fieldRepo: Repository<FirstTimerField>,
    private readonly cacheService: CacheService,
    private readonly auditLogService: AuditLogService,
  ) {}

  findAll(): Promise<FirstTimerField[]> {
    return this.fieldRepo.find({ order: { sortOrder: 'ASC', label: 'ASC' } });
  }

  // What a card shows: switched-on fields only, cached since every form load reads it.
  async enabledFields(): Promise<PublicCardField[]> {
    const cached = await this.cacheService.get<PublicCardField[]>(CACHE_KEY);
    if (cached !== undefined) return cached;
    const fields = await this.fieldRepo.find({
      where: { enabled: true },
      select: ['id', 'key', 'label', 'type', 'options', 'required'],
      order: { sortOrder: 'ASC', label: 'ASC' },
    });
    this.cacheService.set(CACHE_KEY, fields, CACHE_TTL);
    return fields;
  }

  async create(
    dto: CreateFirstTimerFieldDto,
    actorId: string,
  ): Promise<FirstTimerField> {
    const count = await this.fieldRepo.count();
    if (count >= MAX_FIELDS)
      throw new BadRequestException(
        `A card can have up to ${MAX_FIELDS} fields.`,
      );
    const options = this.cleanOptions(dto.type, dto.options);
    const field = await this.fieldRepo.save(
      this.fieldRepo.create({
        key: null,
        label: dto.label.trim(),
        type: dto.type,
        options,
        enabled: true,
        required: dto.required ?? false,
        inReport: dto.inReport ?? true,
        sortOrder: count,
      }),
    );
    this.changed('FIRST_TIMER_FIELD_CREATED', field, actorId);
    return field;
  }

  async update(
    id: string,
    dto: UpdateFirstTimerFieldDto,
    actorId: string,
  ): Promise<FirstTimerField> {
    const field = await this.getOrThrow(id);
    if (dto.label !== undefined) field.label = dto.label.trim();
    if (dto.options !== undefined)
      field.options = this.cleanOptions(field.type, dto.options);
    if (dto.enabled !== undefined) field.enabled = dto.enabled;
    if (dto.required !== undefined) field.required = dto.required;
    if (dto.inReport !== undefined) field.inReport = dto.inReport;
    const saved = await this.fieldRepo.save(field);
    this.changed('FIRST_TIMER_FIELD_UPDATED', saved, actorId);
    return saved;
  }

  // Answers already given stay on each first-timer; they just stop showing.
  async remove(id: string, actorId: string): Promise<void> {
    const field = await this.getOrThrow(id);
    if (field.key)
      throw new BadRequestException(
        'Ready-made fields can be switched off but not deleted.',
      );
    await this.fieldRepo.delete(id);
    this.changed('FIRST_TIMER_FIELD_DELETED', field, actorId);
  }

  async reorder(ids: string[], actorId: string): Promise<FirstTimerField[]> {
    const fields = await this.findAll();
    const position = new Map(ids.map((id, i) => [id, i]));
    const ordered = [...fields].sort(
      (a, b) =>
        (position.get(a.id) ?? ids.length + a.sortOrder) -
        (position.get(b.id) ?? ids.length + b.sortOrder),
    );
    const moved = ordered.filter((f, i) => f.sortOrder !== i);
    moved.forEach((f) => (f.sortOrder = ordered.indexOf(f)));
    if (moved.length) await this.fieldRepo.save(moved);
    this.cacheService.del(CACHE_KEY);
    this.auditLogService.log('FIRST_TIMER_FIELDS_REORDERED', {
      actorId,
      metadata: { count: moved.length },
    });
    return ordered;
  }

  // Keeps answers to switched-on fields only, in the shape each type expects.
  async cleanAnswers(
    raw: Record<string, unknown> | undefined,
    { requireAll }: { requireAll: boolean },
  ): Promise<Record<string, FirstTimerAnswer>> {
    const fields = await this.enabledFields();
    const answers: Record<string, FirstTimerAnswer> = {};
    for (const field of fields) {
      const value = this.cleanValue(field, raw?.[field.id]);
      if (value === undefined) {
        if (requireAll && field.required)
          throw new BadRequestException(`Please answer "${field.label}".`);
        continue;
      }
      answers[field.id] = value;
    }
    return answers;
  }

  private cleanValue(
    field: PublicCardField,
    value: unknown,
  ): FirstTimerAnswer | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const invalid = () =>
      new BadRequestException(`"${field.label}" has an answer it can't take.`);
    switch (field.type) {
      case FirstTimerFieldType.YES_NO:
        if (typeof value !== 'boolean') throw invalid();
        return value;
      case FirstTimerFieldType.CHOICE:
        if (typeof value !== 'string' || !field.options.includes(value))
          throw invalid();
        return value;
      case FirstTimerFieldType.MULTI_CHOICE: {
        if (
          !Array.isArray(value) ||
          value.some((v) => typeof v !== 'string' || !field.options.includes(v))
        )
          throw invalid();
        const picked = [...new Set(value as string[])];
        return picked.length ? picked : undefined;
      }
      case FirstTimerFieldType.DATE:
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
          throw invalid();
        return value;
      case FirstTimerFieldType.DAY_MONTH: {
        const match =
          typeof value === 'string' && /^(\d{2})-(\d{2})$/.exec(value);
        if (
          !match ||
          +match[1] < 1 ||
          +match[1] > 12 ||
          +match[2] < 1 ||
          +match[2] > 31
        )
          throw invalid();
        return value as string;
      }
      default: {
        if (typeof value !== 'string') throw invalid();
        const text = value.trim();
        if (text.length > MAX_TEXT)
          throw new BadRequestException(
            `"${field.label}" can be up to ${MAX_TEXT} characters.`,
          );
        return text || undefined;
      }
    }
  }

  private cleanOptions(
    type: FirstTimerFieldType,
    options: string[] | undefined,
  ): string[] {
    if (!CHOICE_FIELD_TYPES.has(type)) return [];
    const cleaned = [
      ...new Set((options ?? []).map((o) => o.trim()).filter(Boolean)),
    ];
    if (cleaned.length < 2)
      throw new BadRequestException('A choice needs at least two options.');
    return cleaned;
  }

  private async getOrThrow(id: string): Promise<FirstTimerField> {
    const field = await this.fieldRepo.findOne({ where: { id } });
    if (!field) throw new NotFoundException('Card field not found');
    return field;
  }

  private changed(
    action:
      | 'FIRST_TIMER_FIELD_CREATED'
      | 'FIRST_TIMER_FIELD_UPDATED'
      | 'FIRST_TIMER_FIELD_DELETED',
    field: FirstTimerField,
    actorId: string,
  ): void {
    this.cacheService.del(CACHE_KEY);
    this.cacheService.flushNamespace('follow-up:report');
    this.auditLogService.log(action, {
      actorId,
      targetId: field.id,
      targetName: field.label,
    });
  }
}
