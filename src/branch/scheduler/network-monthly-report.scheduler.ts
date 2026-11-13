import { DiscuvaAccountService } from '../../discuva-account/service/discuva-account.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';
import { CacheService } from '../../utility/service/cache.service';
import { UtilityService } from '../../utility/service/utility.service';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';
import { NetworkService } from '../service/network.service';
import {
  Figure,
  NetworkReport,
  NetworkReportService,
} from '../service/network-report.service';
import { periodOf, previousPeriod } from '../service/network-rollup.service';

const LOCK = 'lock:network-monthly-report';
const MAX_ATTENTION = 8;

const show = (f: Figure | undefined): string =>
  f === 'FEWER_THAN_5'
    ? 'fewer than 5'
    : f === null || f === undefined
      ? '—'
      : Number(f).toLocaleString('en-GB');

export function monthLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function emailFigures(
  report: NetworkReport,
): { label: string; value: string }[] {
  const t = report.totals;
  const services = typeof t.services === 'number' ? t.services : 0;
  const attendance = typeof t.attendance === 'number' ? t.attendance : 0;
  return [
    { label: 'Members', value: show(t.members) },
    { label: 'New members', value: show(t.newMembers) },
    { label: 'First-timers', value: show(t.firstTimers) },
    { label: 'First-timers who came back', value: show(t.returnedTwice) },
    {
      label: 'Average in-person attendance per service',
      value: services
        ? Math.round(attendance / services).toLocaleString('en-GB')
        : '—',
    },
    { label: 'Moves between branches', value: show(t.transfersIn) },
    { label: 'Visits between branches', value: show(t.visitorsIn) },
    { label: 'Class completions', value: show(t.classCompletions) },
  ];
}

// On the 8th, once last month has frozen: owners of every church with branches get last month across everything under it.
@Injectable()
export class NetworkMonthlyReportScheduler {
  private readonly logger = new Logger(NetworkMonthlyReportScheduler.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly network: NetworkService,
    private readonly reports: NetworkReportService,
    private readonly utility: UtilityService,
    private readonly cache: CacheService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly accounts: DiscuvaAccountService,
  ) {}

  @Cron('0 7 8 * *', { timeZone: CHURCH_TIMEZONE })
  async sendAll(): Promise<void> {
    if (await this.accounts.networksOff()) return;
    if (!(await this.cache.acquireLock(LOCK, 3600))) return;
    try {
      // Churches with at least one active branch directly under them.
      const parents: Pick<
        Tenant,
        'id' | 'schemaName' | 'networkRootId' | 'timezone'
      >[] = await this.dataSource.query(
        `SELECT t.id, t.schema_name AS "schemaName", t.network_root_id AS "networkRootId", t.timezone
           FROM tenants t
          WHERE t.is_active = true AND t.network_root_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM tenants c WHERE c.network_root_id = t.network_root_id AND c.parent_tenant_id = t.id AND c.is_active = true)`,
      );
      let sent = 0;
      for (const parent of parents) {
        try {
          sent += await this.sendOne(parent);
        } catch (err) {
          this.logger.warn(
            `Monthly network report for ${parent.id} failed: ${(err as Error).message}`,
          );
        }
      }
      this.logger.log(
        `Monthly network report sent to ${sent} owner(s) across ${parents.length} church(es)`,
      );
    } finally {
      this.cache.releaseLock(LOCK);
    }
  }

  // Inside the church's own context: the switch is checked for it, and the email carries its look.
  async sendOne(
    parent: Pick<Tenant, 'id' | 'schemaName' | 'networkRootId' | 'timezone'>,
  ): Promise<number> {
    return runInTenantContext(
      this.cls,
      this.txHost,
      { tenantId: parent.id, schemaName: parent.schemaName },
      async () => {
        if (!(await this.network.isAvailable())) return 0;
        const tz = parent.timezone || 'UTC';
        const period = previousPeriod(periodOf(new Date(), tz));
        const [report, current] = await Promise.all([
          this.reports.reportFor(parent.id, parent.networkRootId!, tz, period),
          this.reports.reportFor(parent.id, parent.networkRootId!, tz),
        ]);
        const data = {
          month_label: monthLabel(period),
          branch_count: String(report.churches.length - 1),
          figures: emailFigures(report),
          attention: current.attention
            .slice(0, MAX_ATTENTION)
            .map((a) => ({ path: a.path, detail: a.detail })),
        };
        const owners: { email: string; firstname: string }[] =
          await this.txHost.tx.query(
            `SELECT m.email, m.firstname FROM admins a JOIN members m ON m.id = a.member_id WHERE a.is_owner = true AND a.is_active = true`,
          );
        for (const owner of owners) {
          const name = UtilityService.capitalizeFirstLetter(owner.firstname);
          this.utility.sendEmailWithTemplate(
            owner.email,
            `${name}, Your Network in ${data.month_label}`,
            'network-monthly-report',
            {
              name,
              ...data,
            },
          );
        }
        return owners.length;
      },
    );
  }
}
