import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Member } from '../../member/entity/member.entity';
import { TitheRecord } from '../../tithe/entity/tithe-record.entity';
import { PledgeContribution } from '../entity/pledge-contribution.entity';
import { CacheService } from '../../utility/service/cache.service';
import { UtilityService } from '../../utility/service/utility.service';
import { TenantCurrencyService } from '../../utility/service/tenant-currency.service';
import { PledgeContributionStatus } from '../enum/finance.enum';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';

@Injectable()
export class AnnualGivingStatementScheduler {
  private static readonly LOCK_KEY = 'lock:annual-giving-statements';
  private readonly logger = new Logger(AnnualGivingStatementScheduler.name);

  constructor(
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    @InjectRepository(TitheRecord)
    private readonly titheRecordRepo: Repository<TitheRecord>,
    @InjectRepository(PledgeContribution)
    private readonly contributionRepo: Repository<PledgeContribution>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly cacheService: CacheService,
    private readonly utilityService: UtilityService,
    private readonly configService: ConfigService,
    private readonly tenantCurrencyService: TenantCurrencyService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  @Cron('0 8 1 1 *', { timeZone: CHURCH_TIMEZONE })
  async sendAnnualStatements(): Promise<void> {
    if (!this.configService.get<boolean>('ANNUAL_GIVING_STATEMENT_ENABLED'))
      return;

    const acquired = await this.cacheService.acquireLock(
      AnnualGivingStatementScheduler.LOCK_KEY,
      3600,
    );
    if (!acquired) return;

    try {
      await forEachActiveTenant(
        this.tenantRepo,
        this.cls,
        this.txHost,
        this.logger,
        () => this.run(),
      );
    } finally {
      this.cacheService.releaseLock(AnnualGivingStatementScheduler.LOCK_KEY);
    }
  }

  async sendForMember(
    memberId: string,
  ): Promise<{ sent: boolean; year: number; total: number; message: string }> {
    const year = new Date().getFullYear() - 1;
    const result = await this.fetchMemberTotals(year, memberId);
    const row = result[0];
    if (!row || Number(row.total) === 0)
      return {
        sent: false,
        year,
        total: 0,
        message: `You have no recorded giving for ${year} yet.`,
      };

    const [member, currencyCode] = await Promise.all([
      this.memberRepo.findOne({ where: { id: memberId } }),
      this.tenantCurrencyService.resolveCurrencyCode(),
    ]);
    if (!member)
      return {
        sent: false,
        year,
        total: 0,
        message: 'Unable to send your giving statement right now.',
      };

    this.utilityService.sendEmailWithTemplate(
      member.email,
      'Annual Giving Statement',
      'annual-giving-statement',
      {
        memberName: `${member.firstname} ${member.lastname}`,
        year,
        total: Number(row.total).toFixed(2),
        lineCount: Number(row.lineCount),
        currency: currencyCode,
      },
    );
    return {
      sent: true,
      year,
      total: Number(row.total),
      message: `Your ${year} giving statement has been emailed to ${member.email}.`,
    };
  }

  private async run(): Promise<void> {
    const previousYear = new Date().getFullYear() - 1;

    const givingRows = await this.fetchMemberTotals(previousYear);
    if (givingRows.length === 0) return;

    const memberIds = givingRows.map((r) => r.memberId);
    const members = await this.memberRepo.findBy({
      id: In(memberIds),
      status: MemberStatusEnum.ACTIVE,
    });
    const memberMap = new Map(members.map((m) => [m.id, m]));
    // Resolved once per tenant, not per member — the caller (sendAnnualStatements)
    // wraps this in forEachActiveTenant, so CLS/search_path is already the
    // current tenant's when this runs.
    const currencyCode = await this.tenantCurrencyService.resolveCurrencyCode();

    let sent = 0;
    for (const row of givingRows) {
      const member = memberMap.get(row.memberId);
      if (!member) continue;
      try {
        this.utilityService.sendEmailWithTemplate(
          member.email,
          'Annual Giving Statement',
          'annual-giving-statement',
          {
            memberName: `${member.firstname} ${member.lastname}`,
            year: previousYear,
            total: Number(row.total).toFixed(2),
            lineCount: Number(row.lineCount),
            currency: currencyCode,
          },
        );
        sent++;
      } catch (err) {
        this.logger.error(
          `Failed to send annual giving statement to member ${member.id}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Annual giving statement scheduler: sent ${sent} statements for ${previousYear}`,
    );
  }

  /**
   * Sums giving directly from the actual giving records (TitheRecord +
   * CONFIRMED PledgeContribution) rather than finance_journal_entry_links —
   * nothing but fully-manual journal entry creation ever populates that link
   * table, so a link-based total is essentially always empty in practice.
   */
  private async fetchMemberTotals(year: number, memberId?: string) {
    const fromDate = `${year}-01-01`;
    const toDate = `${year}-12-31`;

    const titheQb = this.titheRecordRepo
      .createQueryBuilder('tr')
      .select('tr.member_id', 'memberId')
      .addSelect('SUM(tr.amount)', 'total')
      .addSelect('COUNT(tr.id)', 'lineCount')
      .where('tr.paymentDate >= :fromDate', { fromDate })
      .andWhere('tr.paymentDate <= :toDate', { toDate })
      .groupBy('tr.member_id');
    if (memberId) titheQb.andWhere('tr.member_id = :memberId', { memberId });

    const contributionQb = this.contributionRepo
      .createQueryBuilder('pc')
      .innerJoin('pc.pledge', 'p')
      .select('p.member_id', 'memberId')
      .addSelect('SUM(pc.amount)', 'total')
      .addSelect('COUNT(pc.id)', 'lineCount')
      .where('pc.status = :status', {
        status: PledgeContributionStatus.CONFIRMED,
      })
      .andWhere('pc.paymentDate >= :fromDate', { fromDate })
      .andWhere('pc.paymentDate <= :toDate', { toDate })
      .groupBy('p.member_id');
    if (memberId)
      contributionQb.andWhere('p.member_id = :memberId', { memberId });

    const [titheRows, contributionRows] = await Promise.all([
      titheQb.getRawMany<{
        memberId: string;
        total: string;
        lineCount: string;
      }>(),
      contributionQb.getRawMany<{
        memberId: string;
        total: string;
        lineCount: string;
      }>(),
    ]);

    const totals = new Map<string, { total: number; lineCount: number }>();
    for (const row of [...titheRows, ...contributionRows]) {
      const existing = totals.get(row.memberId) ?? {
        total: 0,
        lineCount: 0,
      };
      existing.total += Number(row.total);
      existing.lineCount += Number(row.lineCount);
      totals.set(row.memberId, existing);
    }

    return Array.from(totals.entries())
      .map(([memberId, v]) => ({
        memberId,
        total: String(v.total),
        lineCount: String(v.lineCount),
      }))
      .filter((r) => Number(r.total) > 0);
  }
}
