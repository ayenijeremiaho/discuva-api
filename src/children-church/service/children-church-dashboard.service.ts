import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { fromZonedTime } from 'date-fns-tz';
import { ChildCheckIn } from '../entity/child-check-in.entity';
import { ChildClassGroup } from '../entity/child-class-group.entity';
import { ChildProfile } from '../entity/child-profile.entity';
import { ChildCheckInStatusEnum } from '../enums/child-checkin-status.enum';
import { DepartmentLead } from '../../department/entity/department-lead.entity';
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
    const now = Date.now();

    const [
      rows,
      classGroups,
      parentUpdates,
      awayCount,
      sundays,
      newChildren,
      missed,
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
        select: { id: true, name: true, childrenPerTeacher: true },
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
        .orderBy('c.notes_updated_at', 'DESC')
        .limit(5)
        .getMany(),
      this.childRepo.count({ where: { awayDate: day.ymd } }),
      this.checkInRepo
        .createQueryBuilder('ci')
        .select(`(ci.checkin_time AT TIME ZONE :tz)::date`, 'd')
        .addSelect('COUNT(*)::int', 'n')
        .where('ci.checkin_time >= :monthStart', { monthStart })
        .setParameter('tz', timezone)
        .groupBy('d')
        .getRawMany<{ d: string | Date; n: number }>(),
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
          new Date(now - MISSED_WINDOW_DAYS * DAY_MS),
          new Date(now - MISSED_DAYS * DAY_MS),
        ],
      ) as Promise<{ n: number }[]>,
    ]);

    const inNow = rows.filter(
      (r) => r.status === ChildCheckInStatusEnum.CHECKED_IN,
    );
    const teachers = new Set(rows.map((r) => r.checkedInById).filter(Boolean));

    const rooms = classGroups
      .map((cg) => {
        const here = rows.filter((r) => r.classGroupId === cg.id);
        const kids = here.filter(
          (r) => r.status === ChildCheckInStatusEnum.CHECKED_IN,
        ).length;
        const roomTeachers = new Set(
          here.map((r) => r.checkedInById).filter(Boolean),
        ).size;
        const ratio = cg.childrenPerTeacher;
        return {
          id: cg.id,
          name: cg.name,
          children: kids,
          teachers: roomTeachers,
          childrenPerTeacher: ratio,
          needsTeacher: !!ratio && kids > roomTeachers * ratio,
        };
      })
      .filter((r) => r.children > 0 || r.teachers > 0);

    const sundayCounts = sundays
      .filter(
        (s) =>
          new Date(`${String(s.d).slice(0, 10)}T12:00:00Z`).getUTCDay() === 0,
      )
      .map((s) => Number(s.n));

    return {
      date: day.ymd,
      childrenInNow: inNow.length,
      teachersOnDuty: teachers.size,
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
      month: {
        averageSunday: sundayCounts.length
          ? Math.round(
              sundayCounts.reduce((a, b) => a + b, 0) / sundayCounts.length,
            )
          : 0,
        newChildren,
        missedThreeWeeks: missed[0]?.n ?? 0,
      },
    };
  }
}
