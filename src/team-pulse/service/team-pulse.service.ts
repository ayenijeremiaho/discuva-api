import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { randomUUID } from 'node:crypto';
import { TeamPulse } from '../entity/team-pulse.entity';
import { RatingTally, TeamPulseRound } from '../entity/team-pulse-round.entity';
import { TeamPulseParticipation } from '../entity/team-pulse-participation.entity';
import { Department } from '../../department/entity/department.entity';
import { DepartmentLead } from '../../department/entity/department-lead.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { Member } from '../../member/entity/member.entity';
import { Clergy } from '../../member/entity/clergy.entity';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { WorkerStatusEnum } from '../../member/enums/worker-status.enum';
import {
  TeamPulseFrequencyEnum,
  TeamPulseQuestionKindEnum,
} from '../enum/team-pulse.enum';
import {
  MAX_COMMENT_LENGTH,
  MIN_RESPONSES_TO_SHOW,
  TEAM_PULSE_TEMPLATES,
  TREND_ROUNDS,
} from '../constant/team-pulse.constant';
import {
  CreateTeamPulseDto,
  RespondTeamPulseDto,
  UpdateTeamPulseDto,
} from '../dto/team-pulse.dto';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { DateService } from '../../utility/service/date.service';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';

const DAY_MS = 24 * 3600 * 1000;
const REMIND_AGAIN_AFTER_MS = 12 * 3600 * 1000;

type Access = 'lead' | 'pastor' | 'member';

export function nextOpening(
  from: Date,
  frequency: TeamPulseFrequencyEnum,
): Date | null {
  const next = new Date(from);
  if (frequency === TeamPulseFrequencyEnum.WEEKLY)
    next.setUTCDate(next.getUTCDate() + 7);
  else if (frequency === TeamPulseFrequencyEnum.FORTNIGHTLY)
    next.setUTCDate(next.getUTCDate() + 14);
  else if (frequency === TeamPulseFrequencyEnum.MONTHLY)
    next.setUTCMonth(next.getUTCMonth() + 1);
  else return null;
  return next;
}

