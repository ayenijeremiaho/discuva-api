import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Outreach } from '../entity/outreach.entity';
import { Member } from '../../member/entity/member.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { WorkerStatusEnum } from '../../member/enums/worker-status.enum';
import { DepartmentCapability } from '../../department/enums/department-capability.enum';
import { CreateOutreachDto } from '../dto/convert.dto';
import { DateService } from '../../utility/service/date.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { CacheService } from '../../utility/service/cache.service';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';

export const EVANGELISM_REPORT_NAMESPACE = 'evangelism:report';
const RECENT_DAYS = 14;
const SEARCH_LIMIT = 20;

export interface PersonSummary {
  id: string;
  firstname: string;
  lastname: string;
}

export interface EvangelismWorkerOption {
  memberId: string;
  workerProfileId: string;
  firstname: string;
  lastname: string;
  isEvangelism: boolean;
  openAssigned: number;
}

export interface Actor {
  memberId: string;
  name: string;
}

export const toPersonSummary = (m: Member): PersonSummary => ({
  id: m.id,
  firstname: m.firstname,
  lastname: m.lastname,
});

export const outreachLabel = (o: Pick<Outreach, 'title' | 'outreachDate'>) =>
  o.title
    ? `${o.title} (${o.outreachDate})`
    : `the outreach on ${o.outreachDate}`;

@Injectable()
export class OutreachService {
  constructor(
    @InjectRepository(Outreach)
    private readonly outreachRepo: Repository<Outreach>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    @InjectRepository(WorkerProfile)
    private readonly workerProfileRepo: Repository<WorkerProfile>,
    private readonly dateService: DateService,
    private readonly auditLogService: AuditLogService,
    private readonly cacheService: CacheService,
    private readonly notificationDispatchService: NotificationDispatchService,
  ) {}

  async create(dto: CreateOutreachDto, creator: Member): Promise<Outreach> {
    const others = await this.resolveTeam(dto.teamMemberIds, creator.id);
    const outreach = await this.outreachRepo.save(
      this.outreachRepo.create({
        title: dto.title?.trim() || null,
        location: dto.location?.trim() || null,
        outreachDate: dto.date?.slice(0, 10) ?? this.dateService.today(),
        createdBy: { id: creator.id } as Member,
        createdByName: `${creator.firstname} ${creator.lastname}`,
        team: [creator, ...others],
      }),
    );

    this.auditLogService.log('OUTREACH_CREATED', {
      actorId: creator.id,
      targetId: outreach.id,
      targetName: outreach.title ?? outreach.outreachDate,
      metadata: { teamMemberIds: outreach.team!.map((m) => m.id) },
    });
    this.cacheService.flushNamespace(EVANGELISM_REPORT_NAMESPACE);
    this.notifyAddedToTeam(
      outreach,
      others.map((m) => m.id),
      outreach.createdByName,
    );

    return this.slim(outreach);
  }

  async getRecentForMember(memberId: string): Promise<Outreach[]> {
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const ids = await this.outreachRepo
      .createQueryBuilder('o')
      .innerJoin('o.team', 'tm', 'tm.id = :memberId', { memberId })
      .select('o.id', 'id')
      .where('o.outreach_date >= :since', { since })
      .getRawMany<{ id: string }>();
    if (!ids.length) return [];
    const outreaches = await this.outreachRepo.find({
      where: { id: In(ids.map((r) => r.id)) },
      relations: ['team'],
      order: { outreachDate: 'DESC', createdAt: 'DESC' },
    });
    return outreaches.map((o) => this.slim(o));
  }

  async listForAdmin(from?: string, to?: string): Promise<Outreach[]> {
    const qb = this.outreachRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.team', 'tm')
      .orderBy('o.outreach_date', 'DESC')
      .addOrderBy('o.created_at', 'DESC')
      .take(200);
    if (from) qb.andWhere('o.outreach_date >= :from', { from });
    if (to) qb.andWhere('o.outreach_date <= :to', { to });
    const outreaches = await qb.getMany();
    return outreaches.map((o) => this.slim(o));
  }

  async updateTeam(
    outreachId: string,
    teamMemberIds: string[],
    actor: Actor,
    { asAdmin }: { asAdmin: boolean },
  ): Promise<Outreach> {
    const outreach = await this.outreachRepo.findOne({
      where: { id: outreachId },
      relations: ['team', 'createdBy'],
    });
    if (!outreach) throw new NotFoundException('Outreach not found');

    const currentIds = new Set((outreach.team ?? []).map((m) => m.id));
    if (!asAdmin && !currentIds.has(actor.memberId)) {
      throw new ForbiddenException(
        'Only members of this outreach team can change it',
      );
    }

    // The creator always stays on the team so their converts stay visible to them.
    const creatorId = outreach.createdBy?.id;
    const others = await this.resolveTeam(teamMemberIds, creatorId);
    const creator = creatorId
      ? (outreach.team ?? []).find((m) => m.id === creatorId)
      : undefined;
    outreach.team = creator ? [creator, ...others] : others;
    const saved = await this.outreachRepo.save(outreach);

    const added = others
      .map((m) => m.id)
      .filter((id) => !currentIds.has(id) && id !== actor.memberId);

    this.auditLogService.log('OUTREACH_TEAM_UPDATED', {
      actorId: actor.memberId,
      targetId: outreach.id,
      targetName: outreach.title ?? outreach.outreachDate,
      metadata: { teamMemberIds: saved.team!.map((m) => m.id), asAdmin },
    });
    this.cacheService.flushNamespace(EVANGELISM_REPORT_NAMESPACE);
    this.notifyAddedToTeam(saved, added, actor.name);

    return this.slim(saved);
  }

