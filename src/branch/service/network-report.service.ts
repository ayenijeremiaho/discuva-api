import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { CacheService } from '../../utility/service/cache.service';
import { NetworkRollup } from '../entity/network-rollup.entity';
import {
  AttentionKind,
  BranchMetrics,
  LOW_COUNT_KEYS,
} from '../report/network-report.types';
import { NetworkService } from './network.service';
import {
  OPEN_UNTIL_DAY,
  periodOf,
  previousPeriod,
  rollupVersionKey,
} from './network-rollup.service';

const CACHE_SECONDS = 3600;
const MONTHS_LISTED = 12;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

// A count of people from 1 to 4 is never shown in these views.
export type Figure = number | 'FEWER_THAN_5' | null;

export interface ReportChurch {
  id: string;
  path: string;
  computedAt: Date | null;
  figures: Record<keyof BranchMetrics, Figure>;
  perHundred: Partial<Record<keyof BranchMetrics, number | null>>;
  attendancePerService: number | null;
  onlinePercent: number | null;
  contactedPercent: number | null;
}

export interface NetworkReport {
  period: string;
  periods: string[];
  final: boolean;
  updatedAt: Date | null;
  churches: ReportChurch[];
  totals: Record<keyof BranchMetrics, Figure>;
  median: Partial<Record<keyof BranchMetrics, Figure>>;
  attention: {
    churchId: string;
    path: string;
    kind: AttentionKind;
    detail: string;
  }[];
}

const mask = (key: keyof BranchMetrics, value: number | null): Figure =>
  value !== null && value > 0 && value < 5 && LOW_COUNT_KEYS.includes(key)
    ? 'FEWER_THAN_5'
    : value;

const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : null;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2
    ? s[mid]
    : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
}

// Oversight pages: figures for the current church and everything under it, read only from the root table.
@Injectable()
export class NetworkReportService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(NetworkRollup)
    private readonly rollupRepo: Repository<NetworkRollup>,
    private readonly network: NetworkService,
    private readonly cache: CacheService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async report(month?: string): Promise<NetworkReport> {
    if (month && !PERIOD.test(month))
      throw new BadRequestException('Month must be YYYY-MM.');
    if (!(await this.network.isAvailable()))
      throw new NotFoundException('Church networks are not available yet.');
    const here = await this.tenantRepo.findOne({
      where: { id: this.cls.get('tenantId') },
      select: { id: true, networkRootId: true, timezone: true },
    });
    if (!here?.networkRootId)
      throw new NotFoundException('Your church is not part of a network.');
    return this.reportFor(
      here.id,
      here.networkRootId,
      here.timezone || 'UTC',
      month,
    );
  }

  // Also used for the monthly email, outside any request.
  async reportFor(
    churchId: string,
    rootId: string,
    timeZone: string,
    month?: string,
  ): Promise<NetworkReport> {
    const now = new Date();
    const current = periodOf(now, timeZone);
    const period = month ?? current;
    const version =
      (await this.cache.getGlobal<number>(rollupVersionKey(rootId))) ?? 0;
    const key = `network-report:${churchId}:${period}:${version}`;
    const cached = await this.cache.getGlobal<NetworkReport>(key);
    if (cached) return cached;

    const tree = await this.network.loadTree(rootId);
    const ids = this.network
      .subtreeIds(tree, churchId)
      .filter((id) => tree.byId.get(id)?.isActive);
    const [rows, paths] = await Promise.all([
      this.rollupRepo.find({
        where: { networkRootId: rootId, period, tenantId: In(ids) },
      }),
      this.network.pathsOf(rootId, ids),
    ]);
    const byId = new Map(rows.map((r) => [r.tenantId, r]));
    const metricKeys = (
      rows[0] ? Object.keys(rows[0].metrics) : []
    ) as (keyof BranchMetrics)[];

    const churches: ReportChurch[] = ids.map((id) => {
      const m = byId.get(id)?.metrics;
      const figures = Object.fromEntries(
        metricKeys.map((k) => [k, m ? mask(k, m[k] as number | null) : null]),
      ) as Record<keyof BranchMetrics, Figure>;
      const perHundred = Object.fromEntries(
        LOW_COUNT_KEYS.map((k) => {
          const v = m?.[k] as number | undefined;
          return [
            k,
            m && m.members > 0 && v !== undefined && v >= 5
              ? Math.round((v / m.members) * 1000) / 10
              : null,
          ];
        }),
      );
      return {
        id,
        path: paths.get(id) ?? '',
        computedAt: byId.get(id)?.computedAt ?? null,
        figures,
        perHundred,
        attendancePerService:
          m && m.services ? Math.round(m.attendance / m.services) : null,
        onlinePercent: m ? pct(m.online, m.attendance + m.online) : null,
        contactedPercent:
          m && m.firstTimers >= 5
            ? pct(m.contactedInWeek, m.firstTimers)
            : null,
      };
    });

    const totals = Object.fromEntries(
      metricKeys.map((k) => {
        if (k === 'ratingAverage') {
          const rated = rows.filter((r) => r.metrics.ratingCount > 0);
          const count = rated.reduce((s, r) => s + r.metrics.ratingCount, 0);
          const avg = count
            ? rated.reduce(
                (s, r) =>
                  s + (r.metrics.ratingAverage ?? 0) * r.metrics.ratingCount,
                0,
              ) / count
            : null;
          return [k, avg === null ? null : Math.round(avg * 100) / 100];
        }
        if (k === 'giving') {
          const sharing = rows.filter((r) => r.metrics.giving !== null);
          return [
            k,
            sharing.length
              ? sharing.reduce((s, r) => s + (r.metrics.giving ?? 0), 0)
              : null,
          ];
        }
        return [
          k,
          mask(
            k,
            rows.reduce((s, r) => s + ((r.metrics[k] as number) ?? 0), 0),
          ),
        ];
      }),
    ) as Record<keyof BranchMetrics, Figure>;

    const medianOf = Object.fromEntries(
      metricKeys
        .filter((k) => k !== 'giving')
        .map((k) => [
          k,
          mask(
            k,
            median(
              rows
                .map((r) => r.metrics[k])
                .filter((v): v is number => typeof v === 'number'),
            ),
          ),
        ]),
    );

    const report: NetworkReport = {
      period,
      periods: this.recentPeriods(current),
      final: this.isFinal(period, current, now, timeZone),
      updatedAt: rows.reduce<Date | null>(
        (latest, r) =>
          !latest || r.computedAt > latest ? r.computedAt : latest,
        null,
      ),
      churches,
      totals,
      median: medianOf,
      attention:
        period === current
          ? rows.flatMap((r) =>
              r.attention.map((a) => ({
                churchId: r.tenantId,
                path: paths.get(r.tenantId) ?? '',
                ...a,
              })),
            )
          : [],
    };
    this.cache.setGlobal(key, report, CACHE_SECONDS);
    return report;
  }

  private recentPeriods(current: string): string[] {
    const out = [current];
    while (out.length < MONTHS_LISTED)
      out.push(previousPeriod(out[out.length - 1]));
    return out;
  }

  // Past months stop changing once the 7th of the next month has gone by.
  private isFinal(
    period: string,
    current: string,
    now: Date,
    timeZone: string,
  ): boolean {
    if (period >= current) return false;
    if (period !== previousPeriod(current)) return true;
    const day = Number(
      new Intl.DateTimeFormat('en-CA', { timeZone, day: '2-digit' }).format(
        now,
      ),
    );
    return day > OPEN_UNTIL_DAY;
  }
}
