import { BadRequestException, Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { FirstTimerCardService } from './first-timer-card.service';
import { FirstTimerAnswer } from '../entity/first-timer.entity';
import {
  CHOICE_FIELD_TYPES,
  FirstTimerFieldType,
  FirstTimerSourceEnum,
  FollowUpOutcomeEnum,
  FollowUpTaskStatusEnum,
  FollowUpTaskTypeEnum,
} from '../enums/follow-up.enum';
import { CacheService } from '../../utility/service/cache.service';

const REPORT_CACHE_TTL = 300;
// Quotes are read aloud at meetings; past this many a month the list stops being useful.
const MAX_QUOTES = 100;
const MAX_ROWS = 3000;

export const OUTCOME_LABELS: Record<FollowUpOutcomeEnum, string> = {
  [FollowUpOutcomeEnum.STILL_ATTENDING]: 'Still attending',
  [FollowUpOutcomeEnum.JOINED]: 'Joined',
  [FollowUpOutcomeEnum.TEMPORARILY_AWAY]: 'Temporarily away',
  [FollowUpOutcomeEnum.RELOCATED]: 'Relocated',
  [FollowUpOutcomeEnum.DECLINED]: 'Declined',
  [FollowUpOutcomeEnum.PRAYED_WITH]: 'Prayed with',
  [FollowUpOutcomeEnum.NO_ANSWER]: 'No answer',
};

export const SOURCE_LABELS: Record<FirstTimerSourceEnum, string> = {
  [FirstTimerSourceEnum.WALK_IN]: 'Walk-in',
  [FirstTimerSourceEnum.ONLINE]: 'Online form',
  [FirstTimerSourceEnum.REFERRAL]: 'Referral',
  [FirstTimerSourceEnum.SUNDAY_SCHOOL]: 'Sunday school',
  [FirstTimerSourceEnum.APP_SIGNUP]: 'App sign-up',
};

export interface Quote {
  name: string;
  text: string;
}

export interface ReportField {
  id: string;
  key: string | null;
  label: string;
  type: FirstTimerFieldType;
  answered: number;
  counts?: { option: string; count: number }[];
  quotes?: Quote[];
}

export interface FollowUpMonthlyReport {
  month: string;
  from: string;
  to: string;
  totals: {
    firstTimers: number;
    wantsToJoinChurch: number;
    wantsToJoinWorkforce: number;
  };
  byDate: { date: string; count: number }[];
  strongestDay: { date: string; count: number } | null;
  services: {
    date: string;
    eventName: string | null;
    count: number;
    attendedBy: string[];
  }[];
  bySource: { source: string; label: string; count: number }[];
  liked: Quote[];
  fields: ReportField[];
  // Plain sentences for the top of the report: what went well, and what the team should look at.
  highlights: { good: string[]; watch: string[] };
  recap: {
    month: string;
    firstTimers: number;
    wantedToJoin: number;
    outcomes: { outcome: FollowUpOutcomeEnum; label: string; count: number }[];
    unreachable: number;
    notYetReached: number;
  };
}

interface MonthRow {
  firstname: string;
  visitedOn: string;
  source: FirstTimerSourceEnum;
  wantsToJoinChurch: boolean;
  wantsToJoinWorkforce: boolean;
  enjoyedAboutChurch: string | null;
  answers: Record<string, FirstTimerAnswer>;
  eventName: string | null;
}

interface RecapRow {
  wants: boolean;
  status: FollowUpTaskStatusEnum | null;
  outcome: FollowUpOutcomeEnum | null;
  count: string;
}

function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, '0')}`,
  };
}

function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

const pct = (n: number, of: number) => Math.round((n / of) * 100);
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

// Thresholds are deliberately simple; they point the team at what to discuss, not grade it.
export function highlightsOf(
  r: Omit<FollowUpMonthlyReport, 'highlights'>,
): FollowUpMonthlyReport['highlights'] {
  const good: string[] = [];
  const watch: string[] = [];
  const { totals, recap } = r;

  if (recap.firstTimers > 0 && totals.firstTimers > 0) {
    const change = pct(
      totals.firstTimers - recap.firstTimers,
      recap.firstTimers,
    );
    if (change >= 10)
      good.push(`First-timers are up ${change}% on last month.`);
    else if (change <= -10)
      watch.push(
        `First-timers are down ${-change}% on last month (${totals.firstTimers}, against ${recap.firstTimers}).`,
      );
  }

  if (totals.firstTimers >= 5) {
    const joining = pct(totals.wantsToJoinChurch, totals.firstTimers);
    if (joining >= 40) good.push(`${joining}% of first-timers want to join.`);
    else if (joining < 20)
      watch.push(`Only ${joining}% of first-timers said they want to join.`);
  }

  if (r.strongestDay && r.byDate.length > 1)
    good.push(
      `The busiest day brought ${plural(r.strongestDay.count, 'first-timer')}.`,
    );

  const heard = r.fields.find((f) => f.key === 'heard_from');
  const top = heard?.counts?.find((c) => c.count > 0 && c.option !== 'Other');
  if (top)
    good.push(
      `"${top.option}" is how most first-timers heard about you (${top.count}).`,
    );

  if (recap.wantedToJoin > 0) {
    const stayed = recap.outcomes
      .filter(
        (o) =>
          o.outcome === FollowUpOutcomeEnum.STILL_ATTENDING ||
          o.outcome === FollowUpOutcomeEnum.JOINED,
      )
      .reduce((sum, o) => sum + o.count, 0);
    const stayedPct = pct(stayed, recap.wantedToJoin);
    if (stayedPct >= 50)
      good.push(
        `${stayed} of last month's ${recap.wantedToJoin} who wanted to join are still with you (${stayedPct}%).`,
      );
    else if (stayed > 0)
      watch.push(
        `${stayed} of last month's ${recap.wantedToJoin} who wanted to join are still attending (${stayedPct}%).`,
      );
    if (pct(recap.unreachable, recap.wantedToJoin) >= 20)
      watch.push(
        `${recap.unreachable} of last month's first-timers couldn't be reached (${pct(recap.unreachable, recap.wantedToJoin)}%). Check that phone numbers are taken down clearly.`,
      );
    if (recap.notYetReached > 0)
      watch.push(
        `${plural(recap.notYetReached, 'person', 'people')} from last month still haven't been followed up.`,
      );
  }

  const better = r.fields.find((f) => f.key === 'improve')?.quotes?.length ?? 0;
  if (better)
    watch.push(
      `${plural(better, 'suggestion')} on what to do better. They're at the end of this report.`,
    );

  return { good, watch };
}

