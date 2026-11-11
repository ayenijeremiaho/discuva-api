import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';
import { MemberService } from '../../member/service/member.service';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import {
  TitheService,
  GivingSummaryView,
} from '../../tithe/service/tithe.service';
import { CacheService } from '../../utility/service/cache.service';
import {
  NetworkTransfer,
  NetworkTransferStatus,
} from '../entity/network-transfer.entity';
import { NetworkService } from './network.service';

const HISTORY_TTL_SECONDS = 24 * 60 * 60;

export interface PastBranch {
  tenantId: string;
  path: string;
  movedAt: Date;
}

export interface BranchHistory {
  path: string;
  currency: string;
  joinedOn: string | null;
  movedAt: Date;
  attendance: {
    total: number;
    last: string | null;
    byYear: { year: number; count: number }[];
  };
  giving: GivingSummaryView;
}

// A member's own record at branches they moved away from: read-only, read on request, never copied.
@Injectable()
export class BranchHistoryService {
  constructor(
    @InjectRepository(NetworkTransfer)
    private readonly transferRepo: Repository<NetworkTransfer>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly network: NetworkService,
    private readonly memberService: MemberService,
    private readonly tithes: TitheService,
    private readonly cache: CacheService,
    private readonly dataSource: DataSource,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async list(memberId: string): Promise<PastBranch[]> {
    const accountId = await this.accountOf(memberId);
    if (!accountId) return [];
    const moves = await this.latestMovesFrom(accountId);
    if (!moves.length) return [];
    const paths = await this.network.pathsOf(
      moves[0].networkRootId,
      moves.map((m) => m.fromTenantId),
    );
    return moves
      .filter((m) => paths.has(m.fromTenantId))
      .map((m) => ({
        tenantId: m.fromTenantId,
        path: paths.get(m.fromTenantId)!,
        movedAt: m.decidedAt!,
      }));
  }

  async detail(
    memberId: string,
    tenantId: string,
    year?: number,
  ): Promise<BranchHistory> {
    const { move, church } = await this.pastRecord(memberId, tenantId);
    const givingYear = year ?? new Date().getFullYear();
    const key = `branch-history:${move.fromMemberId}:${givingYear}`;
    const cached = await this.cache.getGlobal<BranchHistory>(key);
    if (cached) return cached;

    const paths = await this.network.pathsOf(move.networkRootId, [tenantId]);
    const history = await this.inChurch(church, async () => {
      const old = await this.memberService.getById(move.fromMemberId);
      if (old.status !== MemberStatusEnum.TRANSFERRED) {
        throw new NotFoundException('That branch is your current one.');
      }
      const [attendance, giving] = await Promise.all([
        this.attendanceOf(church.schemaName, old.id),
        this.tithes.getMyGivingSummary(
          { id: old.id, role: MemberRoleEnum.MEMBER } as never,
          givingYear,
        ),
      ]);
      return {
        path: paths.get(tenantId) ?? '',
        currency: church.currency,
        joinedOn: old.dateJoinedChurch
          ? new Date(old.dateJoinedChurch).toISOString().slice(0, 10)
          : null,
        movedAt: old.transferredAt ?? move.decidedAt!,
        attendance,
        giving,
      };
    });
    this.cache.setGlobal(key, history, HISTORY_TTL_SECONDS);
    return history;
  }

  // Emailed from the old branch, so it carries that branch's name and look.
  async emailStatement(
    memberId: string,
    tenantId: string,
    fromMonth?: string,
    toMonth?: string,
  ): Promise<{ message: string; recordCount: number }> {
    const { move, church } = await this.pastRecord(memberId, tenantId);
    return this.inChurch(church, () =>
      this.tithes.emailGivingStatement(
        { id: move.fromMemberId, role: MemberRoleEnum.MEMBER } as never,
        fromMonth,
        toMonth,
      ),
    );
  }

  private async pastRecord(memberId: string, tenantId: string) {
    const accountId = await this.accountOf(memberId);
    const move = accountId
      ? (await this.latestMovesFrom(accountId)).find(
          (m) => m.fromTenantId === tenantId,
        )
      : undefined;
    const church = move
      ? await this.tenantRepo.findOne({
          where: { id: tenantId, isActive: true },
          select: { id: true, schemaName: true, currency: true },
        })
      : null;
    if (!move || !church)
      throw new NotFoundException('No history at that branch.');
    return { move, church };
  }

  // The latest completed move out of each branch, leaving out the one they're in now.
  private async latestMovesFrom(accountId: string): Promise<NetworkTransfer[]> {
    const done = await this.transferRepo.find({
      where: { accountId, status: NetworkTransferStatus.DONE },
      order: { decidedAt: 'DESC' },
      take: 50,
    });
    const here = this.cls.get('tenantId');
    const seen = new Set<string>();
    return done.filter((m) => {
      if (m.fromTenantId === here || seen.has(m.fromTenantId)) return false;
      seen.add(m.fromTenantId);
      return true;
    });
  }

  private async accountOf(memberId: string): Promise<string | null> {
    return (await this.memberService.getById(memberId)).discuvaAccountId;
  }

  private async attendanceOf(schema: string, memberId: string) {
    const rows: { year: number; count: number; last: string }[] =
      await this.dataSource.query(
        `SELECT EXTRACT(YEAR FROM created_at)::int AS year, COUNT(*)::int AS count, MAX(created_at) AS last
         FROM "${schema}".attendances WHERE member_id = $1 GROUP BY 1 ORDER BY 1 DESC`,
        [memberId],
      );
    const last = rows.reduce<string | null>(
      (max, r) => (!max || r.last > max ? r.last : max),
      null,
    );
    return {
      total: rows.reduce((sum, r) => sum + r.count, 0),
      last: last ? new Date(last).toISOString() : null,
      byYear: rows.map((r) => ({ year: r.year, count: r.count })),
    };
  }

  private inChurch<T>(
    church: Pick<Tenant, 'id' | 'schemaName'>,
    fn: () => Promise<T>,
  ): Promise<T> {
    return runInTenantContext(
      this.cls,
      this.txHost,
      { tenantId: church.id, schemaName: church.schemaName },
      fn,
    );
  }
}
