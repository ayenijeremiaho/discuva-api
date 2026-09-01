import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { ServiceProgramme } from '../entity/service-programme.entity';
import { ServiceProgrammeSlot } from '../entity/service-programme-slot.entity';
import {
  ServiceProgrammeTemplate,
  TemplateProgrammeSlot,
} from '../entity/service-programme-template.entity';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { Member } from '../../member/entity/member.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { CreateServiceProgrammeDto } from '../dto/create-service-programme.dto';
import { UpdateServiceProgrammeDto } from '../dto/update-service-programme.dto';
import { CreateServiceProgrammeSlotDto } from '../dto/create-service-programme-slot.dto';
import { UpdateServiceProgrammeSlotDto } from '../dto/update-service-programme-slot.dto';
import { ReorderProgrammeSlotsDto } from '../dto/reorder-programme-slots.dto';
import { ServiceProgrammeStatusEnum } from '../enum/service-programme-status.enum';
import {
  ServiceSlotTypeEnum,
  ServiceSlotTypeLabels,
} from '../enum/service-slot-type.enum';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import { PdfService } from '../../utility/service/pdf.service';
import {
  NotificationDispatchService,
  NotifyMemberEmail,
} from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { buildIcsEvent } from '../../utility/util/ics-builder';
import {
  withMemberNames,
  withMemberNamesList,
  ServiceProgrammeSlotWithNames,
} from '../util/slot-display';

export type ServiceProgrammeWithSummary = ServiceProgramme & {
  serviceSlotId?: string;
  serviceSlotName?: string;
  slotCount: number;
  event?: { id: string; name: string; eventDate: Date } | null;
  serviceSlotDetail?: {
    id: string;
    name: string;
    startTime: Date;
    endTime: Date;
  } | null;
};

export interface MyAssignment {
  slotId: string;
  programmeId: string;
  eventName: string | null;
  serviceSlotName: string;
  startTime: Date;
  endTime: Date;
  type: ServiceSlotTypeEnum;
  topic: string | null;
  allocatedMinutes: number;
  isBackup: boolean;
  programmeStatus: ServiceProgrammeStatusEnum;
  // Only populated once the programme has actually gone LIVE — this is what
  // the frontend needs to poll GET /service-session/:code/my-status.
  sessionCode: string | null;
}

