import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, LessThanOrEqual, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { SundaySchoolClass } from '../entity/sunday-school-class.entity';
import { SundaySchoolMember } from '../entity/sunday-school-member.entity';
import { SundaySchoolSession } from '../entity/sunday-school-session.entity';
import { SundaySchoolAttendance } from '../entity/sunday-school-attendance.entity';
import { SundaySchoolAttendanceStatus } from '../enums/sunday-school-attendance-status.enum';
import { addDays, todayInChurchTz } from '../util/church-date';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';

const DEFAULT_WEEKS = 12;
// How far back the "missing lately" check looks.
const ABSENTEE_LOOKBACK_SESSIONS = 10;

export interface ReportRange {
  from?: string;
  to?: string;
  classId?: string;
}

export interface SessionReportRow {
  sessionId: string;
  classId: string;
  className: string;
  sessionDate: string;
  enrolled: number;
  present: number;
  absent: number;
  excused: number;
  unmarked: number;
  firstTimers: number;
  // present ÷ (enrolled − excused); null when nobody was expected.
  rate: number | null;
}

export interface ClassReportRow {
  classId: string;
  className: string;
  enrolled: number;
  sessions: number;
  averagePresent: number;
  firstTimers: number;
  rate: number | null;
}

export interface MemberReportRow {
  memberId: string;
  classId: string;
  className: string;
  firstname: string;
  lastname: string;
  email: string;
  sessionsHeld: number;
  present: number;
  absent: number;
  excused: number;
  rate: number | null;
  lastPresent: string | null;
}

export interface AbsenteeRow {
  classId: string;
  className: string;
  memberId: string;
  firstname: string;
  lastname: string;
  email: string;
  phoneNumber: string | null;
  missedInARow: number;
  // Most recent attended session in the look-back window; null = none of them.
  lastAttended: string | null;
}

const ratio = (num: number, den: number) =>
  den > 0 ? Math.round((num / den) * 1000) / 10 : null;

const weeksBefore = (date: string, weeks: number) => addDays(date, -weeks * 7);

// Joined on or before the session's day (assignments are timestamps, sessions are dates).
const joinedBy = (assignedAt: Date | string, sessionDate: string) =>
  new Date(assignedAt).getTime() <=
  new Date(`${sessionDate}T23:59:59.999Z`).getTime();

@Injectable()
export class SundaySchoolReportService {
  constructor(
    @InjectRepository(SundaySchoolClass)
    private readonly classRepo: Repository<SundaySchoolClass>,
    @InjectRepository(SundaySchoolMember)
    private readonly memberAssignRepo: Repository<SundaySchoolMember>,
    @InjectRepository(SundaySchoolSession)
    private readonly sessionRepo: Repository<SundaySchoolSession>,
    @InjectRepository(SundaySchoolAttendance)
    private readonly attendanceRepo: Repository<SundaySchoolAttendance>,
  ) {}

  // Future sessions are left out: nothing to count yet.
  resolveRange(range: ReportRange): { from: string; to: string } {
    const today = todayInChurchTz();
    const to = range.to && range.to < today ? range.to.slice(0, 10) : today;
    const from = range.from
      ? range.from.slice(0, 10)
      : weeksBefore(to, DEFAULT_WEEKS);
    return { from, to };
  }

  async attendanceReport(range: ReportRange) {
    const { from, to } = this.resolveRange(range);
    if (range.classId) await this.assertClass(range.classId);
    const sessions = await this.sessionRepo.find({
      where: {
        sessionDate: Between(from, to),
        ...(range.classId && { sundaySchoolClass: { id: range.classId } }),
      },
      relations: ['sundaySchoolClass'],
      order: { sessionDate: 'ASC' },
    });
    const bySession = await this.sessionRows(sessions);
    const byClass = await this.classRows(bySession, range.classId);
    const totals = bySession.reduce(
      (t, s) => ({
        present: t.present + s.present,
        expected: t.expected + s.enrolled - s.excused,
        firstTimers: t.firstTimers + s.firstTimers,
      }),
      { present: 0, expected: 0, firstTimers: 0 },
    );
    return {
      from,
      to,
      summary: {
        sessions: bySession.length,
        present: totals.present,
        firstTimers: totals.firstTimers,
        averagePresent: bySession.length
          ? Math.round((totals.present / bySession.length) * 10) / 10
          : 0,
        rate: ratio(totals.present, totals.expected),
      },
      byClass,
      bySession,
      members: range.classId ? await this.memberRows(sessions) : undefined,
    };
  }

