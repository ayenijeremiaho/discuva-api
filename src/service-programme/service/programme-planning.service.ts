import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { ServiceProgramme } from '../entity/service-programme.entity';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { Member } from '../../member/entity/member.entity';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { Department } from '../../department/entity/department.entity';
import { DepartmentCapability } from '../../department/enums/department-capability.enum';
import { DepartmentAccessService } from '../../department/service/department-access.service';
import { Admin } from '../../admin/entity/admin.entity';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { MeetingFormatEnum } from '../../utility/enum/meeting-format.enum';
import { DateService } from '../../utility/service/date.service';
import {
  AuditAction,
  AuditLogService,
} from '../../utility/service/audit-log.service';
import {
  ServiceProgrammeService,
  ServiceProgrammeWithSummary,
} from './service-programme.service';
import { CreateServiceProgrammeSlotDto } from '../dto/create-service-programme-slot.dto';
import { CreatePlannedProgrammeDto } from '../dto/create-planned-programme.dto';

const DEFAULT_DAYS_AHEAD = 60;
const MAX_SERVICES = 200;
const PEOPLE_LIMIT = 8;

export interface PlanningService {
  serviceSlotId: string;
  name: string;
  startTime: Date;
  endTime: Date;
  place: string | null;
  programme: {
    id: string;
    status: string;
    itemCount: number;
    totalMinutes: number;
  } | null;
}

// Who leads an item, by name only: planners don't need members' contact details.
export interface PlanningPerson {
  kind: 'member' | 'guest' | 'department';
  id: string | null;
  name: string;
}

export interface PlanningItem {
  id: string;
  position: number;
  type: string;
  topic: string | null;
  allocatedMinutes: number;
  leader: PlanningPerson | null;
  backup: PlanningPerson | null;
}

export interface PlanningProgramme {
  id: string;
  status: string;
  event: { id: string; name: string; eventDate: Date } | null;
  service: { id: string; name: string; startTime: Date; endTime: Date } | null;
  items: PlanningItem[];
  totalMinutes: number;
  // Set when the API flags something about the last change (e.g. a clash).
  warning?: string;
}

export interface PlanningEvent {
  eventId: string;
  name: string;
  eventDate: Date;
  services: PlanningService[];
}

// Building orders of service from the member app. The editing itself is ServiceProgrammeService's, so everything
// the admin app does (notifications, reminders, department assignments) happens the same way.
@Injectable()
export class ProgrammePlanningService {
  constructor(
    @InjectRepository(ServiceSlot)
    private readonly serviceSlotRepo: Repository<ServiceSlot>,
    @InjectRepository(ServiceProgramme)
    private readonly programmeRepo: Repository<ServiceProgramme>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    @InjectRepository(Department)
    private readonly departmentRepo: Repository<Department>,
    @InjectRepository(Admin)
    private readonly adminRepo: Repository<Admin>,
    private readonly departmentAccess: DepartmentAccessService,
    private readonly dateService: DateService,
    private readonly programmes: ServiceProgrammeService,
    private readonly auditLog: AuditLogService,
  ) {}

  // Every planner change is in the audit log, named by its service ("Sunday Service — First Service").
  audit(
    action: AuditAction,
    actorId: string,
    target: { id: string; name?: string },
    metadata: Record<string, unknown> = {},
  ): void {
    this.auditLog.log(action, {
      actorId,
      targetId: target.id,
      targetName: target.name,
      metadata: { via: 'member_app', ...metadata },
    });
  }

  static nameOf(
    programme: Pick<PlanningProgramme, 'id' | 'event' | 'service'>,
  ): { id: string; name?: string } {
    const name = [programme.event?.name, programme.service?.name]
      .filter(Boolean)
      .join(' — ');
    return { id: programme.id, name: name || undefined };
  }

  // Admins with programme edit access, or workers in a department with Service Programme Planning.
  async canPlan(memberId: string): Promise<boolean> {
    if (await this.programmeAdmin(memberId)) return true;
    return this.departmentAccess.hasCapability(
      memberId,
      DepartmentCapability.PLAN_SERVICE_PROGRAMME,
    );
  }

  // Services that haven't ended yet, grouped by event, each with its programme's state.
  async upcoming(days = DEFAULT_DAYS_AHEAD): Promise<PlanningEvent[]> {
    const now = this.dateService.now();
    const slots = await this.serviceSlotRepo.find({
      where: {
        endTime: MoreThanOrEqual(now),
        startTime: LessThan(this.dateService.addDays(now, days)),
      },
      relations: {
        event: true,
        venueOverride: true,
        config: { defaultVenue: true },
      },
      order: { startTime: 'ASC' },
      take: MAX_SERVICES,
    });
    if (!slots.length) return [];

    const programmes = await this.programmeRepo.find({
      where: { serviceSlot: { id: In(slots.map((s) => s.id)) } },
      relations: { serviceSlot: true, slots: true },
    });
    const programmeBySlot = new Map(
      programmes.map((p) => [p.serviceSlot.id, p]),
    );

    const events = new Map<string, PlanningEvent>();
    for (const slot of slots) {
      const event =
        events.get(slot.event.id) ??
        events
          .set(slot.event.id, {
            eventId: slot.event.id,
            name: slot.event.name,
            eventDate: slot.event.eventDate,
            services: [],
          })
          .get(slot.event.id)!;
      const programme = programmeBySlot.get(slot.id);
      event.services.push({
        serviceSlotId: slot.id,
        name: slot.name,
        startTime: slot.startTime,
        endTime: slot.endTime,
        place:
          (slot.formatOverride ?? slot.config?.defaultFormat) ===
          MeetingFormatEnum.ONLINE
            ? 'Online'
            : ((slot.venueOverride ?? slot.config?.defaultVenue)?.name ?? null),
        programme: programme
          ? {
              id: programme.id,
              status: programme.status,
              itemCount: programme.slots.length,
              totalMinutes: programme.slots.reduce(
                (sum, s) => sum + s.allocatedMinutes,
                0,
              ),
            }
          : null,
      });
    }
    return [...events.values()];
  }

