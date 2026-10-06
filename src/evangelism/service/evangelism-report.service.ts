import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Convert } from '../entity/convert.entity';
import { ConvertStatusEnum } from '../enum/convert-status.enum';
import { ConvertListQueryDto, ExportType } from '../dto/convert.dto';
import { CacheService } from '../../utility/service/cache.service';
import { ConvertService, ConvertStage } from './convert.service';
import { EvangelismSettingsService } from './evangelism-settings.service';
import { EVANGELISM_REPORT_NAMESPACE } from './outreach.service';

const DEFAULT_RANGE_DAYS = 90;
const WEEKLY_MAX_DAYS = 26 * 7;
const REPORT_CACHE_TTL = 300;
const DAY_MS = 86_400_000;

export interface EvangelismReport {
  range: { from: string; to: string; bucket: 'week' | 'month' };
  summary: {
    added: number;
    byStatus: Record<ConvertStatusEnum, number>;
    visitedChurch: number;
    joinedChurch: number;
    followUpsLogged: number;
    outreaches: number;
    needsFollowUp: number;
    unassigned: number;
  };
  trend: { period: string; added: number; visited: number; joined: number }[];
  byWorker: WorkerReportRow[];
  byOutreach: OutreachReportRow[];
}

export interface WorkerReportRow {
  memberId: string;
  name: string;
  outreaches: number;
  broughtIn: number;
  assignedOpen: number;
  followUpsLogged: number;
  overdue: number;
  joinedChurch: number;
}

export interface OutreachReportRow {
  id: string;
  date: string;
  title: string | null;
  location: string | null;
  teamSize: number;
  converts: number;
  saved: number;
  discipleship: number;
  visitedChurch: number;
  joinedChurch: number;
}

type Count = { count: string };

@Injectable()
export class EvangelismReportService {
  constructor(
    @InjectRepository(Convert)
    private readonly convertRepo: Repository<Convert>,
    private readonly convertService: ConvertService,
    private readonly settingsService: EvangelismSettingsService,
    private readonly cacheService: CacheService,
  ) {}

  async getReport(from?: string, to?: string): Promise<EvangelismReport> {
    const range = resolveRange(from, to);
    return this.cacheService.getOrSet(
      `${EVANGELISM_REPORT_NAMESPACE}:${range.from}:${range.to}`,
      () => this.buildReport(range),
      REPORT_CACHE_TTL,
    );
  }

  async exportCsv(
    type: ExportType,
    filters: ConvertListQueryDto,
  ): Promise<string> {
    if (type === 'converts') {
      const rows = await this.convertService.findForExport(filters);
      return toCsv(
        [
          'Name',
          'Phone',
          'Status',
          'Stage',
          'Added on',
          'Added by',
          'Outreach',
          'Outreach team',
          'Assigned to',
          'Last contacted',
          'Needs follow-up',
          'Joined church',
          'Notes',
        ],
        rows.map((c) => [
          c.name,
          c.phone,
          c.status,
          STAGE_LABELS[c.stage],
          isoDate(c.createdAt),
          c.onboardedByName,
          c.outreach
            ? [c.outreach.title, c.outreach.outreachDate]
                .filter(Boolean)
                .join(' · ')
            : '',
          (c.outreach?.team ?? [])
            .map((m) => `${m.firstname} ${m.lastname}`)
            .join('; '),
          c.assignedTo?.member
            ? `${c.assignedTo.member.firstname} ${c.assignedTo.member.lastname}`
            : '',
          c.lastContactedAt ? isoDate(c.lastContactedAt) : '',
          c.isOverdue ? 'Yes' : 'No',
          c.member ? 'Yes' : 'No',
          c.notes,
        ]),
      );
    }

    const report = await this.getReport(filters.from, filters.to);
    if (type === 'workers') {
      return toCsv(
        [
          'Worker',
          'Outreaches',
          'Converts brought in',
          'Assigned (open)',
          'Follow-ups logged',
          'Needs follow-up',
          'Joined church',
        ],
        report.byWorker.map((w) => [
          w.name,
          w.outreaches,
          w.broughtIn,
          w.assignedOpen,
          w.followUpsLogged,
          w.overdue,
          w.joinedChurch,
        ]),
      );
    }
    return toCsv(
      [
        'Date',
        'Title',
        'Location',
        'Team size',
        'Converts',
        'Saved',
        'Undergoing discipleship',
        'Visited church',
        'Joined church',
      ],
      report.byOutreach.map((o) => [
        o.date,
        o.title,
        o.location,
        o.teamSize,
        o.converts,
        o.saved,
        o.discipleship,
        o.visitedChurch,
        o.joinedChurch,
      ]),
    );
  }