  private async sessionRows(
    sessions: SundaySchoolSession[],
  ): Promise<SessionReportRow[]> {
    if (!sessions.length) return [];
    const [counts, memberships] = await Promise.all([
      this.attendanceRepo
        .createQueryBuilder('a')
        .select('a.session_id', 'sessionId')
        .addSelect('a.status', 'status')
        .addSelect('COUNT(a.member_id)', 'members')
        .addSelect('COUNT(a.first_timer_id)', 'firstTimers')
        .where('a.session_id IN (:...ids)', { ids: sessions.map((s) => s.id) })
        .groupBy('a.session_id')
        .addGroupBy('a.status')
        .getRawMany<{
          sessionId: string;
          status: SundaySchoolAttendanceStatus;
          members: string;
          firstTimers: string;
        }>(),
      this.memberships([
        ...new Set(sessions.map((s) => s.sundaySchoolClass.id)),
      ]),
    ]);
    const tally = new Map<
      string,
      { present: number; absent: number; excused: number; firstTimers: number }
    >();
    for (const c of counts) {
      const t = tally.get(c.sessionId) ?? {
        present: 0,
        absent: 0,
        excused: 0,
        firstTimers: 0,
      };
      const n = Number(c.members);
      if (c.status === SundaySchoolAttendanceStatus.PRESENT) t.present += n;
      else if (c.status === SundaySchoolAttendanceStatus.ABSENT) t.absent += n;
      else if (c.status === SundaySchoolAttendanceStatus.EXCUSED)
        t.excused += n;
      t.firstTimers += Number(c.firstTimers);
      tally.set(c.sessionId, t);
    }
    return sessions.map((s) => {
      const t = tally.get(s.id) ?? {
        present: 0,
        absent: 0,
        excused: 0,
        firstTimers: 0,
      };
      const enrolled = (memberships.get(s.sundaySchoolClass.id) ?? []).filter(
        (m) => joinedBy(m.assignedAt, s.sessionDate),
      ).length;
      return {
        sessionId: s.id,
        classId: s.sundaySchoolClass.id,
        className: s.sundaySchoolClass.name,
        sessionDate: s.sessionDate,
        enrolled,
        ...t,
        unmarked: Math.max(0, enrolled - t.present - t.absent - t.excused),
        rate: ratio(t.present, enrolled - t.excused),
      };
    });
  }

  private async classRows(
    sessions: SessionReportRow[],
    classId?: string,
  ): Promise<ClassReportRow[]> {
    const classes = await this.classRepo.find({
      where: classId ? { id: classId } : {},
      order: { name: 'ASC' },
    });
    const enrolled = await this.memberships(classes.map((c) => c.id));
    return classes.map((c) => {
      const own = sessions.filter((s) => s.classId === c.id);
      const present = own.reduce((n, s) => n + s.present, 0);
      const expected = own.reduce((n, s) => n + s.enrolled - s.excused, 0);
      return {
        classId: c.id,
        className: c.name,
        enrolled: enrolled.get(c.id)?.length ?? 0,
        sessions: own.length,
        averagePresent: own.length
          ? Math.round((present / own.length) * 10) / 10
          : 0,
        firstTimers: own.reduce((n, s) => n + s.firstTimers, 0),
        rate: ratio(present, expected),
      };
    });
  }