// Mean of every rating answer in a round, or null when too few answered to show.
export function roundScore(round: TeamPulseRound): number | null {
  if (round.responseCount < MIN_RESPONSES_TO_SHOW) return null;
  let sum = 0;
  let count = 0;
  for (const t of Object.values(round.ratings ?? {})) {
    sum += t.sum;
    count += t.count;
  }
  return count ? Math.round((sum / count) * 10) / 10 : null;
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

@Injectable()
export class TeamPulseService {
  constructor(
    @InjectRepository(TeamPulse)
    private readonly pulseRepo: Repository<TeamPulse>,
    @InjectRepository(TeamPulseRound)
    private readonly roundRepo: Repository<TeamPulseRound>,
    @InjectRepository(TeamPulseParticipation)
    private readonly participationRepo: Repository<TeamPulseParticipation>,
    @InjectRepository(Department)
    private readonly departmentRepo: Repository<Department>,
    @InjectRepository(DepartmentLead)
    private readonly leadRepo: Repository<DepartmentLead>,
    @InjectRepository(WorkerProfile)
    private readonly workerRepo: Repository<WorkerProfile>,
    @InjectRepository(Clergy)
    private readonly clergyRepo: Repository<Clergy>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly notifications: NotificationDispatchService,
    private readonly audit: AuditLogService,
    private readonly dateService: DateService,
    private readonly churchTimezone: ChurchTimezoneService,
  ) {}

  templates() {
    return TEAM_PULSE_TEMPLATES;
  }

  // What the member can see and do: check-ins waiting for them, and the departments they belong to or lead.
  async mine(memberId: string, now = new Date()) {
    const [workerDepts, leadDepts, isPastor] = await Promise.all([
      this.workerDepartmentIds(memberId),
      this.leadDepartmentIds(memberId),
      this.isPastor(memberId),
    ]);
    const departmentIds = [...new Set([...workerDepts, ...leadDepts])];
    const departments = departmentIds.length
      ? await this.departmentRepo.find({
          where: { id: In(departmentIds) },
          select: { id: true, name: true },
          order: { name: 'ASC' },
        })
      : [];

    const open = workerDepts.length
      ? await this.roundRepo
          .createQueryBuilder('r')
          .innerJoinAndSelect('r.pulse', 'p')
          .innerJoinAndSelect('p.department', 'd')
          .where('p.department_id IN (:...workerDepts)', { workerDepts })
          .andWhere('r.opensAt <= :now AND r.closesAt > :now', { now })
          .andWhere(
            'NOT EXISTS (SELECT 1 FROM team_pulse_participations tp WHERE tp.round_id = r.id AND tp.member_id = :memberId)',
            { memberId },
          )
          .orderBy('r.closesAt', 'ASC')
          .getMany()
      : [];

    return {
      waiting: open.map((r) => ({
        roundId: r.id,
        title: r.pulse.title,
        department: {
          id: r.pulse.department.id,
          name: r.pulse.department.name,
        },
        required: r.pulse.required,
        closesAt: r.closesAt,
        questions: r.pulse.questions,
      })),
      departments: departments.map((d) => ({
        id: d.id,
        name: d.name,
        canManage: leadDepts.includes(d.id),
      })),
      isPastor,
    };
  }

  // Each pulse in a department with its recent rounds, oldest first, for trend lines.
  async forDepartment(
    memberId: string,
    departmentId: string,
    now = new Date(),
  ) {
    const access = await this.access(memberId, departmentId);
    const department = await this.departmentRepo.findOne({
      where: { id: departmentId },
      select: { id: true, name: true },
    });
    if (!department) throw new NotFoundException('Department not found');
    const pulses = await this.pulseRepo.find({
      where: { department: { id: departmentId } },
      order: { active: 'DESC', createdAt: 'DESC' },
    });
    const rounds = pulses.length
      ? await this.recentRounds(pulses.map((p) => p.id))
      : new Map<string, TeamPulseRound[]>();
    return {
      department,
      canManage: access === 'lead',
      pulses: pulses.map((p) => ({
        id: p.id,
        title: p.title,
        frequency: p.frequency,
        required: p.required,
        active: p.active,
        nextOpenAt: p.nextOpenAt,
        questions: p.questions,
        rounds: (rounds.get(p.id) ?? []).map((r) => ({
          id: r.id,
          opensAt: r.opensAt,
          closesAt: r.closesAt,
          open: r.opensAt <= now && r.closesAt > now,
          responseCount: r.responseCount,
          invitedCount: r.invitedCount,
          score: roundScore(r),
        })),
      })),
    };
  }

  // One round's results: per-question averages and unsigned comments, only once enough people have answered.
  async round(memberId: string, roundId: string, now = new Date()) {
    const round = await this.roundRepo.findOne({
      where: { id: roundId },
      relations: { pulse: { department: true } },
    });
    if (!round) throw new NotFoundException('Check-in not found');
    const access = await this.access(memberId, round.pulse.department.id);
    const visible = round.responseCount >= MIN_RESPONSES_TO_SHOW;
    const open = round.opensAt <= now && round.closesAt > now;

    // Leads see who still hasn't answered an open check-in (never what anyone said), to follow up.
    const notYet =
      access === 'lead' && open ? await this.notYetAnswered(round) : undefined;

    return {
      id: round.id,
      pulse: {
        id: round.pulse.id,
        title: round.pulse.title,
        required: round.pulse.required,
        department: {
          id: round.pulse.department.id,
          name: round.pulse.department.name,
        },
      },
      opensAt: round.opensAt,
      closesAt: round.closesAt,
      open,
      responseCount: round.responseCount,
      invitedCount: round.invitedCount,
      minimumToShow: MIN_RESPONSES_TO_SHOW,
      score: roundScore(round),
      questions: round.pulse.questions.map((q) => {
        if (!visible) return { ...q };
        if (q.kind === TeamPulseQuestionKindEnum.RATING) {
          const t = round.ratings?.[q.id];
          return {
            ...q,
            average: t?.count ? Math.round((t.sum / t.count) * 10) / 10 : null,
            answered: t?.count ?? 0,
            spread: t?.spread ?? [0, 0, 0, 0, 0],
          };
        }
        return { ...q, comments: shuffled(round.comments?.[q.id] ?? []) };
      }),
      notYetAnswered: notYet,
      canRemind:
        access === 'lead' &&
        open &&
        !!notYet?.length &&
        (!round.reminderSentAt ||
          now.getTime() - round.reminderSentAt.getTime() >=
            REMIND_AGAIN_AFTER_MS),
    };
  }

  async create(memberId: string, dto: CreateTeamPulseDto, now = new Date()) {
    await this.assertLead(memberId, dto.departmentId);
    if (!dto.questions.some((q) => q.kind === TeamPulseQuestionKindEnum.RATING))
      throw new BadRequestException(
        'Add at least one rating question, so the team can see its trend.',
      );
    const pulse = await this.pulseRepo.save(
      this.pulseRepo.create({
        department: { id: dto.departmentId } as Department,
        title: dto.title.trim(),
        questions: dto.questions.map((q) => ({
          id: randomUUID(),
          kind: q.kind,
          text: q.text.trim(),
        })),
        frequency: dto.frequency,
        responseWindowDays: dto.responseWindowDays ?? 3,
        required: dto.required ?? false,
        active: true,
        nextOpenAt: nextOpening(now, dto.frequency),
        createdBy: { id: memberId } as Member,
      }),
    );
    pulse.department = await this.departmentRepo.findOneOrFail({
      where: { id: dto.departmentId },
    });
    const round = await this.openRound(pulse, now);
    this.audit.log('TEAM_PULSE_STARTED', {
      actorId: memberId,
      targetId: pulse.id,
      targetName: pulse.title,
      metadata: {
        departmentId: dto.departmentId,
        frequency: pulse.frequency,
        required: pulse.required,
      },
    });
    return { id: pulse.id, roundId: round.id };
  }

  async update(
    memberId: string,
    pulseId: string,
    dto: UpdateTeamPulseDto,
    now = new Date(),
  ) {
    const pulse = await this.pulseRepo.findOne({
      where: { id: pulseId },
      relations: { department: true },
    });
    if (!pulse) throw new NotFoundException('Check-in not found');
    await this.assertLead(memberId, pulse.department.id);

    if (dto.required !== undefined) pulse.required = dto.required;
    if (dto.active === false && pulse.active) {
      pulse.active = false;
      pulse.nextOpenAt = null;
      // Stopping also closes any round still open, so nobody is asked to answer something that's been stopped.
      await this.roundRepo
        .createQueryBuilder()
        .update(TeamPulseRound)
        .set({ closesAt: now })
        .where('pulse_id = :pulseId AND closes_at > :now', { pulseId, now })
        .execute();
      this.audit.log('TEAM_PULSE_STOPPED', {
        actorId: memberId,
        targetId: pulse.id,
        targetName: pulse.title,
      });
    } else if (dto.active === true && !pulse.active) {
      pulse.active = true;
      pulse.nextOpenAt = nextOpening(now, pulse.frequency);
      await this.pulseRepo.save(pulse);
      await this.openRound(pulse, now);
      this.audit.log('TEAM_PULSE_RESUMED', {
        actorId: memberId,
        targetId: pulse.id,
        targetName: pulse.title,
      });
    }
    await this.pulseRepo.save(pulse);
    return this.forDepartment(memberId, pulse.department.id, now);
  }

  async respond(
    memberId: string,
    roundId: string,
    dto: RespondTeamPulseDto,
    now = new Date(),
  ) {
    const manager = this.txHost.tx;
    const owner = await manager
      .getRepository(TeamPulse)
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.department', 'd')
      .innerJoin('p.rounds', 'r', 'r.id = :roundId', { roundId })
      .getOne();
    if (!owner) throw new NotFoundException('Check-in not found');
    // Locked so two people answering at once can't overwrite each other's totals.
    const round = await manager
      .getRepository(TeamPulseRound)
      .createQueryBuilder('r')
      .where('r.id = :roundId', { roundId })
      .setLock('pessimistic_write')
      .getOneOrFail();
    if (round.opensAt > now || round.closesAt <= now)
      throw new BadRequestException('This check-in has closed.');
    if (
      !(await this.workerDepartmentIds(memberId)).includes(owner.department.id)
    )
      throw new ForbiddenException('This check-in is for another team.');
    if (
      await manager
        .getRepository(TeamPulseParticipation)
        .exists({ where: { round: { id: roundId }, member: { id: memberId } } })
    )
      throw new ConflictException("You've already answered this check-in.");

    const ratings: Record<string, RatingTally> = { ...(round.ratings ?? {}) };
    const comments: Record<string, string[]> = { ...(round.comments ?? {}) };
    let answeredAny = false;
    for (const q of owner.questions) {
      const value = dto.answers?.[q.id];
      if (value === undefined || value === null || value === '') continue;
      if (q.kind === TeamPulseQuestionKindEnum.RATING) {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > 5)
          throw new BadRequestException('Ratings go from 1 to 5.');
        const t = ratings[q.id] ?? {
          count: 0,
          sum: 0,
          spread: [0, 0, 0, 0, 0],
        };
        const spread = [...t.spread];
        spread[n - 1] += 1;
        ratings[q.id] = { count: t.count + 1, sum: t.sum + n, spread };
        answeredAny = true;
      } else {
        const text = String(value).trim().slice(0, MAX_COMMENT_LENGTH);
        if (!text) continue;
        comments[q.id] = [...(comments[q.id] ?? []), text];
        answeredAny = true;
      }
    }
    if (!answeredAny)
      throw new BadRequestException('Answer at least one question.');

    await manager.getRepository(TeamPulseParticipation).insert({
      round: { id: roundId } as TeamPulseRound,
      member: { id: memberId } as Member,
    });
    await manager.getRepository(TeamPulseRound).update(roundId, {
      ratings,
      comments,
      responseCount: round.responseCount + 1,
    });
    return { ok: true };
  }

  async remind(memberId: string, roundId: string, now = new Date()) {
    const round = await this.roundRepo.findOne({
      where: { id: roundId },
      relations: { pulse: { department: true } },
    });
    if (!round) throw new NotFoundException('Check-in not found');
    await this.assertLead(memberId, round.pulse.department.id);
    if (round.opensAt > now || round.closesAt <= now)
      throw new BadRequestException('This check-in has closed.');
    if (
      round.reminderSentAt &&
      now.getTime() - round.reminderSentAt.getTime() < REMIND_AGAIN_AFTER_MS
    )
      throw new BadRequestException(
        'A reminder went out recently. You can send another 12 hours after the last one.',
      );
    const sent = await this.sendReminder(round, now);
    this.audit.log('TEAM_PULSE_REMINDER_SENT', {
      actorId: memberId,
      targetId: round.pulse.id,
      targetName: round.pulse.title,
      metadata: { roundId, recipients: sent },
    });
    return { sent };
  }

  // For pastors: every department's latest score and its direction since the round before.
  async overview(memberId: string, now = new Date()) {
    if (!(await this.isPastor(memberId)))
      throw new ForbiddenException('Feedback-review access required');
    const pulses = await this.pulseRepo.find({
      relations: { department: true },
      order: { createdAt: 'DESC' },
    });
    if (!pulses.length) return [];
    const rounds = await this.recentRounds(pulses.map((p) => p.id));
    const byDept = new Map<
      string,
      { department: { id: string; name: string }; pulses: unknown[] }
    >();
    for (const p of pulses) {
      // Open rounds can still change, so scores and direction come from closed ones.
      const scored = (rounds.get(p.id) ?? []).filter(
        (r) => r.closesAt <= now && roundScore(r) !== null,
      );
      const latest = scored[scored.length - 1];
      const previous = scored[scored.length - 2];
      const entry = byDept.get(p.department.id) ?? {
        department: { id: p.department.id, name: p.department.name },
        pulses: [],
      };
      entry.pulses.push({
        id: p.id,
        title: p.title,
        active: p.active,
        latestScore: latest ? roundScore(latest) : null,
        previousScore: previous ? roundScore(previous) : null,
        latestAt: latest?.opensAt ?? null,
        responseRate: latest?.invitedCount
          ? Math.round((latest.responseCount / latest.invitedCount) * 100)
          : null,
        scores: scored.map((r) => roundScore(r)),
      });
      byDept.set(p.department.id, entry);
    }
    return [...byDept.values()].sort((a, b) =>
      a.department.name.localeCompare(b.department.name),
    );
  }

  // Opens a new round for the team and lets them know.
  async openRound(pulse: TeamPulse, now: Date): Promise<TeamPulseRound> {
    const memberIds = await this.teamMemberIds(pulse.department.id);
    const round = await this.roundRepo.save(
      this.roundRepo.create({
        pulse,
        opensAt: now,
        closesAt: new Date(now.getTime() + pulse.responseWindowDays * DAY_MS),
        invitedCount: memberIds.length,
      }),
    );
    if (memberIds.length)
      this.notifications
        .notifyMember({
          category: EmailCategory.TEAM_PULSE,
          push: {
            memberIds,
            key: PushNotificationKey.TEAM_PULSE_OPEN,
            vars: {
              department_name: pulse.department.name,
              pulse_title: pulse.title,
            },
            url: '/team-pulse',
            idempotencyKey: `team-pulse-open:${round.id}`,
          },
        })
        .catch(() => undefined);
    return round;
  }

  // Pushes the reminder to those who haven't answered; returns how many.
  async sendReminder(round: TeamPulseRound, now: Date): Promise<number> {
    const memberIds = (await this.notYetAnswered(round)).map((m) => m.id);
    await this.roundRepo.update(round.id, { reminderSentAt: now });
    if (!memberIds.length) return 0;
    const timezone = await this.churchTimezone.get();
    await this.notifications.notifyMember({
      category: EmailCategory.TEAM_PULSE,
      push: {
        memberIds,
        key: PushNotificationKey.TEAM_PULSE_REMINDER,
        vars: {
          pulse_title: round.pulse.title,
          closes: this.dateService.format(
            round.closesAt,
            "EEE 'at' h:mm a",
            timezone,
          ),
        },
        url: '/team-pulse',
        idempotencyKey: `team-pulse-remind:${round.id}:${now.getTime()}`,
      },
    });
    return memberIds.length;
  }

  private async notYetAnswered(
    round: TeamPulseRound,
  ): Promise<{ id: string; name: string }[]> {
    const rows = await this.workerRepo
      .createQueryBuilder('wp')
      .innerJoin('wp.member', 'm')
      .select(['m.id AS id', "m.firstname || ' ' || m.lastname AS name"])
      .where(
        '(wp.department_id = :dept OR wp.secondary_department_id = :dept)',
        { dept: round.pulse.department.id },
      )
      .andWhere('wp.status = :active AND m.status = :memberActive', {
        active: WorkerStatusEnum.ACTIVE,
        memberActive: MemberStatusEnum.ACTIVE,
      })
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM team_pulse_participations tp WHERE tp.round_id = :roundId AND tp.member_id = m.id)',
        { roundId: round.id },
      )
      .orderBy('name', 'ASC')
      .getRawMany<{ id: string; name: string }>();
    return rows;
  }

  private async teamMemberIds(departmentId: string): Promise<string[]> {
    const rows = await this.workerRepo
      .createQueryBuilder('wp')
      .innerJoin('wp.member', 'm')
      .select('DISTINCT m.id', 'id')
      .where(
        '(wp.department_id = :dept OR wp.secondary_department_id = :dept)',
        { dept: departmentId },
      )
      .andWhere('wp.status = :active AND m.status = :memberActive', {
        active: WorkerStatusEnum.ACTIVE,
        memberActive: MemberStatusEnum.ACTIVE,
      })
      .getRawMany<{ id: string }>();
    return rows.map((r) => r.id);
  }

  // Each pulse's latest rounds straight from the (pulse_id, opens_at) index, so the cost doesn't grow with history.
  // Comments are left out: trends only need the totals, and comments load with a round's own results.
  private async recentRounds(
    pulseIds: string[],
  ): Promise<Map<string, TeamPulseRound[]>> {
    const rows = await this.roundRepo.query(
      `SELECT r.id, r.pulse_id, r.opens_at, r.closes_at, r.invited_count, r.response_count, r.ratings
       FROM unnest($1::uuid[]) AS p(id)
       CROSS JOIN LATERAL (
         SELECT * FROM team_pulse_rounds WHERE pulse_id = p.id ORDER BY opens_at DESC LIMIT $2
       ) r
       ORDER BY r.opens_at ASC`,
      [pulseIds, TREND_ROUNDS],
    );
    const map = new Map<string, TeamPulseRound[]>();
    for (const row of rows as {
      id: string;
      pulse_id: string;
      opens_at: Date;
      closes_at: Date;
      invited_count: number;
      response_count: number;
      ratings: TeamPulseRound['ratings'];
    }[]) {
      const round = Object.assign(new TeamPulseRound(), {
        id: row.id,
        opensAt: new Date(row.opens_at),
        closesAt: new Date(row.closes_at),
        invitedCount: Number(row.invited_count),
        responseCount: Number(row.response_count),
        ratings: row.ratings ?? {},
      });
      map.set(row.pulse_id, [...(map.get(row.pulse_id) ?? []), round]);
    }
    return map;
  }

  private async access(
    memberId: string,
    departmentId: string,
  ): Promise<Access> {
    const [leads, pastor, teams] = await Promise.all([
      this.leadDepartmentIds(memberId),
      this.isPastor(memberId),
      this.workerDepartmentIds(memberId),
    ]);
    if (leads.includes(departmentId)) return 'lead';
    if (pastor) return 'pastor';
    if (teams.includes(departmentId)) return 'member';
    throw new ForbiddenException("This isn't one of your teams.");
  }

  private async assertLead(memberId: string, departmentId: string) {
    if (!(await this.leadDepartmentIds(memberId)).includes(departmentId))
      throw new ForbiddenException(
        "Only the department's HOD or Assistant HOD can do this.",
      );
  }

  private async leadDepartmentIds(memberId: string): Promise<string[]> {
    const leads = await this.leadRepo
      .createQueryBuilder('l')
      .innerJoin('l.workerProfile', 'wp')
      .select('l.department_id', 'id')
      .where('wp.member_id = :memberId', { memberId })
      .getRawMany<{ id: string }>();
    return leads.map((l) => l.id);
  }

  private async workerDepartmentIds(memberId: string): Promise<string[]> {
    const wp = await this.workerRepo
      .createQueryBuilder('wp')
      .select(['wp.department_id AS d', 'wp.secondary_department_id AS s'])
      .where('wp.member_id = :memberId AND wp.status = :active', {
        memberId,
        active: WorkerStatusEnum.ACTIVE,
      })
      .getRawOne<{ d: string | null; s: string | null }>();
    return [wp?.d, wp?.s].filter((v): v is string => !!v);
  }

  private async isPastor(memberId: string): Promise<boolean> {
    return this.clergyRepo.exists({
      where: { member: { id: memberId }, canReviewFeedback: true },
    });
  }

  // Scheduler: opens due rounds and sends the day-before reminder for required ones.
  async runDue(now = new Date()): Promise<Date | null> {
    const due = await this.pulseRepo.find({
      where: { active: true, nextOpenAt: LessThanOrEqual(now) },
      relations: { department: true },
    });
    for (const pulse of due) {
      await this.openRound(pulse, now);
      let next = nextOpening(pulse.nextOpenAt ?? now, pulse.frequency);
      while (next && next <= now) next = nextOpening(next, pulse.frequency);
      await this.pulseRepo.update(pulse.id, { nextOpenAt: next });
    }

    const closingSoon = await this.roundRepo
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.pulse', 'p')
      .innerJoinAndSelect('p.department', 'd')
      .where('p.required = true AND p.active = true')
      .andWhere('r.reminderSentAt IS NULL')
      .andWhere('r.closesAt > :now AND r.closesAt <= :soon', {
        now,
        soon: new Date(now.getTime() + DAY_MS),
      })
      .getMany();
    for (const round of closingSoon) await this.sendReminder(round, now);

    const [nextOpen, nextReminder] = await Promise.all([
      this.pulseRepo.findOne({
        where: { active: true, nextOpenAt: MoreThan(now) },
        select: { id: true, nextOpenAt: true },
        order: { nextOpenAt: 'ASC' },
      }),
      this.roundRepo
        .createQueryBuilder('r')
        .innerJoin('r.pulse', 'p')
        .select(['r.id', 'r.closesAt'])
        .where('p.required = true AND p.active = true')
        .andWhere('r.reminderSentAt IS NULL AND r.closesAt > :soon', {
          soon: new Date(now.getTime() + DAY_MS),
        })
        .orderBy('r.closesAt', 'ASC')
        .getOne(),
    ]);
    const times = [
      nextOpen?.nextOpenAt?.getTime(),
      nextReminder ? nextReminder.closesAt.getTime() - DAY_MS : undefined,
    ].filter((t): t is number => t !== undefined);
    return times.length ? new Date(Math.min(...times)) : null;
  }
}
