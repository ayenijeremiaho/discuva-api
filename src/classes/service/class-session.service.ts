import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { ChurchClass } from '../entity/church-class.entity';
import { ClassEnrollment } from '../entity/class-enrollment.entity';
import { ClassSession } from '../entity/class-session.entity';
import { ClassSessionAttendance } from '../entity/class-session-attendance.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { Member } from '../../member/entity/member.entity';
import { EnrollmentStatusEnum } from '../enum/enrollment-status.enum';
import { ClassAttendanceStatusEnum } from '../enum/class-attendance-status.enum';
import { ClassSessionModeEnum } from '../enum/class-session-mode.enum';
import {
  CreateClassSessionDto,
  CreateClassSessionSeriesDto,
  MarkClassAttendanceDto,
  UpdateClassSessionScheduleDto,
} from '../dto/class-session.dto';
import { wallTimeToUtc } from '../util/church-time';

export const MAX_SERIES_SESSIONS = 60;
// Every session ends; when no end/length is given it runs this long.
export const DEFAULT_SESSION_MINUTES = 120;

const plusMinutes = (start: Date, minutes: number) =>
  new Date(start.getTime() + minutes * 60_000);

// Who marked attendance: an admin (admin portal) or a facilitator (member app).
export interface AttendanceActor {
  adminId?: string;
  memberId?: string;
}

export interface ClassSessionView {
  id: string;
  title: string | null;
  startsAt: Date;
  endsAt: Date | null;
  mode: ClassSessionModeEnum;
  location: string | null;
  meetingLink: string | null;
  notes: string | null;
  held: boolean;
  attendance: { present: number; absent: number; excused: number };
}

export interface RosterEntry {
  enrollmentId: string;
  name: string;
  email: string | null;
  isGuest: boolean;
  status: ClassAttendanceStatusEnum | null;
}

// YYYY-MM-DD dates every `everyWeeks` weeks, inclusive (UTC date maths, so no DST drift).
export function weeklyDates(
  start: string,
  end: string,
  everyWeeks: number,
): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (d <= last && out.length <= MAX_SERIES_SESSIONS) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7 * everyWeeks);
  }
  return out;
}

const personName = (e: ClassEnrollment) =>
  e.member
    ? `${e.member.firstname} ${e.member.lastname}`
    : `${e.guest?.firstName ?? ''} ${e.guest?.lastName ?? ''}`.trim();

@Injectable()
export class ClassSessionService {
  private readonly logger = new Logger(ClassSessionService.name);

  constructor(
    @InjectRepository(ChurchClass)
    private readonly classRepo: Repository<ChurchClass>,
    @InjectRepository(ClassSession)
    private readonly sessionRepo: Repository<ClassSession>,
    @InjectRepository(ClassSessionAttendance)
    private readonly attendanceRepo: Repository<ClassSessionAttendance>,
    @InjectRepository(ClassEnrollment)
    private readonly enrollmentRepo: Repository<ClassEnrollment>,
  ) {}

  // withCounts=false skips the attendance totals (member/guest views don't show them).
  async listSessions(
    classId: string,
    withCounts = true,
  ): Promise<ClassSessionView[]> {
    await this.getClassOrThrow(classId);
    const sessions = await this.sessionRepo.find({
      where: { churchClass: { id: classId } },
      order: { startsAt: 'ASC' },
    });
    const counts =
      sessions.length && withCounts
        ? await this.attendanceRepo
            .createQueryBuilder('a')
            .select('a.session_id', 'sessionId')
            .addSelect('a.status', 'status')
            .addSelect('COUNT(*)', 'count')
            .where('a.session_id IN (:...ids)', {
              ids: sessions.map((s) => s.id),
            })
            .groupBy('a.session_id')
            .addGroupBy('a.status')
            .getRawMany<{
              sessionId: string;
              status: ClassAttendanceStatusEnum;
              count: string;
            }>()
        : [];
    const now = Date.now();
    return sessions.map((s) => {
      const own = counts.filter((c) => c.sessionId === s.id);
      const n = (st: ClassAttendanceStatusEnum) =>
        Number(own.find((c) => c.status === st)?.count ?? 0);
      return {
        id: s.id,
        title: s.title,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        mode: s.mode,
        location: s.location,
        meetingLink: s.meetingLink,
        notes: s.notes,
        held: new Date(s.startsAt).getTime() <= now,
        attendance: {
          present: n(ClassAttendanceStatusEnum.PRESENT),
          absent: n(ClassAttendanceStatusEnum.ABSENT),
          excused: n(ClassAttendanceStatusEnum.EXCUSED),
        },
      };
    });
  }

  async createSession(
    classId: string,
    dto: CreateClassSessionDto,
  ): Promise<ClassSession> {
    const churchClass = await this.getClassOrThrow(classId);
    const startsAt = new Date(dto.startsAt);
    const endsAt = dto.endsAt
      ? new Date(dto.endsAt)
      : plusMinutes(startsAt, DEFAULT_SESSION_MINUTES);
    this.assertTimes(startsAt, endsAt);
    const saved = await this.sessionRepo.save(
      this.sessionRepo.create({
        churchClass,
        startsAt,
        endsAt,
        ...this.details(dto),
      }),
    );
    await this.syncNextSession(classId);
    return saved;
  }

