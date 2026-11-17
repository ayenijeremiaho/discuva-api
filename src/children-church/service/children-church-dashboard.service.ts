import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { fromZonedTime } from 'date-fns-tz';
import { ChildCheckIn } from '../entity/child-check-in.entity';
import { ChildClassGroup } from '../entity/child-class-group.entity';
import { ChildProfile } from '../entity/child-profile.entity';
import { ChildRoomDuty } from '../entity/child-room-duty.entity';
import { ChildCheckInStatusEnum } from '../enums/child-checkin-status.enum';
import { DepartmentLead } from '../../department/entity/department-lead.entity';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { DepartmentCapability } from '../../department/enums/department-capability.enum';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import { CacheService } from '../../utility/service/cache.service';
import { churchDay } from '../church-day';
import { DASHBOARD_CACHE_SECONDS } from '../children-church.constants';

const DAY_MS = 24 * 60 * 60 * 1000;
const MISSED_DAYS = 21;
const MISSED_WINDOW_DAYS = 90;

interface TodayRow {
  id: string;
  status: ChildCheckInStatusEnum;
  checkedInById: string | null;
  lateNotifiedAt: Date | null;
  flagReason: string | null;
  childFirstname: string;
  childLastname: string;
  classGroupId: string | null;
  classGroupName: string | null;
  checkinTime: Date;
}

interface DutyRow {
  memberId: string;
  classGroupId: string | null;
  firstname: string | null;
  lastname: string | null;
}

interface DayRow {
  d: string | Date;
  classGroupId: string | null;
  children: number;
  teachers: number;
  lastOut: Date | null;
}

// Today at a glance for the HOD and deputy of the department that runs Children's Church.
@Injectable()
export class ChildrenChurchDashboardService {
  constructor(
    @InjectRepository(ChildCheckIn)
    private readonly checkInRepo: Repository<ChildCheckIn>,
    @InjectRepository(ChildClassGroup)
    private readonly classGroupRepo: Repository<ChildClassGroup>,
    @InjectRepository(ChildProfile)
    private readonly childRepo: Repository<ChildProfile>,
    @InjectRepository(DepartmentLead)
    private readonly leadRepo: Repository<DepartmentLead>,
    @InjectRepository(ServiceSlot)
    private readonly slotRepo: Repository<ServiceSlot>,
    @InjectRepository(ChildRoomDuty)
    private readonly dutyRepo: Repository<ChildRoomDuty>,
    private readonly tz: ChurchTimezoneService,
    private readonly cache: CacheService,
  ) {}

  isLead(memberId: string): Promise<boolean> {
    return this.leadRepo
      .createQueryBuilder('dl')
      .innerJoin('dl.workerProfile', 'wp')
      .innerJoin('dl.department', 'd')
      .where('wp.member_id = :memberId', { memberId })
      .andWhere(':cap = ANY(d.capabilities)', {
        cap: DepartmentCapability.MANAGE_CHILDREN_CHURCH,
      })
      .getExists();
  }

  async today(user: MemberAuth) {
    if (!(await this.isLead(user.id))) {
      throw new ForbiddenException(
        "Only the head of the Children's Church department can see this.",
      );
    }
    const timezone = await this.tz.get();
    const day = churchDay(timezone);
    const key = this.cache.key('cc-dashboard', day.ymd);
    const hit =
      await this.cache.get<Awaited<ReturnType<typeof this.build>>>(key);
    if (hit) return hit;
    const data = await this.build(day, timezone);
    this.cache.set(key, data, DASHBOARD_CACHE_SECONDS);
    return data;
  }