  // One row per current class membership, counting only sessions held after they joined.
  private async memberRows(
    sessions: SundaySchoolSession[],
  ): Promise<MemberReportRow[]> {
    const classIds = [...new Set(sessions.map((s) => s.sundaySchoolClass.id))];
    if (!classIds.length) return [];
    const [assignments, marks] = await Promise.all([
      this.memberAssignRepo.find({
        where: { sundaySchoolClass: { id: In(classIds) } },
        relations: ['member', 'sundaySchoolClass'],
      }),
      this.attendanceRepo
        .createQueryBuilder('a')
        .innerJoin('a.session', 's')
        .select('a.member_id', 'memberId')
        .addSelect('s.sunday_school_class_id', 'classId')
        .addSelect('a.status', 'status')
        .addSelect('s.session_date', 'sessionDate')
        .where('a.session_id IN (:...ids)', { ids: sessions.map((s) => s.id) })
        .andWhere('a.member_id IS NOT NULL')
        .getRawMany<{
          memberId: string;
          classId: string;
          status: SundaySchoolAttendanceStatus;
          sessionDate: string | Date;
        }>(),
    ]);
    const marksOf = new Map<string, typeof marks>();
    for (const m of marks) {
      const key = `${m.classId}:${m.memberId}`;
      marksOf.set(key, [...(marksOf.get(key) ?? []), m]);
    }
    return assignments
      .map((a) => {
        const classId = a.sundaySchoolClass.id;
        const held = sessions.filter(
          (s) =>
            s.sundaySchoolClass.id === classId &&
            joinedBy(a.assignedAt, s.sessionDate),
        ).length;
        const own = marksOf.get(`${classId}:${a.member.id}`) ?? [];
        const count = (st: SundaySchoolAttendanceStatus) =>
          own.filter((m) => m.status === st).length;
        const present = count(SundaySchoolAttendanceStatus.PRESENT);
        const excused = count(SundaySchoolAttendanceStatus.EXCUSED);
        const presentDates = own
          .filter((m) => m.status === SundaySchoolAttendanceStatus.PRESENT)
          .map((m) => dateOnly(m.sessionDate))
          .sort();
        return {
          memberId: a.member.id,
          classId,
          className: a.sundaySchoolClass.name,
          firstname: a.member.firstname,
          lastname: a.member.lastname,
          email: a.member.email,
          sessionsHeld: held,
          present,
          absent: count(SundaySchoolAttendanceStatus.ABSENT),
          excused,
          rate: ratio(present, held - excused),
          lastPresent: presentDates[presentDates.length - 1] ?? null,
        };
      })
      .sort(
        (x, y) =>
          x.className.localeCompare(y.className) ||
          (x.rate ?? 101) - (y.rate ?? 101) ||
          x.firstname.localeCompare(y.firstname),
      );
  }

  // Members whose most recent `minMisses`+ sessions (since they joined) were all missed — absent or never marked.
  async absentees(classId?: string, minMisses = 3): Promise<AbsenteeRow[]> {
    if (classId) await this.assertClass(classId);
    const today = todayInChurchTz();
    const sessions = await this.sessionRepo.find({
      where: {
        sessionDate: LessThanOrEqual(today),
        ...(classId && { sundaySchoolClass: { id: classId } }),
      },
      relations: ['sundaySchoolClass'],
      order: { sessionDate: 'DESC' },
      take: classId ? ABSENTEE_LOOKBACK_SESSIONS : 500,
    });
    const recent = new Map<string, SundaySchoolSession[]>();
    for (const s of sessions) {
      const list = recent.get(s.sundaySchoolClass.id) ?? [];
      if (list.length < ABSENTEE_LOOKBACK_SESSIONS) list.push(s);
      recent.set(s.sundaySchoolClass.id, list);
    }
    const sessionIds = [...recent.values()].flat().map((s) => s.id);
    if (!sessionIds.length) return [];
    const [assignments, attended] = await Promise.all([
      this.memberAssignRepo.find({
        where: { sundaySchoolClass: { id: In([...recent.keys()]) } },
        relations: ['member', 'sundaySchoolClass'],
      }),
      this.attendanceRepo
        .createQueryBuilder('a')
        .select('a.session_id', 'sessionId')
        .addSelect('a.member_id', 'memberId')
        .where('a.session_id IN (:...ids)', { ids: sessionIds })
        .andWhere('a.member_id IS NOT NULL')
        .andWhere('a.status IN (:...ok)', {
          ok: [
            SundaySchoolAttendanceStatus.PRESENT,
            SundaySchoolAttendanceStatus.EXCUSED,
          ],
        })
        .getRawMany<{ sessionId: string; memberId: string }>(),
    ]);
    const came = new Set(attended.map((a) => `${a.sessionId}:${a.memberId}`));
    const rows: AbsenteeRow[] = [];
    for (const a of assignments) {
      if (a.member.status === MemberStatusEnum.INACTIVE) continue;
      const theirs = (recent.get(a.sundaySchoolClass.id) ?? []).filter((s) =>
        joinedBy(a.assignedAt, s.sessionDate),
      );
      let streak = 0;
      while (
        streak < theirs.length &&
        !came.has(`${theirs[streak].id}:${a.member.id}`)
      )
        streak++;
      if (streak < minMisses) continue;
      rows.push({
        classId: a.sundaySchoolClass.id,
        className: a.sundaySchoolClass.name,
        memberId: a.member.id,
        firstname: a.member.firstname,
        lastname: a.member.lastname,
        email: a.member.email,
        phoneNumber: a.member.phoneNumber ?? null,
        missedInARow: streak,
        lastAttended: theirs[streak]?.sessionDate ?? null,
      });
    }
    return rows.sort(
      (x, y) =>
        y.missedInARow - x.missedInARow ||
        x.className.localeCompare(y.className) ||
        x.firstname.localeCompare(y.firstname),
    );
  }

