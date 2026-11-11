import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';
import { CacheService } from '../../utility/service/cache.service';
import { NetworkRollup } from '../entity/network-rollup.entity';
import { BranchAttention, BranchMetrics } from '../report/network-report.types';
import { NetworkSettingsValues } from '../report/network-settings.constants';
import { NetworkSettingsService } from './network-settings.service';

// Too few check-ins in the earlier weeks to call a drop a trend.
const MIN_ATTENDANCE_FOR_DROP = 20;
const MIN_FIRST_TIMERS_FOR_SHARE = 5;
// The month's figures stay open until this day of the next month, for late entries.
export const OPEN_UNTIL_DAY = 7;

export const rollupVersionKey = (rootId: string) =>
  `network-rollup-ver:${rootId}`;

type Church = Pick<
  Tenant,
  | 'id'
  | 'schemaName'
  | 'networkRootId'
  | 'timezone'
  | 'isActive'
  | 'shareGivingWithParent'
>;

// 'YYYY-MM' for a date in a time zone.
export function periodOf(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`;
}

export function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

// Which months a recalculation may still change: this one, and last month until the 7th.
export function openPeriods(now: Date, timeZone: string): string[] {
  const current = periodOf(now, timeZone);
  const day = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone, day: '2-digit' }).format(now),
  );
  return day <= OPEN_UNTIL_DAY ? [current, previousPeriod(current)] : [current];
}

const n = (v: unknown) => Number(v ?? 0);

// Each branch counts its own figures inside its own schema, in one read-only snapshot, and writes them to the root table.
@Injectable()
export class NetworkRollupService {
  private readonly logger = new Logger(NetworkRollupService.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(NetworkRollup)
    private readonly rollupRepo: Repository<NetworkRollup>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly settings: NetworkSettingsService,
    private readonly cache: CacheService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async compute(tenantId: string, now = new Date()): Promise<void> {
    const started = Date.now();
    const church = await this.tenantRepo.findOne({
      where: { id: tenantId },
      select: {
        id: true,
        schemaName: true,
        networkRootId: true,
        timezone: true,
        isActive: true,
        shareGivingWithParent: true,
      },
    });
    if (!church?.networkRootId || !church.isActive) return;
    const tz = church.timezone || 'UTC';
    const periods = openPeriods(now, tz);
    const rules = await this.settings.get(church.networkRootId);

    const rows: NetworkRollup[] = [];
    for (const period of periods) {
      const [metrics, rootFigures] = await Promise.all([
        this.inChurch(church, () =>
          this.branchFigures(church, period, tz, now),
        ),
        this.rootFigures(church.id, period, tz),
      ]);
      metrics.transfersIn = rootFigures.transfersIn;
      metrics.transfersOut = rootFigures.transfersOut;
      metrics.milestones = rootFigures.milestones;
      // Moves in arrive as new records; they're counted as transfers, not new members.
      metrics.newMembers = Math.max(
        0,
        metrics.newMembers - rootFigures.transfersIn,
      );
      const attention =
        period === periods[0]
          ? await this.inChurch(church, () => this.attentionNow(rules, tz, now))
          : [];
      rows.push(
        this.rollupRepo.create({
          tenantId: church.id,
          period,
          networkRootId: church.networkRootId,
          metrics,
          attention,
          computedAt: now,
        }),
      );
    }
    await this.rollupRepo.upsert(rows, ['tenantId', 'period']);
    await this.cache.setGlobal(
      rollupVersionKey(church.networkRootId),
      Date.now(),
      7 * 24 * 3600,
    );
    this.logger.log(
      `Network figures for ${church.id} (${periods.join(', ')}) in ${Date.now() - started} ms`,
    );
  }

  private async branchFigures(
    church: Church,
    period: string,
    tz: string,
    now: Date,
  ): Promise<BranchMetrics> {
    const from = `${period}-01`;
    const to = `${nextPeriod(period)}-01`;
    const lo = `($1::date)::timestamp AT TIME ZONE $3`;
    const hi = `($2::date)::timestamp AT TIME ZONE $3`;
    const q = <T>(sql: string, params: unknown[] = [from, to, tz]) =>
      this.txHost.tx.query<T[]>(sql, params).then((r) => r[0]);

    // One snapshot for every count below, so the figures always agree with each other.
    await this.txHost.tx.query(
      'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY',
    );

    const [
      members,
      firstTimers,
      contacted,
      stopped,
      visits,
      services,
      online,
      ratings,
      classes,
      giving,
    ] = await Promise.all([
      q<{ members: string; created: string }>(
        `SELECT COUNT(*) FILTER (WHERE status = 'ACTIVE') AS members,
                COUNT(*) FILTER (WHERE created_at >= ${lo} AND created_at < ${hi} AND status IN ('ACTIVE', 'INACTIVE')) AS created
           FROM members`,
      ),
      q<{ total: string; twice: string; thrice: string }>(
        `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE v >= 1) AS twice, COUNT(*) FILTER (WHERE v >= 2) AS thrice
           FROM (SELECT ft.id, (SELECT COUNT(*) FROM first_timer_visits fv WHERE fv.first_timer_id = ft.id) AS v
                   FROM first_timers ft WHERE ft.visited_on >= $1 AND ft.visited_on < $2) x`,
        [from, to],
      ),
      q<{ count: string }>(
        `SELECT COUNT(DISTINCT ft.id) AS count
           FROM first_timers ft
           JOIN follow_up_tasks t ON t.first_timer_id = ft.id
           JOIN follow_up_notes fn ON fn.task_id = t.id
          WHERE ft.visited_on >= $1 AND ft.visited_on < $2
            AND fn.created_at < (ft.visited_on + 8)::timestamp AT TIME ZONE $3`,
      ),
      q<{ four: string; eight: string }>(
        `SELECT COUNT(*) FILTER (WHERE last >= $1::timestamptz - interval '12 weeks' AND last < $1::timestamptz - interval '4 weeks') AS four,
                COUNT(*) FILTER (WHERE last < $1::timestamptz - interval '8 weeks') AS eight
           FROM (SELECT a.member_id, MAX(a.checkin_time) AS last
                   FROM attendances a JOIN members m ON m.id = a.member_id AND m.status = 'ACTIVE'
                  WHERE a.status IN ('PRESENT', 'LATE', 'ATTENDED_ONLINE', 'ATTENDED_ELSEWHERE')
                    AND a.checkin_time >= $1::timestamptz - interval '16 weeks'
                  GROUP BY a.member_id) x`,
        [now.toISOString()],
      ),
      q<{ visitors_in: string; visits_out: string; attendance: string }>(
        `SELECT (SELECT COUNT(*) FROM network_visitors WHERE checkin_time >= ${lo} AND checkin_time < ${hi}) AS visitors_in,
                (SELECT COUNT(DISTINCT (member_id, (checkin_time AT TIME ZONE $3)::date)) FROM attendances
                  WHERE status = 'ATTENDED_ELSEWHERE' AND checkin_time >= ${lo} AND checkin_time < ${hi}) AS visits_out,
                (SELECT COUNT(*) FROM attendances
                  WHERE status IN ('PRESENT', 'LATE') AND checkin_time >= ${lo} AND checkin_time < ${hi}) AS attendance`,
      ),
      q<{ count: string }>(
        `SELECT COUNT(*) AS count FROM service_slots s
          WHERE s.end_time >= ${lo} AND s.end_time < LEAST(${hi}, now())
            AND (EXISTS (SELECT 1 FROM attendances a WHERE a.service_slot_id = s.id AND a.status IN ('PRESENT', 'LATE'))
                 OR EXISTS (SELECT 1 FROM service_headcounts h WHERE h.service_slot_id = s.id))`,
      ),
      q<{ count: string }>(
        `SELECT COUNT(*) AS count FROM attendances a JOIN events e ON e.id = a.event_id
          WHERE a.status = 'ATTENDED_ONLINE' AND e.event_date >= $1 AND e.event_date < $2`,
        [from, to],
      ),
      q<{ count: string; average: string | null }>(
        `SELECT COUNT(*) AS count, ROUND(AVG(r.rating)::numeric, 2) AS average
           FROM service_ratings r JOIN events e ON e.id = r.event_id
          WHERE e.event_date >= $1 AND e.event_date < $2`,
        [from, to],
      ),
      q<{ count: string }>(
        `SELECT COUNT(*) AS count FROM class_enrollments
          WHERE status = 'COMPLETED' AND completed_at >= ${lo} AND completed_at < ${hi}`,
      ),
      church.shareGivingWithParent
        ? q<{ total: string }>(
            `SELECT COALESCE(SUM(amount), 0) AS total FROM tithe_records WHERE payment_date >= $1 AND payment_date < $2`,
            [from, to],
          )
        : Promise.resolve(null),
    ]);

    return {
      members: n(members.members),
      newMembers: n(members.created),
      firstTimers: n(firstTimers.total),
      returnedTwice: n(firstTimers.twice),
      returnedThrice: n(firstTimers.thrice),
      stoppedFourWeeks: n(stopped.four),
      stoppedEightWeeks: n(stopped.eight),
      transfersIn: 0,
      transfersOut: 0,
      visitorsIn: n(visits.visitors_in),
      visitsOut: n(visits.visits_out),
      services: n(services.count),
      attendance: n(visits.attendance),
      online: n(online.count),
      ratingCount: n(ratings.count),
      ratingAverage: ratings.average === null ? null : Number(ratings.average),
      milestones: 0,
      classCompletions: n(classes.count),
      contactedInWeek: n(contacted.count),
      giving: giving ? Number(giving.total) : null,
    };
  }

  // Root-schema figures: moves between branches and milestones this church recorded.
  private async rootFigures(tenantId: string, period: string, tz: string) {
    const params = [tenantId, `${period}-01`, `${nextPeriod(period)}-01`, tz];
    const range = `decided_at >= ($2::date)::timestamp AT TIME ZONE $4 AND decided_at < ($3::date)::timestamp AT TIME ZONE $4`;
    const [[into], [out], [ms]] = await Promise.all([
      this.dataSource.query(
        `SELECT COUNT(*) AS c FROM network_transfers WHERE status = 'DONE' AND to_tenant_id = $1 AND ${range}`,
        params,
      ),
      this.dataSource.query(
        `SELECT COUNT(*) AS c FROM network_transfers WHERE status = 'DONE' AND from_tenant_id = $1 AND ${range}`,
        params,
      ),
      this.dataSource.query(
        `SELECT COUNT(*) AS c FROM discuva_milestones WHERE source_tenant_id = $1
            AND created_at >= ($2::date)::timestamp AT TIME ZONE $4 AND created_at < ($3::date)::timestamp AT TIME ZONE $4`,
        params,
      ),
    ]);
    return {
      transfersIn: n(into.c),
      transfersOut: n(out.c),
      milestones: n(ms.c),
    };
  }

  // What the churches above should look at now (design decision 11), using the network's own thresholds.
  private async attentionNow(
    rules: NetworkSettingsValues,
    tz: string,
    now: Date,
  ): Promise<BranchAttention[]> {
    const nowIso = now.toISOString();
    const weeks = rules.attendanceWeeks;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(
      now,
    );
    const lastMonth = previousPeriod(periodOf(now, tz));
    const q = <T>(sql: string, params: unknown[]) =>
      this.txHost.tx.query<T[]>(sql, params).then((r) => r[0]);

    const [trend, notContacted, recent, unreachable, admins] =
      await Promise.all([
        q<{ recent: string; before: string }>(
          `SELECT COUNT(*) FILTER (WHERE checkin_time >= $1::timestamptz - make_interval(weeks => $2)) AS recent,
                COUNT(*) FILTER (WHERE checkin_time < $1::timestamptz - make_interval(weeks => $2)) AS before
           FROM attendances
          WHERE status IN ('PRESENT', 'LATE') AND checkin_time >= $1::timestamptz - make_interval(weeks => $2 * 2)
            AND checkin_time < $1::timestamptz`,
          [nowIso, weeks],
        ),
        q<{ count: string }>(
          `SELECT COUNT(*) AS count FROM first_timers ft
           JOIN follow_up_tasks t ON t.first_timer_id = ft.id AND t.type = 'FIRST_TIMER'
          WHERE ft.visited_on <= $1::date - $2::int AND ft.visited_on > $1::date - $2::int - 30
            AND t.status = 'PENDING' AND t.outcome IS NULL
            AND NOT EXISTS (SELECT 1 FROM follow_up_notes fn WHERE fn.task_id = t.id)`,
          [today, rules.notContactedDays],
        ),
        q<{ attended: boolean; counted: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM attendances WHERE status IN ('PRESENT', 'LATE')
                          AND checkin_time >= $1::timestamptz - make_interval(weeks => $2)) AS attended,
                EXISTS (SELECT 1 FROM service_headcounts h JOIN service_slots s ON s.id = h.service_slot_id
                         WHERE s.start_time >= $1::timestamptz - make_interval(weeks => $2)) AS counted`,
          [nowIso, rules.noServiceWeeks],
        ),
        q<{ total: string; unreachable: string }>(
          `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE t.status = 'UNREACHABLE') AS unreachable
           FROM first_timers ft LEFT JOIN follow_up_tasks t ON t.first_timer_id = ft.id AND t.type = 'FIRST_TIMER'
          WHERE ft.visited_on >= $1::date AND ft.visited_on < ($1::date + interval '1 month')`,
          [`${lastMonth}-01`],
        ),
        q<{ count: string }>(
          `SELECT COUNT(*) AS count FROM admins WHERE is_active = true`,
          [],
        ),
      ]);

    const items: BranchAttention[] = [];
    const before = n(trend.before);
    const drop = before
      ? Math.round(((before - n(trend.recent)) / before) * 100)
      : 0;
    if (
      before >= MIN_ATTENDANCE_FOR_DROP &&
      drop >= rules.attendanceDropPercent
    ) {
      items.push({
        kind: 'ATTENDANCE_DROP',
        detail: `Attendance is down ${drop}% on the ${weeks} weeks before.`,
      });
    }
    if (n(notContacted.count) >= rules.notContactedCount) {
      items.push({
        kind: 'FIRST_TIMERS_NOT_CONTACTED',
        detail: `${n(notContacted.count)} first-timers have had no contact after ${rules.notContactedDays} days.`,
      });
    }
    if (!recent.attended && !recent.counted) {
      items.push({
        kind: 'NO_SERVICE',
        detail: `No service recorded in ${rules.noServiceWeeks} weeks.`,
      });
    }
    const total = n(unreachable.total);
    const unreachablePct = total
      ? Math.round((n(unreachable.unreachable) / total) * 100)
      : 0;
    if (
      total >= MIN_FIRST_TIMERS_FOR_SHARE &&
      unreachablePct >= rules.unreachablePercent
    ) {
      items.push({
        kind: 'FIRST_TIMERS_UNREACHABLE',
        detail: `${unreachablePct}% of last month's first-timers couldn't be reached.`,
      });
    }
    const adminCount = n(admins.count);
    if (adminCount < rules.minAdmins) {
      items.push({
        kind: 'FEW_ADMINS',
        detail:
          adminCount === 1
            ? 'Only one admin looks after this branch.'
            : `Only ${adminCount} admins look after this branch.`,
      });
    }
    return items;
  }

  private inChurch<T>(church: Church, fn: () => Promise<T>): Promise<T> {
    return runInTenantContext(
      this.cls,
      this.txHost,
      { tenantId: church.id, schemaName: church.schemaName },
      fn,
    );
  }
}