  async createSeries(
    classId: string,
    dto: CreateClassSessionSeriesDto,
  ): Promise<{ created: number; skipped: string[] }> {
    const churchClass = await this.getClassOrThrow(classId);
    const dates = weeklyDates(dto.startDate, dto.endDate, dto.everyWeeks ?? 1);
    if (!dates.length)
      throw new BadRequestException(
        'The end date must be on or after the start date.',
      );
    if (dates.length > MAX_SERIES_SESSIONS)
      throw new BadRequestException(
        `That's more than ${MAX_SERIES_SESSIONS} sessions — create them in smaller batches.`,
      );
    const starts = dates.map((d) => wallTimeToUtc(d, dto.time));
    const existing = await this.sessionRepo.find({
      where: { churchClass: { id: classId }, startsAt: In(starts) },
      select: { id: true, startsAt: true },
    });
    const taken = new Set(existing.map((s) => new Date(s.startsAt).getTime()));
    const toCreate = starts.filter((s) => !taken.has(s.getTime()));
    if (toCreate.length) {
      await this.sessionRepo.save(
        toCreate.map((startsAt) =>
          this.sessionRepo.create({
            churchClass,
            startsAt,
            endsAt: plusMinutes(
              startsAt,
              dto.durationMinutes ?? DEFAULT_SESSION_MINUTES,
            ),
            ...this.details(dto),
          }),
        ),
      );
    }
    await this.syncNextSession(classId);
    this.logger.log(
      `Created ${toCreate.length} sessions for class ${classId} (${dates[0]} → ${dates[dates.length - 1]})`,
    );
    return {
      created: toCreate.length,
      skipped: dates.filter((_, i) => taken.has(starts[i].getTime())),
    };
  }

  async updateSession(
    sessionId: string,
    dto: UpdateClassSessionScheduleDto,
  ): Promise<ClassSession> {
    const session = await this.getSessionOrThrow(sessionId);
    const oldStart = new Date(session.startsAt).getTime();
    const length = session.endsAt
      ? new Date(session.endsAt).getTime() - oldStart
      : DEFAULT_SESSION_MINUTES * 60_000;
    if (dto.startsAt !== undefined) session.startsAt = new Date(dto.startsAt);
    if (dto.endsAt) session.endsAt = new Date(dto.endsAt);
    // Moving the start without a new end keeps the session's length; clearing the end restores the default.
    else if (dto.endsAt === null || dto.startsAt !== undefined)
      session.endsAt = new Date(
        new Date(session.startsAt).getTime() +
          (dto.endsAt === null ? DEFAULT_SESSION_MINUTES * 60_000 : length),
      );
    this.assertTimes(session.startsAt, session.endsAt);
    Object.assign(session, this.details(dto, true));
    const saved = await this.sessionRepo.save(session);
    await this.syncNextSession(session.churchClass.id);
    return saved;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.getSessionOrThrow(sessionId);
    const marked = await this.attendanceRepo.count({
      where: { session: { id: sessionId } },
    });
    if (marked > 0)
      throw new BadRequestException(
        `Attendance has been taken for this session (${marked} record(s)), so it can't be deleted. Edit it instead.`,
      );
    await this.sessionRepo.remove(session);
    await this.syncNextSession(session.churchClass.id);
  }

