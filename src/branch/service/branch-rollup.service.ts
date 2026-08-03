import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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
import { SubscriptionStatus } from '../../billing/enum/subscription-status.enum';
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

export interface BranchOverviewItem {
  tenantId: string;
  name: string;
  subdomain: string;
  // null (not 0) whenever sharingEnabled is false — distinct from "shared,
  // but genuinely zero so far".
  memberCount: number | null;
  attendanceRate: number | null;
  totalGiving: number | null;
  computedAt: Date | null;
  // False means this branch has shareDataWithParent off — every stat above
  // is null, not because nothing's been computed, but because the branch
  // hasn't consented to share it with this parent.
  sharingEnabled: boolean;
  // Only meaningful when sharingEnabled is true — a branch can share
  // engagement stats while still keeping giving specifically private.
  givingShared: boolean;
}

export interface BranchSharingConsent {
  shareDataWithParent: boolean;
  shareGivingWithParent: boolean;
  // Null means this tenant isn't a branch of anything right now — the
  // frontend's only way to know whether "Leave Parent" is even relevant to
  // show, short of calling leaveParent() itself and handling its 400.
  parentTenantId: string | null;
  parentTenantName: string | null;
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

  // Parent's overview reads only public.tenant_rollups WHERE tenant_id IN
  // (children of this tenant) — never reaches into a branch's own schema or
  // shard, exactly as designed in §11.3. This is the read half of the
  // "local compute, pushed rollups" design; computeAndUpsertOne is the
  // write half, run entirely separately by the daily cron.
  async getOverview(): Promise<BranchOverviewItem[]> {
    const parentTenantId = this.currentTenantId();

    const branches = await this.tenantRepo.find({
      where: { parentTenantId },
      order: { name: 'ASC' },
    });
    if (!branches.length) return [];

    const rollups = await this.rollupRepo.findBy({
      tenantId: In(branches.map((b) => b.id)),
    });
    const rollupByTenantId = new Map(rollups.map((r) => [r.tenantId, r]));

    return branches.map((branch) => {
      if (!branch.shareDataWithParent) {
        return {
          tenantId: branch.id,
          name: branch.name,
          subdomain: branch.subdomain,
          memberCount: null,
          attendanceRate: null,
          totalGiving: null,
          computedAt: null,
          sharingEnabled: false,
          givingShared: false,
        };
      }

      const rollup = rollupByTenantId.get(branch.id);
      return {
        tenantId: branch.id,
        name: branch.name,
        subdomain: branch.subdomain,
        memberCount: rollup?.memberCount ?? 0,
        attendanceRate: rollup?.attendanceRate ?? null,
        totalGiving: branch.shareGivingWithParent
          ? (rollup?.totalGiving ?? null)
          : null,
        computedAt: rollup?.computedAt ?? null,
        sharingEnabled: true,
        givingShared: branch.shareGivingWithParent,
      };
    });
  }

  // Self-service — a branch's own admin controlling what a parent can see,
  // never settable by the parent itself.
  async getSharingConsent(): Promise<BranchSharingConsent> {
    const tenantId = this.currentTenantId();
    const tenant = await this.tenantRepo.findOneByOrFail({ id: tenantId });
    return this.toSharingConsent(tenant);
  }

  async updateSharingConsent(
    dto: Partial<
      Pick<
        BranchSharingConsent,
        'shareDataWithParent' | 'shareGivingWithParent'
      >
    >,
  ): Promise<BranchSharingConsent> {
    const tenantId = this.currentTenantId();
    const tenant = await this.tenantRepo.findOneByOrFail({ id: tenantId });
    if (dto.shareDataWithParent !== undefined) {
      tenant.shareDataWithParent = dto.shareDataWithParent;
    }
    if (dto.shareGivingWithParent !== undefined) {
      tenant.shareGivingWithParent = dto.shareGivingWithParent;
    }
    await this.tenantRepo.save(tenant);
    return this.toSharingConsent(tenant);
  }

  private async toSharingConsent(
    tenant: Tenant,
  ): Promise<BranchSharingConsent> {
    const parent = tenant.parentTenantId
      ? await this.tenantRepo.findOneBy({ id: tenant.parentTenantId })
      : null;
    return {
      shareDataWithParent: tenant.shareDataWithParent,
      shareGivingWithParent: tenant.shareGivingWithParent,
      parentTenantId: tenant.parentTenantId,
      parentTenantName: parent?.name ?? null,
    };
  }

  // Parent-initiated — detaches one of ITS OWN branches. Revokes a
  // sponsored plan on the way out (below) since continuing free access
  // sponsored by a parent it's no longer affiliated with makes no sense.
  async unlinkBranch(branchTenantId: string): Promise<void> {
    const parentTenantId = this.currentTenantId();
    const branch = await this.tenantRepo.findOneBy({
      id: branchTenantId,
      parentTenantId,
    });
    if (!branch) {
      throw new NotFoundException(
        'Branch not found, or not linked to this tenant.',
      );
    }
    branch.parentTenantId = null;
    await this.tenantRepo.save(branch);
    await this.revokeSponsorshipIfSponsoredBy(branch.id, parentTenantId);
  }

  // Branch-initiated — the CURRENT tenant leaves its own parent. Either
  // side of the relationship can end it; a branch isn't locked into a
  // parent it no longer wants, same as a parent isn't locked into a branch
  // it no longer wants (unlinkBranch above).
  async leaveParent(): Promise<void> {
    const tenantId = this.currentTenantId();
    const tenant = await this.tenantRepo.findOneByOrFail({ id: tenantId });
    if (!tenant.parentTenantId) {
      throw new BadRequestException(
        'This tenant is not currently a branch of any parent.',
      );
    }
    const formerParentId = tenant.parentTenantId;
    tenant.parentTenantId = null;
    await this.tenantRepo.save(tenant);
    await this.revokeSponsorshipIfSponsoredBy(tenantId, formerParentId);
  }

  private async revokeSponsorshipIfSponsoredBy(
    tenantId: string,
    sponsorTenantId: string,
  ): Promise<void> {
    const subscription = await this.subscriptionRepo.findOneBy({ tenantId });
    if (subscription?.sponsoredByTenantId !== sponsorTenantId) return;

    subscription.planId = 'free';
    subscription.status = SubscriptionStatus.CANCELED;
    subscription.canceledAt = new Date();
    subscription.sponsoredByTenantId = null;
    await this.subscriptionRepo.save(subscription);
    this.cacheService.del(`plan-features:${tenantId}`);
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
