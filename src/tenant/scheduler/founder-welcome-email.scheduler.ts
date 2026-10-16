import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Tenant } from '../entity/tenant.entity';
import { TenantOnboardingStatus } from '../enum/tenant-onboarding-status.enum';
import { AppClsStore } from '../interface/tenant-cls-store.interface';
import { runInTenantContext } from '../utility/run-in-tenant-context';
import { Admin } from '../../admin/entity/admin.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { CacheService } from '../../utility/service/cache.service';

const RUN_ONCE_SECONDS = 3600;

// A day-granularity threshold gets a daily check, not an hourly one — same
// reasoning AssignmentReminderScheduler/PledgeReminderScheduler document for
// their own EVERY_DAY_AT_8AM crons. Off-peak-ish slot, not tied to any one
// church's timezone (this scans across every tenant, so there's no single
// relevant CHURCH_TIMEZONE the way a per-tenant reminder has).
const ACTIVATION_GRACE_HOURS = 24;

// Deliberately NOT routed through forEachActiveTenant() — that helper scans
// literally every active tenant every run; this needs a small, specific
// subset (activated ~1 day ago, not yet sent), so it queries that set
// directly and enters each eligible tenant's context one at a time via
// runInTenantContext(), the same primitive forEachActiveTenant() itself is
// built on.
@Injectable()
export class FounderWelcomeEmailScheduler {
  private readonly logger = new Logger(FounderWelcomeEmailScheduler.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly utilityService: UtilityService,
    private readonly cacheService: CacheService,
  ) {}

  @Cron('0 9 * * *')
  async sendDueFounderWelcomeEmails(): Promise<void> {
    // Once per run across all instances. Left to expire, so an instance whose clock is a little behind
    // doesn't run it again after a quick first run.
    if (
      !(await this.cacheService.acquireLock(
        'lock:founder-welcome-emails',
        RUN_ONCE_SECONDS,
      ))
    )
      return;
    const cutoff = new Date(
      Date.now() - ACTIVATION_GRACE_HOURS * 60 * 60 * 1000,
    );
    const due = await this.tenantRepo.find({
      where: {
        onboardingStatus: TenantOnboardingStatus.ACTIVE,
        isActive: true,
        founderWelcomeEmailSentAt: IsNull(),
        activatedAt: LessThanOrEqual(cutoff),
      },
    });

    let succeeded = 0;
    let failed = 0;
    for (const tenant of due) {
      try {
        await this.sendOne(tenant);
        succeeded++;
      } catch (err) {
        failed++;
        this.logger.warn(
          `Founder welcome email failed for tenant ${tenant.id}: ${(err as Error).message}`,
        );
      }
    }

    if (due.length) {
      this.logger.log(
        `Founder welcome email sweep: ${succeeded} sent, ${failed} failed, out of ${due.length} due.`,
      );
    }
  }

  // Reads the tenant's own earliest-created active Admin/Member the same
  // way PlatformTenantService.impersonateTenant() does — a raw CLS-scoped
  // tx read, not an @InjectRepository(Admin) one, since Admin isn't
  // registered through the tenant-schema proxy-repo pattern in this module
  // (see tenant-typeorm.module.ts's own comment on why a plain injected
  // repo can never see a per-request/per-job tenant transaction).
  private async sendOne(tenant: Tenant): Promise<void> {
    const admin = await runInTenantContext(
      this.cls,
      this.txHost,
      { tenantId: tenant.id, schemaName: tenant.schemaName },
      () =>
        this.txHost.tx.findOne(Admin, {
          where: { isActive: true },
          relations: ['member'],
          order: { createdAt: 'ASC' },
        }),
    );
    if (!admin) {
      this.logger.warn(
        `Skipping founder welcome email for tenant ${tenant.id} — no admin account found.`,
      );
      return;
    }

    // Sent outside any tenant CLS context (the read above already
    // completed) so branding resolves to Discuva's own identity, not this
    // church's — this is Jeremiah writing as Discuva's founder, not a
    // tenant-branded transactional email. Same fallback
    // platform-admin-welcome.html/tenant-approval-needed.html already rely
    // on in EmailQueueService.resolveBrandingData().
    this.utilityService.sendEmailWithTemplate(
      admin.member.email,
      `A quick note from Discuva's founder`,
      'founder-welcome',
      {
        name: admin.member.firstname,
        church_name: tenant.name,
      },
    );

    await this.tenantRepo.update(tenant.id, {
      founderWelcomeEmailSentAt: new Date(),
    });
  }
}