@Injectable()
export class ServiceProgrammeService {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    @InjectRepository(ServiceProgramme)
    private readonly programmeRepo: Repository<ServiceProgramme>,
    @InjectRepository(ServiceProgrammeSlot)
    private readonly slotRepo: Repository<ServiceProgrammeSlot>,
    @InjectRepository(ServiceProgrammeTemplate)
    private readonly templateRepo: Repository<ServiceProgrammeTemplate>,
    @InjectRepository(ServiceSlot)
    private readonly serviceSlotRepo: Repository<ServiceSlot>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    private readonly pdfService: PdfService,
    private readonly notificationDispatchService: NotificationDispatchService,
  ) {}

  private readonly logger = new Logger(ServiceProgrammeService.name);

  async create(
    dto: CreateServiceProgrammeDto,
    admin: Admin,
  ): Promise<ServiceProgrammeWithSummary | ServiceProgrammeWithSummary[]> {
    const serviceSlotIds = dto.programmes.map((p) => p.serviceSlotId);

    const serviceSlots = await this.serviceSlotRepo.find({
      where: { id: In(serviceSlotIds) },
      relations: ['event'],
    });
    if (serviceSlots.length !== serviceSlotIds.length) {
      throw new NotFoundException('One or more service slots not found');
    }
    const serviceSlotById = new Map(serviceSlots.map((s) => [s.id, s]));

    const existing = await this.programmeRepo.find({
      where: { serviceSlot: { id: In(serviceSlotIds) } },
      relations: ['serviceSlot'],
    });
    if (existing.length > 0) {
      const names = existing.map((p) => p.serviceSlot.name).join(', ');
      throw new ConflictException(`A programme already exists for: ${names}`);
    }

    const programmes = this.programmeRepo.create(
      dto.programmes.map((item) => ({
        serviceSlot: serviceSlotById.get(item.serviceSlotId),
        saveAsTemplate: dto.saveAsTemplate ?? false,
        createdByAdmin: admin,
      })),
    );
    const savedProgrammes = await this.programmeRepo.save(programmes);
    savedProgrammes.forEach((saved, index) => {
      this.logger.log(
        `Programme ${saved.id} created for slot ${dto.programmes[index].serviceSlotId} by admin ${admin.id}`,
      );
    });

    const memberIds = new Set<string>();
    for (const item of dto.programmes) {
      for (const slotDto of item.slots ?? []) {
        if (slotDto.memberId) memberIds.add(slotDto.memberId);
        if (slotDto.backupMemberId) memberIds.add(slotDto.backupMemberId);
      }
    }
    const members = memberIds.size
      ? await this.memberRepo.find({ where: { id: In([...memberIds]) } })
      : [];
    const memberById = new Map(members.map((m) => [m.id, m]));

    const slotsToSave: ServiceProgrammeSlot[] = [];
    dto.programmes.forEach((item, programmeIndex) => {
      const saved = savedProgrammes[programmeIndex];
      (item.slots ?? []).forEach((slotDto, position) => {
        const member = slotDto.memberId
          ? memberById.get(slotDto.memberId)
          : null;
        if (slotDto.memberId && !member) {
          throw new NotFoundException('Member not found');
        }
        const backupMember = slotDto.backupMemberId
          ? memberById.get(slotDto.backupMemberId)
          : null;
        if (slotDto.backupMemberId && !backupMember) {
          throw new NotFoundException('Backup member not found');
        }
        slotsToSave.push(
          this.slotRepo.create({
            programme: saved,
            position,
            type: slotDto.type,
            topic: slotDto.topic ?? null,
            member: member ?? null,
            guestName: slotDto.guestName ?? null,
            backupMember: backupMember ?? null,
            backupGuestName: slotDto.backupGuestName ?? null,
            allocatedMinutes: slotDto.allocatedMinutes,
          }),
        );
      });
      if (item.slots?.length) {
        this.logger.log(
          `${item.slots.length} slot(s) added to programme ${saved.id} at creation`,
        );
      }
    });

    const savedSlots = slotsToSave.length
      ? await this.slotRepo.save(slotsToSave)
      : [];

    // Conflict-warning is a non-blocking, per-slot advisory that the create()
    // path has never surfaced to the caller (its return value was discarded
    // even before this method was batched) — skipped here entirely rather
    // than computed-and-thrown-away, unlike addSlot()/updateSlot() which do
    // return it.
    for (const slot of savedSlots) {
      if (slot.member)
        this.notifySlotAssignment(slot.member, slot.programme, slot);
      if (slot.backupMember) {
        this.notifySlotAssignment(
          slot.backupMember,
          slot.programme,
          slot,
          true,
        );
      }
    }

    const summaries = await this.findManyWithSummary(
      savedProgrammes.map((p) => p.id),
    );
    const results = savedProgrammes.map((p) => summaries.get(p.id));

    return results.length === 1 ? results[0] : results;
  }

  async findAll(
    page = 1,
    limit = 20,
  ): Promise<PaginationResponseDto<ServiceProgramme>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');

    const [data, total] = await this.programmeRepo
      .createQueryBuilder('programme')
      .leftJoinAndSelect('programme.serviceSlot', 'serviceSlot')
      .leftJoinAndSelect('serviceSlot.event', 'event')
      .leftJoinAndSelect('programme.createdByAdmin', 'createdByAdmin')
      .leftJoinAndSelect('createdByAdmin.member', 'member')
      .loadRelationCountAndMap('programme.slotCount', 'programme.slots')
      .orderBy('programme.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return UtilityService.createPaginationResponse(
      data.map((p) =>
        this.withServiceSlotSummary(
          p,
          (p as unknown as { slotCount: number }).slotCount,
        ),
      ),
      page,
      limit,
      total,
    );
  }

  // A member's own upcoming slots across every not-yet-completed programme,
  // whether they're the primary assignee or the backup — the "what am I
  // doing this month" view a member/worker has no other way to see today
  // (currently the only signal is a one-off assignment email).
  async getMyUpcomingAssignments(memberId: string): Promise<MyAssignment[]> {
    const slots = await this.slotRepo
      .createQueryBuilder('slot')
      .innerJoinAndSelect('slot.programme', 'programme')
      .innerJoinAndSelect('programme.serviceSlot', 'serviceSlot')
      .leftJoinAndSelect('serviceSlot.event', 'event')
      .leftJoinAndSelect('slot.member', 'member')
      .leftJoinAndSelect('programme.session', 'session')
      .where(
        '(slot.member_id = :memberId OR slot.backup_member_id = :memberId)',
        {
          memberId,
        },
      )
      .andWhere('serviceSlot.start_time >= :now', { now: new Date() })
      .andWhere('programme.status IN (:...statuses)', {
        statuses: [
          ServiceProgrammeStatusEnum.DRAFT,
          ServiceProgrammeStatusEnum.LIVE,
        ],
      })
      .orderBy('serviceSlot.start_time', 'ASC')
      .getMany();

    return slots.map((slot) => ({
      slotId: slot.id,
      programmeId: slot.programme.id,
      eventName: slot.programme.serviceSlot.event?.name ?? null,
      serviceSlotName: slot.programme.serviceSlot.name,
      startTime: slot.programme.serviceSlot.startTime,
      endTime: slot.programme.serviceSlot.endTime,
      type: slot.type,
      topic: slot.topic,
      allocatedMinutes: slot.allocatedMinutes,
      isBackup: slot.member?.id !== memberId,
      programmeStatus: slot.programme.status,
      sessionCode: slot.programme.session?.sessionCode ?? null,
    }));
  }

  async findOne(id: string): Promise<ServiceProgrammeWithSummary> {
    const programme = await this.programmeRepo.findOne({
      where: { id },
      relations: [
        'serviceSlot',
        'serviceSlot.event',
        'createdByAdmin',
        'createdByAdmin.member',
        'slots',
        'slots.member',
        'slots.backupMember',
      ],
      order: { slots: { position: 'ASC' } },
    });
    if (!programme) throw new NotFoundException('Programme not found');
    return this.withServiceSlotSummary(programme);
  }

  // Batched sibling of findOne() — used by create() so a multi-programme
  // request re-fetches all of its programmes in one query instead of one
  // round trip per programme.
  private async findManyWithSummary(
    ids: string[],
  ): Promise<Map<string, ServiceProgrammeWithSummary>> {
    const programmes = await this.programmeRepo.find({
      where: { id: In(ids) },
      relations: [
        'serviceSlot',
        'serviceSlot.event',
        'createdByAdmin',
        'createdByAdmin.member',
        'slots',
        'slots.member',
        'slots.backupMember',
      ],
      order: { slots: { position: 'ASC' } },
    });
    return new Map(
      programmes.map((p) => [p.id, this.withServiceSlotSummary(p)]),
    );
  }

  // `serviceSlot` is a relation object; the admin frontend renders flat
  // serviceSlotId/serviceSlotName/slotCount fields, so derive them here.
  // `event`/`serviceSlotTime` are also surfaced structurally (not just baked
  // into the serviceSlotName string) so the frontend can group programmes by
  // their parent event instead of treating every slot as unrelated.
  private withServiceSlotSummary(
    programme: ServiceProgramme,
    slotCount?: number,
  ): ServiceProgrammeWithSummary {
    return {
      ...programme,
      serviceSlotId: programme.serviceSlot?.id,
      serviceSlotName: programme.serviceSlot
        ? [programme.serviceSlot.event?.name, programme.serviceSlot.name]
            .filter(Boolean)
            .join(' — ')
        : undefined,
      slotCount: slotCount ?? programme.slots?.length ?? 0,
      event: programme.serviceSlot?.event
        ? {
            id: programme.serviceSlot.event.id,
            name: programme.serviceSlot.event.name,
            eventDate: programme.serviceSlot.event.eventDate,
          }
        : null,
      serviceSlotDetail: programme.serviceSlot
        ? {
            id: programme.serviceSlot.id,
            name: programme.serviceSlot.name,
            startTime: programme.serviceSlot.startTime,
            endTime: programme.serviceSlot.endTime,
          }
        : null,
      slots: programme.slots
        ? withMemberNamesList(programme.slots)
        : programme.slots,
    };
  }

  async update(
    id: string,
    dto: UpdateServiceProgrammeDto,
  ): Promise<ServiceProgramme> {
    const programme = await this.programmeRepo.findOne({ where: { id } });
    if (!programme) throw new NotFoundException('Programme not found');
    Object.assign(programme, dto);
    const saved = await this.programmeRepo.save(programme);
    this.logger.log(`Programme ${id} updated`);
    return saved;
  }

  async remove(id: string): Promise<void> {
    const programme = await this.programmeRepo.findOne({ where: { id } });
    if (!programme) throw new NotFoundException('Programme not found');
    if (programme.status !== ServiceProgrammeStatusEnum.DRAFT) {
      throw new BadRequestException('Only DRAFT programmes can be deleted');
    }
    await this.programmeRepo.remove(programme);
    this.logger.log(`Programme ${id} deleted`);
  }

  async addSlot(
    programmeId: string,
    dto: CreateServiceProgrammeSlotDto,
  ): Promise<ServiceProgrammeSlotWithNames & { conflictWarning?: string }> {
    const programme = await this.programmeRepo.findOne({
      where: { id: programmeId },
      relations: ['slots', 'serviceSlot', 'serviceSlot.event'],
    });
    if (!programme) throw new NotFoundException('Programme not found');
    if (programme.status !== ServiceProgrammeStatusEnum.DRAFT) {
      throw new BadRequestException(
        'Slots can only be added to DRAFT programmes',
      );
    }

    const nextPosition =
      programme.slots.length > 0
        ? Math.max(...programme.slots.map((s) => s.position)) + 1
        : 0;

    return this.createSlotForProgramme(programme, dto, nextPosition);
  }

  // Shared by addSlot() (one item, appended to an existing draft) and
  // create() (the full order-of-service, batched at creation time) so both
  // paths resolve members/notify/conflict-check identically.
  private async createSlotForProgramme(
    programme: ServiceProgramme,
    dto: CreateServiceProgrammeSlotDto,
    position: number,
  ): Promise<ServiceProgrammeSlotWithNames & { conflictWarning?: string }> {
    const member = dto.memberId
      ? await this.memberRepo.findOne({ where: { id: dto.memberId } })
      : null;
    if (dto.memberId && !member)
      throw new NotFoundException('Member not found');

    const backupMember = dto.backupMemberId
      ? await this.memberRepo.findOne({ where: { id: dto.backupMemberId } })
      : null;
    if (dto.backupMemberId && !backupMember)
      throw new NotFoundException('Backup member not found');

    const slot = this.slotRepo.create({
      programme,
      position,
      type: dto.type,
      topic: dto.topic ?? null,
      member: member ?? null,
      guestName: dto.guestName ?? null,
      backupMember: backupMember ?? null,
      backupGuestName: dto.backupGuestName ?? null,
      allocatedMinutes: dto.allocatedMinutes,
    });
    const saved = await this.slotRepo.save(slot);
    this.logger.log(
      `Slot added to programme ${programme.id} at position ${position}`,
    );

    if (member) this.notifySlotAssignment(member, programme, saved);
    if (backupMember) {
      this.notifySlotAssignment(backupMember, programme, saved, true);
    }

    const conflictWarning = member
      ? await this.findMemberConflictWarning(member, programme)
      : undefined;

    const result = withMemberNames(saved);
    return conflictWarning ? { ...result, conflictWarning } : result;
  }

  async updateSlot(
    programmeId: string,
    slotId: string,
    dto: UpdateServiceProgrammeSlotDto,
  ): Promise<ServiceProgrammeSlotWithNames & { conflictWarning?: string }> {
    const slot = await this.slotRepo.findOne({
      where: { id: slotId, programme: { id: programmeId } },
      relations: [
        'programme',
        'programme.serviceSlot',
        'programme.serviceSlot.event',
        'member',
        'backupMember',
      ],
    });
    if (!slot) throw new NotFoundException('Slot not found');
    if (slot.programme.status !== ServiceProgrammeStatusEnum.DRAFT) {
      throw new BadRequestException(
        'Slots can only be edited on DRAFT programmes',
      );
    }

    const previousMemberId = slot.member?.id ?? null;
    const previousBackupMemberId = slot.backupMember?.id ?? null;

    if (dto.memberId !== undefined) {
      slot.member = dto.memberId
        ? await this.memberRepo.findOne({ where: { id: dto.memberId } })
        : null;
    }
    if (dto.backupMemberId !== undefined) {
      slot.backupMember = dto.backupMemberId
        ? await this.memberRepo.findOne({ where: { id: dto.backupMemberId } })
        : null;
    }

    this.applySlotFields(slot, dto);

    const saved = await this.slotRepo.save(slot);
    this.logger.log(`Slot ${slotId} updated on programme ${programmeId}`);

    const isNewAssignment =
      dto.memberId !== undefined &&
      saved.member &&
      saved.member.id !== previousMemberId;

    if (isNewAssignment) {
      this.notifySlotAssignment(saved.member, slot.programme, saved);
    }

    const isNewBackupAssignment =
      dto.backupMemberId !== undefined &&
      saved.backupMember &&
      saved.backupMember.id !== previousBackupMemberId;

    if (isNewBackupAssignment) {
      this.notifySlotAssignment(
        saved.backupMember,
        slot.programme,
        saved,
        true,
      );
    }

    const conflictWarning = isNewAssignment
      ? await this.findMemberConflictWarning(saved.member, slot.programme)
      : undefined;

    const result = withMemberNames(saved);
    return conflictWarning ? { ...result, conflictWarning } : result;
  }

  private applySlotFields(
    slot: ServiceProgrammeSlot,
    dto: UpdateServiceProgrammeSlotDto,
  ): void {
    if (dto.type !== undefined) slot.type = dto.type;
    if (dto.topic !== undefined) slot.topic = dto.topic ?? null;
    if (dto.guestName !== undefined) slot.guestName = dto.guestName ?? null;
    if (dto.backupGuestName !== undefined)
      slot.backupGuestName = dto.backupGuestName ?? null;
    if (dto.allocatedMinutes !== undefined)
      slot.allocatedMinutes = dto.allocatedMinutes;
  }

  // Non-blocking check: does this member already have a slot in a different
  // programme whose service time overlaps this one? Same-programme double
  // duty (e.g. worship lead + offering) is intentionally not flagged.
  private async findMemberConflictWarning(
    member: Member,
    programme: ServiceProgramme,
  ): Promise<string | undefined> {
    if (!programme.serviceSlot) return undefined;

    const conflict = await this.slotRepo
      .createQueryBuilder('slot')
      .innerJoinAndSelect('slot.programme', 'conflictProgramme')
      .innerJoinAndSelect(
        'conflictProgramme.serviceSlot',
        'conflictServiceSlot',
      )
      .leftJoinAndSelect('conflictServiceSlot.event', 'conflictEvent')
      .where('slot.member_id = :memberId', { memberId: member.id })
      .andWhere('conflictProgramme.id != :programmeId', {
        programmeId: programme.id,
      })
      .andWhere('conflictServiceSlot.start_time < :endTime', {
        endTime: programme.serviceSlot.endTime,
      })
      .andWhere('conflictServiceSlot.end_time > :startTime', {
        startTime: programme.serviceSlot.startTime,
      })
      .getOne();

    if (!conflict) return undefined;

    const conflictSlotName = [
      conflict.programme?.serviceSlot?.event?.name,
      conflict.programme?.serviceSlot?.name,
    ]
      .filter(Boolean)
      .join(' — ');
    const suffix = conflictSlotName ? `: ${conflictSlotName}` : '';
    return `${member.firstname} ${member.lastname} is already assigned to an overlapping service${suffix}.`;
  }

  private fmtAssignmentDate(date: Date): string {
    return new Date(date).toLocaleDateString('en-GB', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }

  private fmtAssignmentTime(date: Date): string {
    return new Date(date).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  }

  // Fire-and-forget notification when a member is assigned a service-programme
  // slot — both an email (guests, no member record, never reach here) and a
  // push notification, since a member may have one channel but not the other
  // (no email on file, or never granted push permission) and neither should
  // block the other.
  private notifySlotAssignment(
    member: Member,
    programme: ServiceProgramme,
    slot: ServiceProgrammeSlot,
    isBackup = false,
  ): void {
    const serviceSlotName = programme.serviceSlot
      ? [programme.serviceSlot.event?.name, programme.serviceSlot.name]
          .filter(Boolean)
          .join(' — ')
      : 'the service';
    const slotType = ServiceSlotTypeLabels[slot.type] ?? slot.type;

    const subject = isBackup
      ? `You're the Backup for: ${serviceSlotName}`
      : `You've Been Added to the Programme: ${serviceSlotName}`;

    const serviceDate = programme.serviceSlot?.startTime
      ? this.fmtAssignmentDate(programme.serviceSlot.startTime)
      : '';
    const serviceTime =
      programme.serviceSlot?.startTime && programme.serviceSlot?.endTime
        ? `${this.fmtAssignmentTime(programme.serviceSlot.startTime)} – ${this.fmtAssignmentTime(programme.serviceSlot.endTime)}`
        : '';

    const templateData = {
      memberName: member.firstname,
      serviceSlotName,
      slotType,
      topic: slot.topic ?? '',
      allocatedMinutes: slot.allocatedMinutes,
      isBackup,
      serviceDate,
      serviceTime,
    };

    let email: NotifyMemberEmail | undefined;
    if (member.email) {
      if (programme.serviceSlot?.startTime && programme.serviceSlot?.endTime) {
        const topicSuffix = slot.topic ? `: ${slot.topic}` : '';
        const ics = buildIcsEvent({
          uid: `${slot.id}@service-programme`,
          startTime: programme.serviceSlot.startTime,
          endTime: programme.serviceSlot.endTime,
          summary: `${slotType}${topicSuffix} — ${serviceSlotName}`,
          description: `You're assigned to ${slotType} for ${serviceSlotName}.`,
        });
        email = {
          to: member.email,
          subject,
          template: 'service-slot-assigned',
          data: templateData,
          attachments: [{ filename: 'service-slot.ics', content: ics }],
        };
      } else {
        email = {
          to: member.email,
          subject,
          template: 'service-slot-assigned',
          data: templateData,
        };
      }
    }

    let pushBody = `${slotType} — ${serviceSlotName}`;
    if (serviceDate) pushBody += ` on ${serviceDate}`;
    if (serviceDate && serviceTime) pushBody += ` at ${serviceTime}`;

    this.notificationDispatchService.notifyMember({
      category: EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
      email,
      push: {
        memberIds: [member.id],
        title: subject,
        body: pushBody,
        url: '/events',
        idempotencyKey: `service-slot-assigned:${slot.id}:${member.id}`,
      },
    });
  }

  async reorderSlots(
    programmeId: string,
    dto: ReorderProgrammeSlotsDto,
  ): Promise<ServiceProgrammeSlot[]> {
    const programme = await this.programmeRepo.findOne({
      where: { id: programmeId },
      relations: ['slots'],
    });
    if (!programme) throw new NotFoundException('Programme not found');
    if (programme.status !== ServiceProgrammeStatusEnum.DRAFT) {
      throw new BadRequestException(
        'Slots can only be reordered on DRAFT programmes',
      );
    }

    const slotMap = new Map(programme.slots.map((s) => [s.id, s]));
    const orderedIds = dto.slots.map((s) => s.id);
    if (
      orderedIds.some((id) => !slotMap.has(id)) ||
      orderedIds.length !== programme.slots.length
    ) {
      throw new BadRequestException(
        'Slot list must contain exactly the existing slot IDs',
      );
    }

    const updated = orderedIds.map((id, index) => {
      const slot = slotMap.get(id);
      slot.position = index;
      return slot;
    });
    return this.slotRepo.save(updated);
  }

  async removeSlot(programmeId: string, slotId: string): Promise<void> {
    const slot = await this.slotRepo.findOne({
      where: { id: slotId, programme: { id: programmeId } },
      relations: ['programme'],
    });
    if (!slot) throw new NotFoundException('Slot not found');
    if (slot.programme.status !== ServiceProgrammeStatusEnum.DRAFT) {
      throw new BadRequestException(
        'Slots can only be removed from DRAFT programmes',
      );
    }
    await this.slotRepo.remove(slot);
    this.logger.log(`Slot ${slotId} removed from programme ${programmeId}`);
  }

  async applyTemplate(
    programmeId: string,
    templateId: string,
  ): Promise<ServiceProgramme> {
    const programme = await this.programmeRepo.findOne({
      where: { id: programmeId },
      relations: ['slots'],
    });
    if (!programme) throw new NotFoundException('Programme not found');
    if (programme.status !== ServiceProgrammeStatusEnum.DRAFT) {
      throw new BadRequestException(
        'Templates can only be applied to DRAFT programmes',
      );
    }

    const template = await this.templateRepo.findOne({
      where: { id: templateId },
    });
    if (!template) throw new NotFoundException('Template not found');

    // this.txHost.tx, not this.dataSource.transaction() — see
    // JournalEntryService for the full rationale.
    const manager = this.txHost.tx;
    if (programme.slots.length > 0) {
      await manager.remove(ServiceProgrammeSlot, programme.slots);
    }
    const newSlots = template.slots.map((s) =>
      manager.create(ServiceProgrammeSlot, {
        programme,
        position: s.position,
        type: s.type,
        topic: s.topic,
        allocatedMinutes: s.allocatedMinutes,
      }),
    );
    programme.slots = await manager.save(ServiceProgrammeSlot, newSlots);
    const result = await manager.save(ServiceProgramme, programme);
    this.logger.log(
      `Template ${templateId} applied to programme ${programmeId} (${result.slots.length} slots)`,
    );
    return result;
  }

  async findAllTemplates(): Promise<ServiceProgrammeTemplate[]> {
    return this.templateRepo.find({ order: { name: 'ASC' } });
  }

  async removeTemplate(id: string): Promise<void> {
    const template = await this.templateRepo.findOne({ where: { id } });
    if (!template) throw new NotFoundException('Template not found');
    await this.templateRepo.remove(template);
    this.logger.log(`Template ${id} deleted`);
  }

  async downloadPdf(id: string): Promise<Buffer> {
    const programme = await this.programmeRepo.findOne({
      where: { id },
      relations: [
        'serviceSlot',
        'serviceSlot.event',
        'slots',
        'slots.member',
        'slots.backupMember',
      ],
      order: { slots: { position: 'ASC' } },
    });
    if (!programme) throw new NotFoundException('Programme not found');
    return this.pdfService.generateProgrammeDraft(programme);
  }

  async downloadEventPdf(
    eventId: string,
  ): Promise<{ buffer: Buffer; eventName: string }> {
    const slots = await this.serviceSlotRepo.find({
      where: { event: { id: eventId } },
      relations: ['event'],
      order: { startTime: 'ASC' },
    });
    if (!slots.length)
      throw new NotFoundException('Event not found or has no service slots');

    const programmes = await this.programmeRepo.find({
      where: slots.map((s) => ({ serviceSlot: { id: s.id } })),
      relations: ['serviceSlot', 'slots', 'slots.member', 'slots.backupMember'],
      order: { slots: { position: 'ASC' } },
    });

    const programmeBySlotId = new Map(
      programmes.map((p) => [p.serviceSlot.id, p]),
    );

    const sections = slots.map((s) => ({
      slot: s,
      programme: programmeBySlotId.get(s.id) ?? null,
    }));

    const event = slots[0].event;
    const buffer = await this.pdfService.generateEventProgramme(
      event,
      sections,
    );
    return { buffer, eventName: event.name };
  }

  async upsertTemplateFromProgramme(
    programme: ServiceProgramme,
  ): Promise<void> {
    const slotName = (programme as any).serviceSlot?.name ?? 'Service';
    const slots: TemplateProgrammeSlot[] = [...programme.slots]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        position: s.position,
        type: s.type,
        topic: s.topic,
        allocatedMinutes: s.allocatedMinutes,
      }));

    const existing = await this.templateRepo.findOne({
      where: { serviceSlotName: slotName },
    });
    if (existing) {
      existing.slots = slots;
      existing.createdFrom = programme;
      await this.templateRepo.save(existing);
      this.logger.log(
        `Template "${slotName}" updated from programme ${programme.id}`,
      );
    } else {
      const template = this.templateRepo.create({
        name: slotName,
        serviceSlotName: slotName,
        slots,
        createdFrom: programme,
      });
      await this.templateRepo.save(template);
      this.logger.log(
        `Template "${slotName}" created from programme ${programme.id}`,
      );
    }
  }

  // Every DRAFT programme under the event that actually has slots to run,
  // ordered by service slot start time — "Start Service" starts only the
  // earliest one (First Service before Second Service) and calling it again
  // once that slot ends picks up the next one in sequence.
  async findStartableDraftProgrammesForEvent(
    eventId: string,
  ): Promise<ServiceProgramme[]> {
    const slots = await this.serviceSlotRepo.find({
      where: { event: { id: eventId } },
    });
    if (!slots.length) {
      throw new NotFoundException('Event not found or has no service slots');
    }

    const programmes = await this.programmeRepo.find({
      where: { serviceSlot: { id: In(slots.map((s) => s.id)) } },
      relations: ['slots', 'serviceSlot'],
    });

    return programmes
      .filter(
        (p) =>
          p.status === ServiceProgrammeStatusEnum.DRAFT &&
          p.slots &&
          p.slots.length > 0,
      )
      .sort(
        (a, b) =>
          a.serviceSlot.startTime.getTime() - b.serviceSlot.startTime.getTime(),
      );
  }

  async assertProgrammeIsDraft(id: string): Promise<ServiceProgramme> {
    const programme = await this.programmeRepo.findOne({
      where: { id },
      relations: ['slots', 'slots.member', 'slots.backupMember', 'serviceSlot'],
    });
    if (!programme) throw new NotFoundException('Programme not found');
    if (programme.status !== ServiceProgrammeStatusEnum.DRAFT) {
      throw new ForbiddenException('Programme is not in DRAFT status');
    }
    return programme;
  }

  async setProgrammeStatus(
    id: string,
    status: ServiceProgrammeStatusEnum,
  ): Promise<void> {
    await this.programmeRepo.update(id, { status });
  }
}