  private async build(
    day: { ymd: string; start: Date; end: Date },
    timezone: string,
  ) {
    const monthStart = fromZonedTime(
      `${day.ymd.slice(0, 7)}-01T00:00:00`,
      timezone,
    );
    const now = new Date();
    const localDate = `(ci.checkin_time AT TIME ZONE :tz)::date`;

    const [
      rows,
      classGroups,
      parentUpdates,
      awayCount,
      days,
      newChildren,
      missed,
      slots,
      unlinked,
      dayTeachers,
      duties,
      present,
    ] = await Promise.all([
      this.checkInRepo
        .createQueryBuilder('ci')
        .innerJoin('ci.child', 'c')
        .leftJoin('c.classGroup', 'cg')
        .select('ci.id', 'id')
        .addSelect('ci.status', 'status')
        .addSelect('ci.checked_in_by_id', 'checkedInById')
        .addSelect('ci.late_notified_at', 'lateNotifiedAt')
        .addSelect('ci.flag_reason', 'flagReason')
        .addSelect('ci.checkin_time', 'checkinTime')
        .addSelect('c.firstname', 'childFirstname')
        .addSelect('c.lastname', 'childLastname')
        .addSelect('cg.id', 'classGroupId')
        .addSelect('cg.name', 'classGroupName')
        .where('ci.checkin_time >= :start AND ci.checkin_time < :end', day)
        .getRawMany<TodayRow>(),
      this.classGroupRepo.find({
        select: {
          id: true,
          name: true,
          capacity: true,
          childrenPerTeacher: true,
        },
        order: { name: 'ASC' },
      }),
      this.childRepo
        .createQueryBuilder('c')
        .leftJoin('c.notesUpdatedBy', 'm')
        .select([
          'c.id',
          'c.firstname',
          'c.lastname',
          'c.specialNotes',
          'c.notesUpdatedAt',
        ])
        .addSelect(['m.id', 'm.firstname', 'm.lastname'])
        .where('c.notes_updated_at >= :start', day)
        .orderBy('c.notesUpdatedAt', 'DESC')
        .limit(5)
        .getMany(),
      this.childRepo.count({ where: { awayDate: day.ymd } }),
      // Each church day of the last five weeks, per room, for last Sunday, the plan and this month.
      this.checkInRepo
        .createQueryBuilder('ci')
        .innerJoin('ci.child', 'c')
        .select(localDate, 'd')
        .addSelect('c.class_group_id', 'classGroupId')
        .addSelect('COUNT(*)::int', 'children')
        .addSelect('COUNT(DISTINCT ci.checked_in_by_id)::int', 'teachers')
        .addSelect('MAX(ci.checkout_time)', 'lastOut')
        .where('ci.checkin_time >= :from AND ci.checkin_time < :start', {
          from: new Date(day.start.getTime() - 35 * DAY_MS),
          start: day.start,
        })
        .setParameter('tz', timezone)
        .groupBy('d')
        .addGroupBy('c.class_group_id')
        .getRawMany<DayRow>(),
      this.childRepo
        .createQueryBuilder('c')
        .where('c.created_at >= :monthStart', { monthStart })
        .getCount(),
      this.checkInRepo.query(
        `SELECT COUNT(*)::int AS n FROM (
             SELECT child_id, MAX(checkin_time) AS last FROM child_check_ins
             WHERE checkin_time >= $1 GROUP BY child_id
           ) t WHERE t.last < $2`,
        [
          new Date(now.getTime() - MISSED_WINDOW_DAYS * DAY_MS),
          new Date(now.getTime() - MISSED_DAYS * DAY_MS),
        ],
      ) as Promise<{ n: number }[]>,
      // The slot running now, else the next one within two weeks.
      this.slotRepo
        .createQueryBuilder('s')
        .select(['s.id', 's.name', 's.startTime', 's.endTime'])
        .where('s.end_time >= :now AND s.start_time <= :until', {
          now,
          until: new Date(now.getTime() + 14 * DAY_MS),
        })
        .orderBy('s.startTime', 'ASC')
        .limit(2)
        .getMany(),
      this.childRepo.query(
        `SELECT COUNT(*)::int AS n FROM child_profiles c
         WHERE NOT EXISTS (SELECT 1 FROM child_guardians g WHERE g.child_id = c.id AND g.member_id IS NOT NULL)`,
      ) as Promise<{ n: number }[]>,
      this.checkInRepo
        .createQueryBuilder('ci')
        .select(localDate, 'd')
        .addSelect('COUNT(DISTINCT ci.checked_in_by_id)::int', 'teachers')
        .where('ci.checkin_time >= :from AND ci.checkin_time < :start', {
          from: new Date(day.start.getTime() - 35 * DAY_MS),
          start: day.start,
        })
        .setParameter('tz', timezone)
        .groupBy('d')
        .getRawMany<{ d: string | Date; teachers: number }>(),
      this.dutyRepo
        .createQueryBuilder('rd')
        .innerJoin('rd.member', 'm')
        .select('rd.member_id', 'memberId')
        .addSelect('rd.class_group_id', 'classGroupId')
        .addSelect('m.firstname', 'firstname')
        .addSelect('m.lastname', 'lastname')
        .where('rd.day = :ymd', { ymd: day.ymd })
        .getRawMany<DutyRow>(),
      // Children's Church workers who checked in to a service today.
      this.checkInRepo.query(
        `SELECT DISTINCT a.member_id AS "memberId" FROM attendances a
         JOIN worker_profiles wp ON wp.member_id = a.member_id
         LEFT JOIN departments d ON d.id = wp.department_id
         LEFT JOIN departments sd ON sd.id = wp.secondary_department_id
         WHERE a.checkin_time >= $1 AND a.checkin_time < $2
           AND ($3 = ANY(d.capabilities) OR $3 = ANY(sd.capabilities))`,
        [day.start, day.end, DepartmentCapability.MANAGE_CHILDREN_CHURCH],
      ) as Promise<{ memberId: string }[]>,
    ]);

    const inNow = rows.filter(
      (r) => r.status === ChildCheckInStatusEnum.CHECKED_IN,
    );
    // On duty: checked in to the service as a worker, or checked a child in. A room pick alone
    // doesn't count (it carries over from last week), unless the church doesn't record worker attendance.
    const teachers = new Set<string>([
      ...present.map((p) => p.memberId),
      ...rows.map((r) => r.checkedInById).filter((id): id is string => !!id),
    ]);
    const onDuty = duties.filter(
      (d) => !present.length || teachers.has(d.memberId),
    );
    for (const d of onDuty) teachers.add(d.memberId);
    const initials = (r: {
      firstname: string | null;
      lastname: string | null;
    }) => `${r.firstname?.[0] ?? ''}${r.lastname?.[0] ?? ''}`.toUpperCase();

    // Days rolled up across rooms; the last one before today is "last Sunday" (or last service day).
    const ymdOf = (d: string | Date) =>
      typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
    const byDay = new Map<
      string,
      { children: number; teachers: number; lastOut: Date | null }
    >();
    for (const r of days) {
      const k = ymdOf(r.d);
      const cur = byDay.get(k) ?? { children: 0, teachers: 0, lastOut: null };
      cur.children += Number(r.children);
      if (r.lastOut && (!cur.lastOut || new Date(r.lastOut) > cur.lastOut))
        cur.lastOut = new Date(r.lastOut);
      byDay.set(k, cur);
    }
    for (const t of dayTeachers) {
      const cur = byDay.get(ymdOf(t.d));
      if (cur) cur.teachers = Number(t.teachers);
    }
    const lastDayKey = [...byDay.keys()].sort().pop() ?? null;
    const lastDay = lastDayKey
      ? { date: lastDayKey, ...byDay.get(lastDayKey)! }
      : null;
    const isSunday = (ymd: string) =>
      new Date(`${ymd}T12:00:00Z`).getUTCDay() === 0;
    const monthKey = day.ymd.slice(0, 7);
    const sundays = [...byDay.entries()]
      .filter(([d]) => d.startsWith(monthKey) && isSunday(d))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, children: v.children }));
    if (isSunday(day.ymd) && rows.length)
      sundays.push({ date: day.ymd, children: rows.length });

    const rooms = classGroups
      .map((cg) => {
        const here = rows.filter((r) => r.classGroupId === cg.id);
        const kids = here.filter(
          (r) => r.status === ChildCheckInStatusEnum.CHECKED_IN,
        ).length;
        const teacherRows = onDuty.filter((d) => d.classGroupId === cg.id);
        const ratio = cg.childrenPerTeacher;
        const needed = ratio ? Math.ceil(kids / ratio) : null;
        return {
          id: cg.id,
          name: cg.name,
          children: kids,
          capacity: cg.capacity,
          teachers: teacherRows.length,
          teacherInitials: teacherRows.map(initials).filter(Boolean),
          childrenPerTeacher: ratio,
          teachersNeeded: needed,
          needsTeacher:
            needed !== null && kids > 0 && teacherRows.length < needed,
        };
      })
      .filter((r) => r.children > 0 || r.teachers > 0);

    const plan = lastDayKey
      ? classGroups
          .map((cg) => {
            const usual = days
              .filter(
                (r) => ymdOf(r.d) === lastDayKey && r.classGroupId === cg.id,
              )
              .reduce((n, r) => n + Number(r.children), 0);
            return {
              id: cg.id,
              name: cg.name,
              usualChildren: usual,
              childrenPerTeacher: cg.childrenPerTeacher,
              teachersNeeded:
                cg.childrenPerTeacher && usual
                  ? Math.ceil(usual / cg.childrenPerTeacher)
                  : null,
            };
          })
          .filter((p) => p.usualChildren > 0)
      : [];

    const live = slots.find((s) => new Date(s.startTime) <= now) ?? null;
    const next = slots.find((s) => new Date(s.startTime) > now) ?? null;

    return {
      date: day.ymd,
      service: {
        live: live ? { name: live.name, endTime: live.endTime } : null,
        next: next ? { name: next.name, startTime: next.startTime } : null,
      },
      childrenInNow: inNow.length,
      checkedInToday: rows.length,
      teachersOnDuty: teachers.size,
      atFrontDesk: onDuty
        .filter((d) => !d.classGroupId)
        .map((d) => `${d.firstname ?? ''}`.trim()),
      collected: rows.filter(
        (r) => r.status === ChildCheckInStatusEnum.CHECKED_OUT,
      ).length,
      rooms,
      latePickups: inNow
        .filter((r) => r.lateNotifiedAt)
        .map((r) => ({
          checkInId: r.id,
          childName: `${r.childFirstname} ${r.childLastname}`.trim(),
          room: r.classGroupName,
          notifiedAt: r.lateNotifiedAt,
        })),
      flagged: rows
        .filter((r) => r.status === ChildCheckInStatusEnum.FLAGGED)
        .map((r) => ({
          checkInId: r.id,
          childName: `${r.childFirstname} ${r.childLastname}`.trim(),
          room: r.classGroupName,
          reason: r.flagReason,
        })),
      parentUpdates: parentUpdates.map((c) => ({
        childId: c.id,
        childName: `${c.firstname} ${c.lastname}`.trim(),
        note: c.specialNotes?.split('\n').pop() ?? null,
        by: c.notesUpdatedBy
          ? `${c.notesUpdatedBy.firstname} ${c.notesUpdatedBy.lastname}`.trim()
          : null,
        at: c.notesUpdatedAt,
      })),
      awayToday: awayCount,
      lastDay,
      plan,
      teachersToPlan: plan.reduce((n, p) => n + (p.teachersNeeded ?? 0), 0),
      unlinkedChildren: unlinked[0]?.n ?? 0,
      month: {
        sundays,
        averageSunday: sundays.length
          ? Math.round(
              sundays.reduce((a, b) => a + b.children, 0) / sundays.length,
            )
          : 0,
        newChildren,
        missedThreeWeeks: missed[0]?.n ?? 0,
      },
    };
  }
}