  private async buildReport(range: Range): Promise<EvangelismReport> {
    const { overdueDays } = await this.settingsService.get();
    const fromTs = new Date(`${range.from}T00:00:00.000Z`);
    const toTs = new Date(`${range.to}T23:59:59.999Z`);
    const cutoff = new Date(Date.now() - overdueDays * DAY_MS);
    const q = <T>(sql: string, params: unknown[]) =>
      this.convertRepo.query(sql, params) as Promise<T[]>;

    const [
      statusRows,
      [visited],
      [joined],
      [followUps],
      [outreachCount],
      [current],
      addedTrend,
      visitedTrend,
      joinedTrend,
      broughtInRows,
      outreachTeamRows,
      followUpRows,
      assignedRows,
      outreachRows,
    ] = await Promise.all([
      q<{ status: ConvertStatusEnum; count: string }>(
        `SELECT status, COUNT(*) AS count FROM converts
         WHERE created_at BETWEEN $1 AND $2 GROUP BY status`,
        [fromTs, toTs],
      ),
      q<Count>(
        `SELECT COUNT(*) AS count FROM converts WHERE first_timer_linked_at BETWEEN $1 AND $2`,
        [fromTs, toTs],
      ),
      q<Count>(
        `SELECT COUNT(*) AS count FROM converts WHERE linked_at BETWEEN $1 AND $2`,
        [fromTs, toTs],
      ),
      q<Count>(
        `SELECT COUNT(*) AS count FROM convert_follow_up_logs WHERE contacted_at BETWEEN $1 AND $2`,
        [fromTs, toTs],
      ),
      q<Count>(
        `SELECT COUNT(*) AS count FROM outreaches WHERE outreach_date BETWEEN $1 AND $2`,
        [range.from, range.to],
      ),
      q<{ overdue: string; unassigned: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE last_contacted_at IS NULL OR last_contacted_at < $1) AS overdue,
           COUNT(*) FILTER (WHERE assigned_to IS NULL) AS unassigned
         FROM converts WHERE member_id IS NULL AND first_timer_id IS NULL`,
        [cutoff],
      ),
      q<{ period: string; count: string }>(
        `SELECT TO_CHAR(DATE_TRUNC('${range.bucket}', created_at), 'YYYY-MM-DD') AS period, COUNT(*) AS count
         FROM converts WHERE created_at BETWEEN $1 AND $2
         GROUP BY 1 ORDER BY 1`,
        [fromTs, toTs],
      ),
      q<{ period: string; count: string }>(
        `SELECT TO_CHAR(DATE_TRUNC('${range.bucket}', first_timer_linked_at), 'YYYY-MM-DD') AS period, COUNT(*) AS count
         FROM converts WHERE first_timer_linked_at BETWEEN $1 AND $2
         GROUP BY 1 ORDER BY 1`,
        [fromTs, toTs],
      ),
      q<{ period: string; count: string }>(
        `SELECT TO_CHAR(DATE_TRUNC('${range.bucket}', linked_at), 'YYYY-MM-DD') AS period, COUNT(*) AS count
         FROM converts WHERE linked_at BETWEEN $1 AND $2
         GROUP BY 1 ORDER BY 1`,
        [fromTs, toTs],
      ),
      // Adder or outreach teammate, counted once per convert.
      q<{ member_id: string; brought_in: string; joined: string }>(
        `SELECT x.member_id,
                COUNT(DISTINCT x.convert_id) AS brought_in,
                COUNT(DISTINCT x.convert_id) FILTER (WHERE x.linked) AS joined
         FROM (
           SELECT c.id AS convert_id, c.onboarded_by AS member_id, c.member_id IS NOT NULL AS linked
           FROM converts c
           WHERE c.created_at BETWEEN $1 AND $2 AND c.onboarded_by IS NOT NULL
           UNION ALL
           SELECT c.id, ot.member_id, c.member_id IS NOT NULL
           FROM converts c JOIN outreach_team ot ON ot.outreach_id = c.outreach_id
           WHERE c.created_at BETWEEN $1 AND $2
         ) x
         GROUP BY x.member_id`,
        [fromTs, toTs],
      ),
      q<{ member_id: string; count: string }>(
        `SELECT ot.member_id, COUNT(*) AS count
         FROM outreach_team ot JOIN outreaches o ON o.id = ot.outreach_id
         WHERE o.outreach_date BETWEEN $1 AND $2
         GROUP BY ot.member_id`,
        [range.from, range.to],
      ),
      q<{ member_id: string; count: string }>(
        `SELECT logged_by AS member_id, COUNT(*) AS count
         FROM convert_follow_up_logs
         WHERE contacted_at BETWEEN $1 AND $2 AND logged_by IS NOT NULL
         GROUP BY logged_by`,
        [fromTs, toTs],
      ),
      q<{ member_id: string; open: string; overdue: string }>(
        `SELECT wp.member_id,
                COUNT(*) AS open,
                COUNT(*) FILTER (WHERE c.last_contacted_at IS NULL OR c.last_contacted_at < $1) AS overdue
         FROM converts c JOIN worker_profiles wp ON wp.id = c.assigned_to
         WHERE c.member_id IS NULL AND c.first_timer_id IS NULL
         GROUP BY wp.member_id`,
        [cutoff],
      ),
      q<{
        id: string;
        date: string;
        title: string | null;
        location: string | null;
        team_size: string;
        converts: string;
        saved: string;
        discipleship: string;
        visited: string;
        joined: string;
      }>(
        `SELECT o.id, TO_CHAR(o.outreach_date, 'YYYY-MM-DD') AS date, o.title, o.location,
                (SELECT COUNT(*) FROM outreach_team ot WHERE ot.outreach_id = o.id) AS team_size,
                COUNT(c.id) AS converts,
                COUNT(c.id) FILTER (WHERE c.status = $3) AS saved,
                COUNT(c.id) FILTER (WHERE c.status = $4) AS discipleship,
                COUNT(c.id) FILTER (WHERE c.first_timer_id IS NOT NULL OR c.member_id IS NOT NULL) AS visited,
                COUNT(c.id) FILTER (WHERE c.member_id IS NOT NULL) AS joined
         FROM outreaches o LEFT JOIN converts c ON c.outreach_id = o.id
         WHERE o.outreach_date BETWEEN $1 AND $2
         GROUP BY o.id
         ORDER BY o.outreach_date DESC, o.created_at DESC`,
        [
          range.from,
          range.to,
          ConvertStatusEnum.SAVED,
          ConvertStatusEnum.UNDERGOING_DISCIPLESHIP,
        ],
      ),
    ]);

    const byStatus = Object.fromEntries(
      Object.values(ConvertStatusEnum).map((s) => [s, 0]),
    ) as Record<ConvertStatusEnum, number>;
    for (const r of statusRows) byStatus[r.status] = Number(r.count);

    const byWorker = await this.mergeWorkerRows({
      broughtInRows,
      outreachTeamRows,
      followUpRows,
      assignedRows,
    });

    return {
      range,
      summary: {
        added: Object.values(byStatus).reduce((a, b) => a + b, 0),
        byStatus,
        visitedChurch: Number(visited?.count ?? 0),
        joinedChurch: Number(joined?.count ?? 0),
        followUpsLogged: Number(followUps?.count ?? 0),
        outreaches: Number(outreachCount?.count ?? 0),
        needsFollowUp: Number(current?.overdue ?? 0),
        unassigned: Number(current?.unassigned ?? 0),
      },
      trend: mergeTrend({
        added: addedTrend,
        visited: visitedTrend,
        joined: joinedTrend,
      }),
      byWorker,
      byOutreach: outreachRows.map((o) => ({
        id: o.id,
        date: o.date,
        title: o.title,
        location: o.location,
        teamSize: Number(o.team_size),
        converts: Number(o.converts),
        saved: Number(o.saved),
        discipleship: Number(o.discipleship),
        visitedChurch: Number(o.visited),
        joinedChurch: Number(o.joined),
      })),
    };
  }

  private async mergeWorkerRows(rows: {
    broughtInRows: { member_id: string; brought_in: string; joined: string }[];
    outreachTeamRows: { member_id: string; count: string }[];
    followUpRows: { member_id: string; count: string }[];
    assignedRows: { member_id: string; open: string; overdue: string }[];
  }): Promise<WorkerReportRow[]> {
    const byId = new Map<string, WorkerReportRow>();
    const row = (memberId: string) => {
      let r = byId.get(memberId);
      if (!r) {
        r = {
          memberId,
          name: '',
          outreaches: 0,
          broughtIn: 0,
          assignedOpen: 0,
          followUpsLogged: 0,
          overdue: 0,
          joinedChurch: 0,
        };
        byId.set(memberId, r);
      }
      return r;
    };
    for (const r of rows.broughtInRows) {
      row(r.member_id).broughtIn = Number(r.brought_in);
      row(r.member_id).joinedChurch = Number(r.joined);
    }
    for (const r of rows.outreachTeamRows) {
      row(r.member_id).outreaches = Number(r.count);
    }
    for (const r of rows.followUpRows) {
      row(r.member_id).followUpsLogged = Number(r.count);
    }
    for (const r of rows.assignedRows) {
      row(r.member_id).assignedOpen = Number(r.open);
      row(r.member_id).overdue = Number(r.overdue);
    }
    if (!byId.size) return [];

    const names = (await this.convertRepo.query(
      `SELECT id, firstname, lastname FROM members WHERE id = ANY($1)`,
      [[...byId.keys()]],
    )) as { id: string; firstname: string; lastname: string }[];
    for (const n of names) {
      const r = byId.get(n.id);
      if (r) r.name = `${n.firstname} ${n.lastname}`;
    }
    return [...byId.values()].sort(
      (a, b) =>
        b.broughtIn - a.broughtIn ||
        b.followUpsLogged - a.followUpsLogged ||
        a.name.localeCompare(b.name),
    );
  }
}

interface Range {
  from: string;
  to: string;
  bucket: 'week' | 'month';
}

export function resolveRange(from?: string, to?: string): Range {
  const toDate = to ? to.slice(0, 10) : isoDate(new Date());
  const fromDate = from
    ? from.slice(0, 10)
    : isoDate(new Date(Date.parse(toDate) - DEFAULT_RANGE_DAYS * DAY_MS));
  const days = (Date.parse(toDate) - Date.parse(fromDate)) / DAY_MS;
  return {
    from: fromDate,
    to: toDate,
    bucket: days <= WEEKLY_MAX_DAYS ? 'week' : 'month',
  };
}

function mergeTrend(
  series: Record<
    'added' | 'visited' | 'joined',
    { period: string; count: string }[]
  >,
): EvangelismReport['trend'] {
  const byPeriod = new Map<
    string,
    { added: number; visited: number; joined: number }
  >();
  for (const key of ['added', 'visited', 'joined'] as const) {
    for (const r of series[key]) {
      const entry = byPeriod.get(r.period) ?? {
        added: 0,
        visited: 0,
        joined: 0,
      };
      entry[key] = Number(r.count);
      byPeriod.set(r.period, entry);
    }
  }
  return [...byPeriod.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, v]) => ({ period, ...v }));
}

const STAGE_LABELS: Record<ConvertStage, string> = {
  MET: 'Met',
  FOLLOWED_UP: 'Followed up',
  WITH_FOLLOW_UP: 'Visited church (with Follow-Up)',
  JOINED: 'Joined church',
};

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

// Free-text cells starting with these would run as formulas in Excel/Sheets; plain numbers (+234… phones) are safe.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?[\d\s().]+$/;

export function toCsv(
  header: string[],
  rows: (string | number | null | undefined)[][],
): string {
  const cell = (v: string | number | null | undefined) => {
    if (typeof v === 'number') return String(v);
    const text = v ?? '';
    const safe =
      FORMULA_PREFIX.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n');
}