  async findTeamMemberIds(outreachId: string): Promise<string[] | null> {
    const outreach = await this.outreachRepo.findOne({
      where: { id: outreachId },
      relations: ['team'],
    });
    if (!outreach) return null;
    return (outreach.team ?? []).map((m) => m.id);
  }

  async exists(outreachId: string): Promise<boolean> {
    return this.outreachRepo.existsBy({ id: outreachId });
  }

  async searchWorkers(
    q?: string,
    excludeMemberId?: string,
  ): Promise<EvangelismWorkerOption[]> {
    const qb = this.workerProfileRepo
      .createQueryBuilder('wp')
      .innerJoin('wp.member', 'm')
      .leftJoin('wp.department', 'd')
      .leftJoin('wp.secondaryDepartment', 'sd')
      .select('m.id', 'memberId')
      .addSelect('wp.id', 'workerProfileId')
      .addSelect('m.firstname', 'firstname')
      .addSelect('m.lastname', 'lastname')
      .addSelect(
        'COALESCE(:cap = ANY(d.capabilities), false) OR COALESCE(:cap = ANY(sd.capabilities), false)',
        'isEvangelism',
      )
      .addSelect(
        '(SELECT COUNT(*) FROM converts c WHERE c.assigned_to = wp.id AND c.member_id IS NULL AND c.first_timer_id IS NULL)',
        'openAssigned',
      )
      .where('wp.status = :wpStatus', { wpStatus: WorkerStatusEnum.ACTIVE })
      .andWhere('m.status = :mStatus', { mStatus: MemberStatusEnum.ACTIVE })
      .andWhere('m.role = :role', { role: MemberRoleEnum.WORKER })
      .setParameter('cap', DepartmentCapability.MANAGE_EVANGELISM_CONVERTS)
      .orderBy('"isEvangelism"', 'DESC')
      .addOrderBy('m.firstname', 'ASC')
      .addOrderBy('m.lastname', 'ASC')
      .limit(SEARCH_LIMIT);

    const term = q?.trim();
    if (term) {
      qb.andWhere(
        "(m.firstname ILIKE :term OR m.lastname ILIKE :term OR (m.firstname || ' ' || m.lastname) ILIKE :term)",
        { term: `%${term}%` },
      );
    }
    if (excludeMemberId) {
      qb.andWhere('m.id != :exclude', { exclude: excludeMemberId });
    }

    const rows = await qb.getRawMany<{
      memberId: string;
      workerProfileId: string;
      firstname: string;
      lastname: string;
      isEvangelism: boolean;
      openAssigned: string;
    }>();
    return rows.map((r) => ({
      ...r,
      isEvangelism: !!r.isEvangelism,
      openAssigned: Number(r.openAssigned),
    }));
  }

  // Active workers only; drops duplicates and `excludeId` (the creator, kept separately).
  private async resolveTeam(
    memberIds: string[],
    excludeId?: string,
  ): Promise<Member[]> {
    const ids = [...new Set(memberIds)].filter((id) => id !== excludeId);
    if (!ids.length) return [];

    const members = await this.memberRepo.find({
      where: {
        id: In(ids),
        role: MemberRoleEnum.WORKER,
        status: MemberStatusEnum.ACTIVE,
      },
      select: { id: true, firstname: true, lastname: true },
    });
    if (members.length !== ids.length) {
      throw new BadRequestException(
        'Every outreach team member must be an active worker',
      );
    }
    return members;
  }

  private notifyAddedToTeam(
    outreach: Outreach,
    memberIds: string[],
    actorName: string,
  ): void {
    if (!memberIds.length) return;
    this.notificationDispatchService.notifyMember({
      category: EmailCategory.EVANGELISM,
      push: {
        memberIds,
        key: PushNotificationKey.OUTREACH_TEAM_ADDED,
        vars: {
          creator_name: actorName,
          outreach_label: outreachLabel(outreach),
        },
        idempotencyKey: `outreach-team-added:${outreach.id}:${Date.now()}`,
      },
    });
  }

  private slim(outreach: Outreach): Outreach {
    const { createdBy, ...rest } = outreach;
    return {
      ...rest,
      createdById: outreach.createdById ?? createdBy?.id ?? null,
      team: (outreach.team ?? []).map(toPersonSummary),
    } as Outreach;
  }
}
