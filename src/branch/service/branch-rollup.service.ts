import { overseerBranchKey } from '../../network-overseer/overseer.constants';
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { TenantRollup } from '../entity/tenant-rollup.entity';
import { Member } from '../../member/entity/member.entity';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { Attendance } from '../../attendance/entity/attendance.entity';
import { TitheRecord } from '../../tithe/entity/tithe-record.entity';
import { Subscription } from '../../billing/entity/subscription.entity';
import { CacheService } from '../../utility/service/cache.service';

// "Active in the last N days" — same window/definition of "attended" used
// by AttendanceService.getMyAttendanceSummary (PRESENT/LATE/ATTENDED_ONLINE,
// ON_LEAVE excluded from both sides of the ratio) so this rollup's
// attendanceRate means the same thing a member's own summary already means,
// just aggregated church-wide instead of per-member.
const ROLLUP_ATTENDANCE_WINDOW_DAYS = 30;

interface TenantStats {
  memberCount: number;
  attendanceRate: number | null;
  totalGiving: number;
}

// Computes and upserts ONE tenant's own tenant_rollups row, run from inside
// that tenant's own manually-entered CLS/transaction context — the same
// mechanism YoutubeLiveDetectionService uses to enter a tenant's context
// from outside any request (docs/MULTI_TENANT_MIGRATION.md §11.3's "local
// compute" — every tenant computes its own numbers against its own
// schema/shard, there is no cross-tenant read anywhere in this class).
@Injectable()
export class BranchRollupService {
  private readonly logger = new Logger(BranchRollupService.name);

  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(TenantRollup)
    private readonly rollupRepo: Repository<TenantRollup>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    @InjectRepository(Attendance)
    private readonly attendanceRepo: Repository<Attendance>,
    @InjectRepository(TitheRecord)
    private readonly titheRecordRepo: Repository<TitheRecord>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    private readonly cacheService: CacheService,
  ) {}

  private currentTenantId(): string {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) {
      throw new ForbiddenException('No tenant context for this request.');
    }
    return tenantId;
  }

  // Network figures always reach the churches above; only giving is the branch's own choice.
  async getGivingSharing(): Promise<{ shareGivingWithParent: boolean }> {
    const tenant = await this.tenantRepo.findOneOrFail({
      where: { id: this.currentTenantId() },
      select: { id: true, shareGivingWithParent: true },
    });
    return { shareGivingWithParent: tenant.shareGivingWithParent };
  }

  async setGivingSharing(
    shareGivingWithParent: boolean,
  ): Promise<{ shareGivingWithParent: boolean }> {
    await this.tenantRepo.update(this.currentTenantId(), {
      shareGivingWithParent,
    });
    this.cacheService.delGlobal(overseerBranchKey(this.currentTenantId()));
    return { shareGivingWithParent };
  }

  async computeAndUpsertOne(tenant: Tenant): Promise<void> {
    const stats = await this.cls.runWith(
      { tenantId: tenant.id, schemaName: tenant.schemaName } as AppClsStore,
      () =>
        this.txHost.withTransaction(async () => {
          await this.txHost.tx.query(
            `SET LOCAL search_path TO "${tenant.schemaName}", public`,
          );
          return this.computeTenantStats();
        }),
    );

    // Public-schema write — deliberately outside the block above, using the
    // plain (non-tenant-scoped) repository, same convention
    // YoutubeLiveDetectionService uses for its own public-row update after
    // leaving tenant context.
    await this.rollupRepo.save({
      tenantId: tenant.id,
      memberCount: stats.memberCount,
      attendanceRate: stats.attendanceRate,
      totalGiving: stats.totalGiving,
      computedAt: new Date(),
    });
  }

  private async computeTenantStats(): Promise<TenantStats> {
    const memberCount = await this.memberRepo.count({
      where: { status: MemberStatusEnum.ACTIVE },
    });

    const since = new Date();
    since.setDate(since.getDate() - ROLLUP_ATTENDANCE_WINDOW_DAYS);
    const attendanceRow = await this.attendanceRepo
      .createQueryBuilder('attendance')
      .select('COUNT(*)', 'total')
      .addSelect(
        `SUM(CASE WHEN attendance.status IN ('PRESENT','LATE','ATTENDED_ONLINE') THEN 1 ELSE 0 END)`,
        'attended',
      )
      .where('attendance.checkinTime >= :since', { since })
      .andWhere(`attendance.status != 'ON_LEAVE'`)
      .getRawOne<{ total: string; attended: string }>();

    const totalCount = Number.parseInt(attendanceRow?.total ?? '0', 10);
    const attendedCount = Number.parseInt(attendanceRow?.attended ?? '0', 10);
    const attendanceRate =
      totalCount === 0
        ? null
        : Math.round((attendedCount / totalCount) * 10000) / 100;

    const givingRow = await this.titheRecordRepo
      .createQueryBuilder('tithe')
      .select('COALESCE(SUM(tithe.amount), 0)', 'total')
      .getRawOne<{ total: string }>();
    const totalGiving = Number.parseFloat(givingRow?.total ?? '0');

    return { memberCount, attendanceRate, totalGiving };
  }
}
