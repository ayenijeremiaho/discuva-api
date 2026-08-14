import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { CacheService } from '../../utility/service/cache.service';
import { Plan } from '../entity/plan.entity';
import { Subscription } from '../entity/subscription.entity';
import { SubscriptionStatus } from '../enum/subscription-status.enum';
import { BillingInterval } from '../enum/billing-interval.enum';
import {
  BillingCheckoutSession,
  BillingCheckoutStatus,
  BillingCheckoutType,
} from '../entity/billing-checkout-session.entity';
import { PaymentProviderRegistryService } from './payment-provider-registry.service';

export interface PublicPlanVariant {
  planId: string;
  currency: string;
  priceCents: number;
  billingInterval: BillingInterval;
}

export interface PublicPlanTier {
  tierKey: string;
  name: string;
  features: string[];
  featureLimits: Record<string, number>;
  variants: PublicPlanVariant[];
}

export interface BillingSummary {
  planId: string;
  planName: string;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  // True once cancelSubscription() has been called but the tenant is still
  // within a period they already paid for — the frontend should show
  // "cancels on {currentPeriodEnd}" rather than an immediate downgrade.
  cancelAtPeriodEnd: boolean;
  // True when this plan was comped by a parent tenant (branch invite
  // sponsorPlan), not paid for independently — the frontend should hide
  // checkout/cancel actions entirely and show "managed by your parent
  // church" instead.
  sponsoredByParent: boolean;
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);
  // Subscription renewal in this pass is a flat period per successful
  // charge, not true provider-driven recurring billing reconciliation (which
  // would need live sandbox testing against Paystack/Flutterwave's actual
  // subscription-lifecycle webhook payloads to get exactly right — deferred,
  // same "don't guess at a shape you can't verify" discipline as everywhere
  // else in this codebase). A tenant is re-charged and this period extended
  // again the next time their subscription's own webhook fires a fresh
  // charge.succeeded for the same reference pattern. Keyed by the charged
  // plan's billingInterval, not a single global figure — an annual charge
  // must extend the period by ~365 days, not 30.
  private readonly periodDaysByInterval: Record<BillingInterval, number>;

  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly paymentProviderRegistry: PaymentProviderRegistryService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Plan) private readonly planRepo: Repository<Plan>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(BillingCheckoutSession)
    private readonly checkoutRepo: Repository<BillingCheckoutSession>,
  ) {
    this.periodDaysByInterval = {
      [BillingInterval.MONTHLY]: this.configService.get<number>(
        'SUBSCRIPTION_PERIOD_DAYS',
        30,
      ),
      [BillingInterval.ANNUAL]: this.configService.get<number>(
        'ANNUAL_SUBSCRIPTION_PERIOD_DAYS',
        365,
      ),
    };
  }

  private currentTenantId(): string {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) {
      throw new ForbiddenException('No tenant context for this request.');
    }
    return tenantId;
  }

  // Tenant-facing plan catalog — no tenant scoping needed, plans are global
  // reference data (same "no pagination, return the full list" treatment as
  // every other admin-controlled reference list in this codebase).
  async listPlans(): Promise<Plan[]> {
    return this.planRepo.find({ order: { priceCents: 'ASC' } });
  }

  // Unauthenticated reference data for discuva-web (a separate marketing
  // site with no tenant/admin context at all) — groups currency variants of
  // the same conceptual tier together so the caller doesn't have to
  // re-derive tierKey grouping itself.
  async listPublicPlans(): Promise<PublicPlanTier[]> {
    const plans = await this.planRepo.find({ order: { priceCents: 'ASC' } });

    const tiers = new Map<string, PublicPlanTier>();
    for (const plan of plans) {
      let tier = tiers.get(plan.tierKey);
      if (!tier) {
        tier = {
          tierKey: plan.tierKey,
          name: plan.name,
          features: plan.features,
          featureLimits: plan.featureLimits,
          variants: [],
        };
        tiers.set(plan.tierKey, tier);
      }
      tier.variants.push({
        planId: plan.id,
        currency: plan.currency,
        priceCents: plan.priceCents,
        billingInterval: plan.billingInterval,
      });
    }

    return Array.from(tiers.values()).sort(
      (a, b) => a.variants[0].priceCents - b.variants[0].priceCents,
    );
  }

  async getBillingSummary(): Promise<BillingSummary> {
    const tenantId = this.currentTenantId();
    const subscription = await this.subscriptionRepo.findOneBy({ tenantId });

    const planId = subscription?.planId ?? 'free';
    const plan = await this.planRepo.findOneBy({ id: planId });

    return {
      planId,
      planName: plan?.name ?? planId,
      subscriptionStatus: subscription?.status ?? SubscriptionStatus.ACTIVE,
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
      sponsoredByParent: !!subscription?.sponsoredByTenantId,
    };
  }

  // Self-serve cancel/downgrade — the tenant-facing counterpart to the
  // platform-admin escape hatch (PATCH /platform/tenants/:id/plan). Still
  // within a paid period: marks cancelAtPeriodEnd so they keep access until
  // it ends, and SubscriptionLapseScheduler completes the downgrade once it
  // does. Already lapsed or never had a real period: downgrades immediately,
  // nothing left to let them keep using.
  async cancelSubscription(): Promise<BillingSummary> {
    const tenantId = this.currentTenantId();
    const subscription = await this.subscriptionRepo.findOneBy({ tenantId });
    if (!subscription || subscription.planId === 'free') {
      throw new BadRequestException('No active paid subscription to cancel.');
    }
    if (subscription.sponsoredByTenantId) {
      throw new BadRequestException(
        'This plan is managed by your parent church and cannot be canceled here.',
      );
    }

    // Best-effort — a provider API failure shouldn't block the tenant from
    // downgrading locally; they've already told us they want to stop, and
    // that intent wins even if telling the provider about it fails.
    if (
      subscription.paymentProvider &&
      subscription.billingProviderSubscriptionId
    ) {
      try {
        const provider = this.paymentProviderRegistry.get(
          subscription.paymentProvider,
        );
        await provider.cancelSubscription(
          subscription.billingProviderSubscriptionId,
        );
      } catch (err: any) {
        this.logger.warn(
          `Provider cancelSubscription failed for tenant ${tenantId}, downgrading locally anyway: ${err?.message ?? err}`,
        );
      }
    }

    const stillWithinPaidPeriod =
      subscription.currentPeriodEnd &&
      subscription.currentPeriodEnd > new Date();

    if (stillWithinPaidPeriod) {
      subscription.cancelAtPeriodEnd = true;
      await this.subscriptionRepo.save(subscription);
    } else {
      subscription.planId = 'free';
      subscription.status = SubscriptionStatus.CANCELED;
      subscription.canceledAt = new Date();
      subscription.cancelAtPeriodEnd = false;
      await this.subscriptionRepo.save(subscription);
      this.cacheService.del(`plan-features:${tenantId}`);
    }

    return this.getBillingSummary();
  }

  async initiateSubscriptionCheckout(
    planId: string,
    email: string,
    providerName: string | undefined,
    successUrl: string,
    cancelUrl: string,
  ): Promise<{ checkoutUrl: string }> {
    const tenantId = this.currentTenantId();
    const plan = await this.planRepo.findOneBy({ id: planId });
    if (!plan) {
      throw new NotFoundException(`Unknown plan "${planId}".`);
    }

    const tenant = await this.tenantRepo.findOneByOrFail({ id: tenantId });
    const provider =
      await this.paymentProviderRegistry.assertActive(providerName);
    const customer = await provider.createCustomer({
      id: tenant.id,
      name: tenant.name,
      email,
    });
    const session = await provider.createSubscriptionCheckout({
      tenantId,
      planId,
      providerCustomerId: customer.providerCustomerId,
      email,
      successUrl,
      cancelUrl,
    });

    await this.checkoutRepo.save(
      this.checkoutRepo.create({
        id: session.providerSessionId,
        tenantId,
        type: BillingCheckoutType.SUBSCRIPTION,
        planId,
        amountCents: plan.priceCents,
        currency: plan.currency,
        provider: provider.providerName,
        status: BillingCheckoutStatus.PENDING,
      }),
    );

    return { checkoutUrl: session.checkoutUrl };
  }

  // Entry point for BillingWebhookController — verifies the signature (via
  // the named provider's own verifyAndParseWebhook, which throws on a bad
  // signature) then applies the effect. Every branch below resolves the
  // affected tenant/amount from OUR OWN previously-recorded
  // BillingCheckoutSession/Subscription rows, never from the webhook
  // payload itself — see the entity's class comment for why.
  async handleWebhookEvent(
    providerName: string,
    rawBody: Buffer,
    signature: string,
  ): Promise<void> {
    const provider = this.paymentProviderRegistry.get(providerName);
    const event = provider.verifyAndParseWebhook(rawBody, signature);

    if (event.type === 'charge.succeeded') {
      await this.applyChargeSucceeded(event.providerReference);
    } else if (event.type === 'charge.failed' && event.providerReference) {
      await this.checkoutRepo.update(
        { id: event.providerReference, status: BillingCheckoutStatus.PENDING },
        { status: BillingCheckoutStatus.FAILED },
      );
    } else if (event.type === 'subscription.canceled') {
      await this.applySubscriptionCanceled(event.providerSubscriptionId);
    } else if (event.type === 'subscription.created') {
      await this.applySubscriptionCreated(
        event.providerSubscriptionId,
        event.tenantId,
        event.nextPaymentDate,
      );
    }
  }

  private async applyChargeSucceeded(reference?: string): Promise<void> {
    if (!reference) return;

    let affectedTenantId: string | undefined;

    await this.dataSource.transaction(async (manager) => {
      // Row-locked + status=PENDING guard makes this idempotent against
      // webhook redelivery — a second delivery for an already-completed
      // session finds nothing to lock and is a safe no-op.
      const session = await manager.findOne(BillingCheckoutSession, {
        where: { id: reference, status: BillingCheckoutStatus.PENDING },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) return;

      session.status = BillingCheckoutStatus.COMPLETED;
      session.completedAt = new Date();
      await manager.save(session);
      affectedTenantId = session.tenantId;

      if (session.type === BillingCheckoutType.SUBSCRIPTION) {
        let subscription = await manager.findOne(Subscription, {
          where: { tenantId: session.tenantId },
        });
        if (!subscription) {
          subscription = manager.create(Subscription, {
            tenantId: session.tenantId,
          });
        }
        const plan = await manager.findOneBy(Plan, { id: session.planId! });
        const periodDays =
          this.periodDaysByInterval[
            plan?.billingInterval ?? BillingInterval.MONTHLY
          ];
        const currentPeriodEnd = new Date();
        currentPeriodEnd.setDate(currentPeriodEnd.getDate() + periodDays);
        subscription.planId = session.planId!;
        subscription.status = SubscriptionStatus.ACTIVE;
        subscription.paymentProvider = session.provider;
        subscription.currentPeriodEnd = currentPeriodEnd;
        await manager.save(subscription);
      }
    });

    // Fire-and-forget per this codebase's cache convention — the write
    // already committed, invalidating the cached feature list just makes
    // the upgrade visible on the tenant's very next request instead of
    // after PlanGuard's 300s TTL.
    if (affectedTenantId) {
      this.cacheService.del(`plan-features:${affectedTenantId}`);
    }
  }

  // Fires correctly for Paystack now that subscription.create populates
  // Subscription.billingProviderSubscriptionId (see applySubscriptionCreated
  // below) — verified against a real Paystack sandbox webhook payload.
  // Flutterwave's equivalent creation event is NOT wired up (unverified
  // against live Flutterwave docs/sandbox, same discipline as its
  // interval-string mapping in flutterwave-payment.provider.ts), so a
  // Flutterwave-side cancellation raised from Flutterwave's own hosted
  // portal still won't resolve to a tenant here. A tenant is still
  // downgraded correctly via the existing platform-admin escape hatch
  // (PATCH /platform/tenants/:id/plan) if that needs reflecting manually
  // in the meantime.
  private async applySubscriptionCanceled(
    providerSubscriptionId?: string,
  ): Promise<void> {
    if (!providerSubscriptionId) return;

    const subscription = await this.subscriptionRepo.findOneBy({
      billingProviderSubscriptionId: providerSubscriptionId,
    });
    if (!subscription) return;

    subscription.planId = 'free';
    subscription.status = SubscriptionStatus.CANCELED;
    subscription.canceledAt = new Date();
    await this.subscriptionRepo.save(subscription);
    this.cacheService.del(`plan-features:${subscription.tenantId}`);
  }

  // Captures the provider's own subscription id — needed by
  // applySubscriptionCanceled above to match a provider-initiated
  // cancellation back to a tenant, since a cancellation from the
  // provider's own hosted portal carries no checkout reference of ours.
  // Also trusts the provider's own next billing date (nextPaymentDate)
  // over our SUBSCRIPTION_PERIOD_DAYS/ANNUAL_SUBSCRIPTION_PERIOD_DAYS math
  // when it's given one, since that reflects the provider's actual billing
  // clock rather than whenever we happened to receive a webhook. Matched
  // by tenantId, not a checkout reference — a freshly-created provider
  // subscription has none of its own (confirmed via a real Paystack
  // sandbox payload). Safe no-op if the Subscription row doesn't exist
  // yet — charge.succeeded (which creates it) isn't guaranteed to be
  // processed first, webhook delivery order isn't guaranteed.
  private async applySubscriptionCreated(
    providerSubscriptionId?: string,
    tenantId?: string,
    nextPaymentDate?: Date,
  ): Promise<void> {
    if (!providerSubscriptionId || !tenantId) return;

    const subscription = await this.subscriptionRepo.findOneBy({ tenantId });
    if (!subscription) return;

    subscription.billingProviderSubscriptionId = providerSubscriptionId;
    if (nextPaymentDate && !Number.isNaN(nextPaymentDate.getTime())) {
      subscription.currentPeriodEnd = nextPaymentDate;
    }
    await this.subscriptionRepo.save(subscription);
  }

  // Platform-admin-only (PlatformAdminController) — a tenant never triggers
  // this themselves. Deliberately does NOT downgrade a plan from a refunded
  // subscription checkout — that requires a product decision (does
  // downgrading strand data a tenant has since created on the paid tier?)
  // this pass doesn't take on. A platform admin issuing a refund is expected
  // to also apply the tenant-facing consequence manually via the existing
  // escape hatch (PATCH /platform/tenants/:id/plan) if warranted.
  async refundCheckoutSession(
    sessionId: string,
    amountCents?: number,
  ): Promise<BillingCheckoutSession> {
    const session = await this.checkoutRepo.findOneBy({ id: sessionId });
    if (!session) {
      throw new NotFoundException('Checkout session not found.');
    }
    if (session.status !== BillingCheckoutStatus.COMPLETED) {
      throw new BadRequestException(
        'Only a completed checkout session can be refunded.',
      );
    }

    const provider = this.paymentProviderRegistry.get(session.provider);
    await provider.refund(session.id, amountCents);

    session.status = BillingCheckoutStatus.REFUNDED;
    return this.checkoutRepo.save(session);
  }

  // Platform-admin-only — explicit tenantId param rather than
  // currentTenantId(), since platform admin operates outside any tenant's
  // own CLS context entirely (control-plane, same as everything else in
  // PlatformAdminController).
  async listCheckoutSessions(
    tenantId: string,
  ): Promise<BillingCheckoutSession[]> {
    return this.checkoutRepo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }
}
