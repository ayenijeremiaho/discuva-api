import { EventService } from './event.service';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Raw, Repository } from 'typeorm';
import { EventTemplate } from '../entity/event-template.entity';
import { UpsertEventTemplateDto } from '../dto/event-series.dto';
import { AuditLogService } from '../../utility/service/audit-log.service';
import type { SlotBlueprint } from '../types/slot-blueprint';

// Saved service types — reference data, so the full list is returned.
@Injectable()
export class EventTemplateService {
  constructor(
    @InjectRepository(EventTemplate)
    private readonly templateRepo: Repository<EventTemplate>,
    private readonly auditLogService: AuditLogService,
    private readonly eventService: EventService,
  ) {}

  findAll(): Promise<EventTemplate[]> {
    return this.templateRepo.find({
      relations: ['audienceGroup'],
      order: { name: 'ASC' },
    });
  }

  async create(
    dto: UpsertEventTemplateDto,
    actorId: string,
  ): Promise<EventTemplate> {
    await this.assertNameFree(dto.name);
    const saved = await this.templateRepo.save(
      this.templateRepo.create({
        ...this.toFields(dto),
        ...(await this.eventService.resolveAudience(dto)),
      }),
    );
    this.audit('EVENT_TEMPLATE_SAVED', saved, actorId);
    return saved;
  }

  async update(
    id: string,
    dto: UpsertEventTemplateDto,
    actorId: string,
  ): Promise<EventTemplate> {
    const template = await this.findOrThrow(id);
    await this.assertNameFree(dto.name, id);
    Object.assign(
      template,
      this.toFields(dto),
      await this.eventService.resolveAudience(dto),
    );
    const saved = await this.templateRepo.save(template);
    this.audit('EVENT_TEMPLATE_SAVED', saved, actorId);
    return saved;
  }

  async remove(id: string, actorId: string): Promise<void> {
    const template = await this.findOrThrow(id);
    await this.templateRepo.remove(template);
    this.audit('EVENT_TEMPLATE_DELETED', template, actorId);
  }

  private toFields(dto: UpsertEventTemplateDto): Partial<EventTemplate> {
    return {
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      onlineAttendanceEnabled: dto.onlineAttendanceEnabled ?? false,
      slotBlueprint: dto.slotBlueprint as SlotBlueprint[],
      defaultRecurrence: dto.defaultRecurrence ?? null,
      autoProgramme: dto.autoProgramme ?? true,
    };
  }

  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const clash = await this.templateRepo.findOne({
      where: {
        name: Raw((alias) => `LOWER(${alias}) = LOWER(:name)`, {
          name: name.trim(),
        }),
        ...(exceptId ? { id: Not(exceptId) } : {}),
      },
    });
    if (clash) {
      throw new ConflictException(
        `A service type called "${clash.name}" already exists`,
      );
    }
  }

  private async findOrThrow(id: string): Promise<EventTemplate> {
    const template = await this.templateRepo.findOne({ where: { id } });
    if (!template) throw new NotFoundException('Service type not found');
    return template;
  }

  private audit(
    action: 'EVENT_TEMPLATE_SAVED' | 'EVENT_TEMPLATE_DELETED',
    t: EventTemplate,
    actorId: string,
  ): void {
    this.auditLogService.log(action, {
      actorId,
      targetId: t.id,
      targetName: t.name,
    });
  }
}