  // Everyone still on the class (not cancelled) with their mark for this session.
  async getRoster(
    sessionId: string,
  ): Promise<{ session: ClassSession; entries: RosterEntry[] }> {
    const session = await this.getSessionOrThrow(sessionId);
    const [enrollments, marks] = await Promise.all([
      this.enrollmentRepo.find({
        where: {
          churchClass: { id: session.churchClass.id },
          status: Not(EnrollmentStatusEnum.CANCELLED),
        },
        relations: ['member', 'guest'],
      }),
      this.attendanceRepo.find({
        where: { session: { id: sessionId } },
        relations: ['enrollment'],
      }),
    ]);
    const statusOf = new Map(marks.map((m) => [m.enrollment.id, m.status]));
    const entries = enrollments
      .map((e) => ({
        enrollmentId: e.id,
        name: personName(e),
        email: e.member?.email ?? e.guest?.email ?? null,
        isGuest: !e.member,
        status: statusOf.get(e.id) ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { session, entries };
  }

  async markAttendance(
    sessionId: string,
    dto: MarkClassAttendanceDto,
    actor: AttendanceActor,
  ): Promise<{ marked: number }> {
    const session = await this.getSessionOrThrow(sessionId);
    const ids = [...new Set(dto.attendances.map((a) => a.enrollmentId))];
    const valid = await this.enrollmentRepo.find({
      where: {
        id: In(ids),
        churchClass: { id: session.churchClass.id },
        status: Not(EnrollmentStatusEnum.CANCELLED),
      },
      select: { id: true },
    });
    const validIds = new Set(valid.map((e) => e.id));
    const existing = await this.attendanceRepo.find({
      where: { session: { id: sessionId }, enrollment: { id: In(ids) } },
      relations: ['enrollment'],
    });
    const byEnrollment = new Map(existing.map((a) => [a.enrollment.id, a]));
    const now = new Date();
    const markedBy = {
      markedByAdmin: actor.adminId ? ({ id: actor.adminId } as Admin) : null,
      markedByMember: actor.memberId
        ? ({ id: actor.memberId } as Member)
        : null,
    };
    const rows = dto.attendances
      .filter((a) => validIds.has(a.enrollmentId))
      .map((a) => {
        const row =
          byEnrollment.get(a.enrollmentId) ??
          this.attendanceRepo.create({
            session: { id: sessionId } as ClassSession,
            enrollment: { id: a.enrollmentId } as ClassEnrollment,
          });
        return Object.assign(
          row,
          { status: a.status, markedAt: now },
          markedBy,
        );
      });
    if (rows.length) await this.attendanceRepo.save(rows);
    return { marked: rows.length };
  }

  // A member's own view: the schedule plus their mark for each held session.
  // Pass the class's sessions when the caller already has them, to skip a second lookup.
  async scheduleForEnrollment(
    enrollment: Pick<ClassEnrollment, 'id'> & { churchClass: { id: string } },
    sessions?: ClassSessionView[],
  ) {
    const list =
      sessions ?? (await this.listSessions(enrollment.churchClass.id, false));
    const marks = list.length
      ? await this.attendanceRepo
          .createQueryBuilder('a')
          .select('a.session_id', 'sessionId')
          .addSelect('a.status', 'status')
          .where('a.enrollment_id = :id', { id: enrollment.id })
          .getRawMany<{
            sessionId: string;
            status: ClassAttendanceStatusEnum;
          }>()
      : [];
    const statusOf = new Map(marks.map((m) => [m.sessionId, m.status]));
    return list.map(({ attendance: _counts, ...s }) => ({
      ...s,
      myStatus: statusOf.get(s.id) ?? null,
    }));
  }

  // Keeps church_classes.next_session_at / meeting_link (used by session reminders) on the next upcoming session.
  async syncNextSession(classId: string): Promise<void> {
    const next = await this.sessionRepo
      .createQueryBuilder('s')
      .where('s.church_class_id = :classId', { classId })
      .andWhere('s.starts_at > now()')
      .orderBy('s.starts_at', 'ASC')
      .getOne();
    const hasSessions = await this.sessionRepo.exists({
      where: { churchClass: { id: classId } },
    });
    if (!hasSessions) return;
    await this.classRepo.update(classId, {
      nextSessionAt: next?.startsAt ?? null,
      ...(next?.meetingLink ? { meetingLink: next.meetingLink } : {}),
    });
  }

  // Run before the hourly reminder sweep so classes move on to their next session once one has passed.
  async advancePastNextSessions(): Promise<number> {
    const stale = await this.classRepo
      .createQueryBuilder('c')
      .select('c.id', 'id')
      .where('c.next_session_at <= now()')
      .andWhere(
        'EXISTS (SELECT 1 FROM class_sessions s WHERE s.church_class_id = c.id)',
      )
      .getRawMany<{ id: string }>();
    for (const { id } of stale) await this.syncNextSession(id);
    return stale.length;
  }

  async getSessionOrThrow(sessionId: string): Promise<ClassSession> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: ['churchClass'],
    });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  private async getClassOrThrow(classId: string): Promise<ChurchClass> {
    const churchClass = await this.classRepo.findOne({
      where: { id: classId },
    });
    if (!churchClass) throw new NotFoundException('Class not found');
    return churchClass;
  }

  private assertTimes(startsAt: Date, endsAt: Date | null): void {
    if (endsAt && endsAt.getTime() <= startsAt.getTime())
      throw new BadRequestException('The session must end after it starts.');
  }

  // Shared optional fields; on update only the ones sent are changed (empty string/null clears).
  private details(
    dto: Partial<
      Pick<
        CreateClassSessionDto,
        'title' | 'mode' | 'location' | 'meetingLink' | 'notes'
      >
    >,
    partial = false,
  ): Partial<ClassSession> {
    const out: Partial<ClassSession> = {};
    const text = (v: string | null | undefined) => v?.trim() || null;
    if (!partial || dto.title !== undefined) out.title = text(dto.title);
    if (!partial || dto.mode !== undefined)
      out.mode = dto.mode ?? ClassSessionModeEnum.PHYSICAL;
    if (!partial || dto.location !== undefined)
      out.location = text(dto.location);
    if (!partial || dto.meetingLink !== undefined)
      out.meetingLink = text(dto.meetingLink);
    if (!partial || dto.notes !== undefined) out.notes = text(dto.notes);
    return out;
  }
}
