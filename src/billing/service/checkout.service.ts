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
import {
  BillingCheckoutSession,
  BillingCheckoutStatus,
  BillingCheckoutType,
} from '../entity/billing-checkout-session.entity';
import { PaymentProviderRegistryService } from './payment-provider-registry.service';

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
  // charge.succeeded for the same reference pattern.
  private readonly subscriptionPeriodDays: number;

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
    this.subscriptionPeriodDays = this.configService.get<number>(
      'SUBSCRIPTION_PERIOD_DAYS',
      30,
    );
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
        const currentPeriodEnd = new Date();
        currentPeriodEnd.setDate(
          currentPeriodEnd.getDate() + this.subscriptionPeriodDays,
        );
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

  // Only fires correctly once Subscription.billingProviderSubscriptionId
  // has actually been populated — capturing that value from a provider's
  // own subscription-lifecycle webhook (Paystack subscription.create,
  // Flutterwave's equivalent) is deferred pending live sandbox testing
  // (same reasoning as SUBSCRIPTION_PERIOD_DAYS above). Until then this is
  // a documented no-op, not a silent gap: a tenant is still downgraded
  // correctly via the existing platform-admin escape hatch
  // (PATCH /platform/tenants/:id/plan) if a provider-side cancellation
  // needs to be reflected manually in the meantime.
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
