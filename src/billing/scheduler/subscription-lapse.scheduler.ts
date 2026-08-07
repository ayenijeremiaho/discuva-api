import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { ClsService } from 'nestjs-cls';
import { ConfigService } from '@nestjs/config';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Subscription } from '../entity/subscription.entity';
import { SubscriptionStatus } from '../enum/subscription-status.enum';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { CacheService } from '../../utility/service/cache.service';
import { EmailQueueService } from '../../utility/service/email-queue.service';

const LOCK_KEY = 'lock:subscription-lapse-check';

// Safety net for renewals this codebase can't yet fully verify — see the
// class-level limitation note below before changing GRACE_PERIOD_DAYS or
// removing the downgrade branch.
@Injectable()
export class SubscriptionLapseScheduler {
  private readonly logger = new Logger(SubscriptionLapseScheduler.name);
  // How long a lapsed-but-not-voluntarily-canceled subscription stays
  // PAST_DUE before being downgraded — a real automatic provider renewal
  // charge succeeding within this window clears PAST_DUE the normal way
  // (a fresh charge.succeeded webhook re-activates the subscription via
  // CheckoutService.applyChargeSucceeded, same as any other successful
  // charge). "Retrying" the charge itself is the provider's own
  // responsibility, not this scheduler's — Paystack/Flutterwave both retry a
  // failing card several times before truly giving up, well within this
  // window.
  private readonly gracePeriodDays: number;

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly cacheService: CacheService,
    private readonly emailQueueService: EmailQueueService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly configService: ConfigService,
  ) {
    this.gracePeriodDays = this.configService.get<number>(
      'GRACE_PERIOD_DAYS',
      7,
    );
  }

  // KNOWN LIMITATION, not silently swept under the rug: this scheduler
  // treats "currentPeriodEnd has passed with no new charge.succeeded
  // webhook" as a failed renewal. That's only fully correct once
  // Subscription.billingProviderSubscriptionId capture is wired up
  // (docs/MULTI_TENANT_MIGRATION.md §9 Phase 3, deferred pending live
  // sandbox testing) — until then, a genuinely-still-paying tenant whose
  // provider auto-renewal webhook this codebase doesn't yet recognize will
  // also lapse here. This is the documented, accepted cost of shipping a
  // safety net now rather than waiting on that separate, larger piece.
  @Cron('0 4 * * *')
  async processLapsedSubscriptions(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(LOCK_KEY, 1800);
    if (!acquired) {
      this.logger.debug(
        'Subscription lapse check skipped — another instance holds the lock',
      );
      return;
    }

    const now = new Date();

    const newlyLapsed = await this.subscriptionRepo.find({
      where: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: LessThan(now),
      },
    });
    for (const sub of newlyLapsed) {
      try {
        await this.handleNewlyLapsed(sub);
      } catch (err: any) {
        this.logger.warn(
          `Failed handling lapsed subscription for tenant ${sub.tenantId}: ${err?.message ?? err}`,
        );
      }
    }

    const pastDue = await this.subscriptionRepo.find({
      where: { status: SubscriptionStatus.PAST_DUE },
    });
    for (const sub of pastDue) {
      if (!sub.currentPeriodEnd) continue;
      const graceDeadline = new Date(sub.currentPeriodEnd);
      graceDeadline.setDate(graceDeadline.getDate() + this.gracePeriodDays);
      if (now < graceDeadline) continue;

      try {
        await this.downgradeToFree(sub, 'grace period expired');
      } catch (err: any) {
        this.logger.warn(
          `Failed downgrading past-due subscription for tenant ${sub.tenantId}: ${err?.message ?? err}`,
        );
      }
    }

    this.logger.log(
      `Subscription lapse check: ${newlyLapsed.length} newly lapsed, ${pastDue.length} past-due reviewed`,
    );
  }

  private async handleNewlyLapsed(sub: Subscription): Promise<void> {
    if (sub.cancelAtPeriodEnd) {
      await this.downgradeToFree(sub, 'tenant requested cancellation');
      return;
    }

    sub.status = SubscriptionStatus.PAST_DUE;
    await this.subscriptionRepo.save(sub);
    await this.notifyTenant(
      sub.tenantId,
      'We could not confirm your latest subscription payment',
      `<p>We couldn't confirm your latest payment for your Discuva subscription.</p>
       <p>Your account keeps its current features for now, but will be downgraded to the Free plan in ${this.gracePeriodDays} days if this isn't resolved.</p>
       <p>If you believe this is an error, please contact support.</p>`,
    );
  }

  private async downgradeToFree(
    sub: Subscription,
    reason: string,
  ): Promise<void> {
    sub.planId = 'free';
    sub.status = SubscriptionStatus.CANCELED;
    sub.canceledAt = new Date();
    sub.cancelAtPeriodEnd = false;
    await this.subscriptionRepo.save(sub);
    this.cacheService.del(`plan-features:${sub.tenantId}`);
    this.logger.log(
      `Subscription for tenant ${sub.tenantId} downgraded to free (${reason})`,
    );

    await this.notifyTenant(
      sub.tenantId,
      'Your subscription has been downgraded to Free',
      `<p>Your Discuva subscription has been downgraded to the Free plan${
        reason === 'tenant requested cancellation'
          ? ' as requested'
          : ' because we could not confirm payment'
      }.</p>
       <p>You can upgrade again at any time from your billing settings.</p>`,
    );
  }

  private async notifyTenant(
    tenantId: string,
    subject: string,
    html: string,
  ): Promise<void> {
    const tenant = await this.tenantRepo.findOneBy({ id: tenantId });
    if (!tenant) return;

    const email = await this.findAdminEmail(tenant);
    if (!email) return;

    this.emailQueueService.queueEmail(email, subject, html);
  }

  // Same manual tenant-context-entry pattern as
  // PlatformTenantService.impersonateTenant — a cron job has no ambient CLS
  // context of its own to inherit tenant scoping from.
  private async findAdminEmail(tenant: Tenant): Promise<string | null> {
    const admin = await this.cls.runWith(
      { tenantId: tenant.id, schemaName: tenant.schemaName } as AppClsStore,
      () =>
        this.txHost.withTransaction(async () => {
          await this.txHost.tx.query(
            `SET LOCAL search_path TO "${tenant.schemaName}", public`,
          );
          return this.txHost.tx.findOne(Admin, {
            where: { isActive: true },
            relations: ['member'],
            order: { createdAt: 'ASC' },
          });
        }),
    );
    return admin?.member?.email ?? null;
  }
}