  async exportWorkbook(range: ReportRange): Promise<Buffer> {
    const report = await this.attendanceReport(range);
    const sessions = await this.sessionRepo.find({
      where: { id: In(report.bySession.map((s) => s.sessionId)) },
      relations: ['sundaySchoolClass'],
    });
    const members = await this.memberRows(sessions);
    const pct = (r: number | null) => (r === null ? '' : `${r}%`);

    const workbook = new ExcelJS.Workbook();
    const sheet = (
      title: string,
      columns: { header: string; key: string; width?: number }[],
      rows: Record<string, unknown>[],
    ) => {
      const ws = workbook.addWorksheet(title);
      ws.columns = columns.map((c) => ({ ...c, width: c.width ?? 16 }));
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEADCC9' },
      };
      rows.forEach((r) => ws.addRow(r));
    };
    sheet(
      'Classes',
      [
        { header: 'Class', key: 'className', width: 28 },
        { header: 'Members', key: 'enrolled' },
        { header: 'Sessions', key: 'sessions' },
        { header: 'Average present', key: 'averagePresent' },
        { header: 'Attendance rate', key: 'rate' },
        { header: 'First-timers', key: 'firstTimers' },
      ],
      report.byClass.map((c) => ({ ...c, rate: pct(c.rate) })),
    );
    sheet(
      'Sessions',
      [
        { header: 'Date', key: 'sessionDate', width: 14 },
        { header: 'Class', key: 'className', width: 28 },
        { header: 'Members', key: 'enrolled' },
        { header: 'Present', key: 'present' },
        { header: 'Absent', key: 'absent' },
        { header: 'Excused', key: 'excused' },
        { header: 'Not marked', key: 'unmarked' },
        { header: 'First-timers', key: 'firstTimers' },
        { header: 'Attendance rate', key: 'rate' },
      ],
      report.bySession.map((s) => ({ ...s, rate: pct(s.rate) })),
    );
    sheet(
      'Members',
      [
        { header: 'Class', key: 'className', width: 28 },
        { header: 'First name', key: 'firstname', width: 18 },
        { header: 'Last name', key: 'lastname', width: 18 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Sessions held', key: 'sessionsHeld' },
        { header: 'Present', key: 'present' },
        { header: 'Absent', key: 'absent' },
        { header: 'Excused', key: 'excused' },
        { header: 'Attendance rate', key: 'rate' },
        { header: 'Last present', key: 'lastPresent', width: 14 },
      ],
      members.map((m) => ({ ...m, rate: pct(m.rate) })),
    );
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private async memberships(
    classIds: string[],
  ): Promise<Map<string, { memberId: string; assignedAt: Date }[]>> {
    const out = new Map<string, { memberId: string; assignedAt: Date }[]>();
    if (!classIds.length) return out;
    const rows = await this.memberAssignRepo
      .createQueryBuilder('m')
      .select('m.sunday_school_class_id', 'classId')
      .addSelect('m.member_id', 'memberId')
      .addSelect('m.assigned_at', 'assignedAt')
      .where('m.sunday_school_class_id IN (:...ids)', { ids: classIds })
      .getRawMany<{ classId: string; memberId: string; assignedAt: Date }>();
    for (const r of rows) {
      out.set(r.classId, [...(out.get(r.classId) ?? []), r]);
    }
    return out;
  }

  private async assertClass(classId: string): Promise<void> {
    if (!(await this.classRepo.existsBy({ id: classId })))
      throw new NotFoundException('Sunday School class not found');
  }
}

// pg returns DATE as a string, but be safe if a driver hands back a Date.
function dateOnly(v: string | Date): string {
  return typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10);
}