@Injectable()
export class FollowUpMonthlyReportService {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly cardService: FirstTimerCardService,
    private readonly cacheService: CacheService,
  ) {}

  getReport(month: string): Promise<FollowUpMonthlyReport> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw new BadRequestException('Month must look like 2026-10.');
    return this.cacheService.getOrSet(
      `follow-up:report:monthly:${month}`,
      () => this.build(month),
      REPORT_CACHE_TTL,
    );
  }

  private async build(month: string): Promise<FollowUpMonthlyReport> {
    const { from, to } = monthBounds(month);
    const recapMonth = previousMonth(month);
    const recapRange = monthBounds(recapMonth);

    const [rows, recapRows, fields] = await Promise.all([
      this.txHost.tx.query<MonthRow[]>(
        `SELECT ft.firstname,
                to_char(ft.visited_on, 'YYYY-MM-DD') AS "visitedOn",
                ft.source,
                ft.wants_to_join_church AS "wantsToJoinChurch",
                ft.wants_to_join_workforce AS "wantsToJoinWorkforce",
                ft.enjoyed_about_church AS "enjoyedAboutChurch",
                ft.answers,
                e.name AS "eventName"
           FROM first_timers ft
           LEFT JOIN events e ON e.id = ft.visited_event_id
          WHERE ft.visited_on BETWEEN $1 AND $2
          ORDER BY ft.visited_on, ft.created_at
          LIMIT ${MAX_ROWS}`,
        [from, to],
      ),
      this.txHost.tx.query<RecapRow[]>(
        `SELECT ft.wants_to_join_church AS wants, t.status, t.outcome, COUNT(*) AS count
           FROM first_timers ft
           LEFT JOIN follow_up_tasks t
             ON t.first_timer_id = ft.id AND t.type = $3
          WHERE ft.visited_on BETWEEN $1 AND $2
          GROUP BY 1, 2, 3`,
        [recapRange.from, recapRange.to, FollowUpTaskTypeEnum.FIRST_TIMER],
      ),
      this.cardService.findAll(),
    ]);

    const attendedBy = fields.find((f) => f.key === 'attended_by');

    const dates = new Map<string, number>();
    const services = new Map<
      string,
      {
        date: string;
        eventName: string | null;
        count: number;
        attendedBy: Set<string>;
      }
    >();
    const sources = new Map<string, number>();
    const liked: Quote[] = [];
    for (const r of rows) {
      dates.set(r.visitedOn, (dates.get(r.visitedOn) ?? 0) + 1);
      const key = `${r.visitedOn}|${r.eventName ?? ''}`;
      const service = services.get(key) ?? {
        date: r.visitedOn,
        eventName: r.eventName,
        count: 0,
        attendedBy: new Set<string>(),
      };
      service.count++;
      const minister = attendedBy && r.answers?.[attendedBy.id];
      if (typeof minister === 'string' && minister.trim())
        service.attendedBy.add(minister.trim());
      services.set(key, service);
      sources.set(r.source, (sources.get(r.source) ?? 0) + 1);
      if (r.enjoyedAboutChurch?.trim() && liked.length < MAX_QUOTES)
        liked.push({ name: r.firstname, text: r.enjoyedAboutChurch.trim() });
    }

    const byDate = [...dates].map(([date, count]) => ({ date, count }));
    const strongestDay = byDate.reduce<{ date: string; count: number } | null>(
      (best, d) => (!best || d.count > best.count ? d : best),
      null,
    );

    const report: Omit<FollowUpMonthlyReport, 'highlights'> = {
      month,
      from,
      to,
      totals: {
        firstTimers: rows.length,
        wantsToJoinChurch: rows.filter((r) => r.wantsToJoinChurch).length,
        wantsToJoinWorkforce: rows.filter((r) => r.wantsToJoinWorkforce).length,
      },
      byDate,
      strongestDay,
      services: [...services.values()].map((s) => ({
        ...s,
        attendedBy: [...s.attendedBy],
      })),
      bySource: [...sources]
        .map(([source, count]) => ({
          source,
          label: SOURCE_LABELS[source as FirstTimerSourceEnum] ?? source,
          count,
        }))
        .sort((a, b) => b.count - a.count),
      liked,
      fields: fields
        .filter((f) => f.inReport && f.id !== attendedBy?.id)
        .map((f) => this.summarise(f, rows))
        .filter((f) => f.answered > 0),
      recap: this.recap(recapMonth, recapRows),
    };
    return { ...report, highlights: highlightsOf(report) };
  }

  private summarise(
    field: {
      id: string;
      key: string | null;
      label: string;
      type: FirstTimerFieldType;
      options: string[];
    },
    rows: MonthRow[],
  ): ReportField {
    const answers = rows
      .map((r) => ({ name: r.firstname, value: r.answers?.[field.id] }))
      .filter(
        (a) => a.value !== undefined && a.value !== null && a.value !== '',
      );
    const base = {
      id: field.id,
      key: field.key,
      label: field.label,
      type: field.type,
      answered: answers.length,
    };

    if (field.type === FirstTimerFieldType.YES_NO) {
      const yes = answers.filter((a) => a.value === true).length;
      return {
        ...base,
        counts: [
          { option: 'Yes', count: yes },
          { option: 'No', count: answers.length - yes },
        ],
      };
    }
    if (CHOICE_FIELD_TYPES.has(field.type)) {
      const tally = new Map<string, number>(field.options.map((o) => [o, 0]));
      for (const a of answers)
        for (const v of Array.isArray(a.value) ? a.value : [a.value])
          tally.set(String(v), (tally.get(String(v)) ?? 0) + 1);
      return {
        ...base,
        counts: [...tally]
          .map(([option, count]) => ({ option, count }))
          .sort((a, b) => b.count - a.count),
      };
    }
    return {
      ...base,
      quotes: answers
        .slice(0, MAX_QUOTES)
        .map((a) => ({ name: a.name, text: String(a.value) })),
    };
  }

  private recap(
    month: string,
    rows: RecapRow[],
  ): FollowUpMonthlyReport['recap'] {
    const wanted = rows.filter((r) => r.wants);
    const outcomeCounts = new Map<FollowUpOutcomeEnum, number>();
    let unreachable = 0;
    let notYetReached = 0;
    for (const r of wanted) {
      const n = Number(r.count);
      if (r.outcome)
        outcomeCounts.set(r.outcome, (outcomeCounts.get(r.outcome) ?? 0) + n);
      else if (r.status === FollowUpTaskStatusEnum.UNREACHABLE)
        unreachable += n;
      else notYetReached += n;
    }
    return {
      month,
      firstTimers: rows.reduce((sum, r) => sum + Number(r.count), 0),
      wantedToJoin: wanted.reduce((sum, r) => sum + Number(r.count), 0),
      outcomes: (Object.keys(OUTCOME_LABELS) as FollowUpOutcomeEnum[])
        .filter((o) => outcomeCounts.get(o))
        .map((outcome) => ({
          outcome,
          label: OUTCOME_LABELS[outcome],
          count: outcomeCounts.get(outcome)!,
        })),
      unreachable,
      notYetReached,
    };
  }
}