  // A new draft for one service: empty, from a template, or copying another programme's order.
  async create(
    memberId: string,
    dto: CreatePlannedProgrammeDto,
  ): Promise<PlanningProgramme> {
    if (dto.templateId && dto.copyFromProgrammeId)
      throw new BadRequestException(
        'Choose a template or a programme to copy, not both.',
      );
    const slots = dto.copyFromProgrammeId
      ? await this.itemsOf(dto.copyFromProgrammeId)
      : [];
    const created = await this.programmes.create(
      { programmes: [{ serviceSlotId: dto.serviceSlotId, slots }] },
      await this.programmeAdmin(memberId),
    );
    const programme = Array.isArray(created) ? created[0] : created;
    if (dto.templateId)
      await this.programmes.applyTemplate(programme.id, dto.templateId);
    return this.view(programme.id);
  }

  async view(id: string, warning?: string): Promise<PlanningProgramme> {
    const p = await this.programmes.findOne(id);
    const person = (
      member:
        { id: string; firstname: string; lastname: string } | null | undefined,
      guestName: string | null | undefined,
      department: { id: string; name: string } | null | undefined,
    ): PlanningPerson | null => {
      if (department)
        return { kind: 'department', id: department.id, name: department.name };
      if (member)
        return {
          kind: 'member',
          id: member.id,
          name: [member.firstname, member.lastname].filter(Boolean).join(' '),
        };
      return guestName ? { kind: 'guest', id: null, name: guestName } : null;
    };
    const items = (p.slots ?? []).map((s) => ({
      id: s.id,
      position: s.position,
      type: s.type,
      topic: s.topic,
      allocatedMinutes: s.allocatedMinutes,
      leader: person(s.member, s.guestName, s.department),
      backup: person(s.backupMember, s.backupGuestName, s.backupDepartment),
    }));
    return {
      id: p.id,
      status: p.status,
      event: p.event ?? null,
      service: p.serviceSlotDetail
        ? {
            id: p.serviceSlotDetail.id,
            name: p.serviceSlotDetail.name,
            startTime: p.serviceSlotDetail.startTime,
            endTime: p.serviceSlotDetail.endTime,
          }
        : null,
      items,
      totalMinutes: items.reduce((sum, i) => sum + i.allocatedMinutes, 0),
      ...(warning && { warning }),
    };
  }

  // Members (by name) and departments for "who leads this item".
  async people(query: string): Promise<{
    members: { id: string; name: string; photoUrl: string | null }[];
    departments: { id: string; name: string }[];
  }> {
    const term = query.trim();
    const departments = await this.departmentRepo.find({
      select: { id: true, name: true },
      order: { name: 'ASC' },
    });
    const matchingDepartments = term
      ? departments.filter((d) =>
          d.name.toLowerCase().includes(term.toLowerCase()),
        )
      : departments;
    if (term.length < 2)
      return {
        members: [],
        departments: matchingDepartments.slice(0, PEOPLE_LIMIT),
      };

    // Each word must match a first or last name, so the name trigram indexes stay usable.
    const words = term.split(/\s+/).slice(0, 3);
    const qb = this.memberRepo
      .createQueryBuilder('m')
      .select(['m.id', 'm.firstname', 'm.lastname', 'm.photoUrl'])
      .where('m.status != :inactive', { inactive: MemberStatusEnum.INACTIVE });
    words.forEach((word, i) => {
      const like = `%${word.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      qb.andWhere(
        new Brackets((b) =>
          b
            .where(`m.firstname ILIKE :w${i}`, { [`w${i}`]: like })
            .orWhere(`m.lastname ILIKE :w${i}`, { [`w${i}`]: like }),
        ),
      );
    });
    const members = await qb
      .orderBy('m.firstname', 'ASC')
      .limit(PEOPLE_LIMIT)
      .getMany();
    return {
      members: members.map((m) => ({
        id: m.id,
        name: [m.firstname, m.lastname].filter(Boolean).join(' '),
        photoUrl: m.photoUrl ?? null,
      })),
      departments: matchingDepartments.slice(0, PEOPLE_LIMIT),
    };
  }

  private async programmeAdmin(memberId: string): Promise<Admin | null> {
    const admin = await this.adminRepo.findOne({
      where: { member: { id: memberId }, isActive: true },
      relations: ['adminRole'],
    });
    return admin?.adminRole.permissions.includes(
      AdminPermission.SERVICE_PROGRAMME_WRITE,
    )
      ? admin
      : null;
  }

  private async itemsOf(
    programmeId: string,
  ): Promise<CreateServiceProgrammeSlotDto[]> {
    const source = await this.programmeRepo.findOne({
      where: { id: programmeId },
      relations: {
        slots: {
          member: true,
          department: true,
          backupMember: true,
          backupDepartment: true,
        },
      },
      order: { slots: { position: 'ASC' } },
    });
    if (!source) throw new NotFoundException('Programme to copy not found');
    return source.slots.map((s) => ({
      type: s.type,
      topic: s.topic ?? undefined,
      memberId: s.member?.id,
      guestName: s.guestName ?? undefined,
      departmentId: s.department?.id ?? null,
      backupMemberId: s.backupMember?.id,
      backupGuestName: s.backupGuestName ?? undefined,
      backupDepartmentId: s.backupDepartment?.id ?? null,
      allocatedMinutes: s.allocatedMinutes,
    }));
  }
}
