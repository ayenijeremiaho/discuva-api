import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Plan } from '../entity/plan.entity';
import {
  CheckoutSession,
  IPaymentProvider,
  KORA_PROVIDER_NAME,
  NormalizedPaymentEvent,
  PaymentCustomer,
} from '../interface/payment-provider.interface';

// Korapay's Initialize Charge endpoint takes `amount` in the currency's
// major unit (naira, not kobo) — same "not the smallest unit" situation as
// FlutterwavePaymentProvider, amountCents divided by 100 before being sent.
// Request/response shapes and webhook signing below are the same, already
// production-proven contract as KoraGivingProvider
// (src/giving-checkout/provider/kora-giving.provider.ts) — this class is
// the platform-billing counterpart, charging Discuva's own Korapay account
// rather than a tenant's BYOK one.
//
// KNOWN LIMITATION, not silently papered over: unlike Paystack ("plan" +
// Initialize Transaction) and Flutterwave ("payment-plans" +
// payment_plan), Korapay has no verified recurring/subscription-plan
// product in its API — nothing here fabricates one. createSubscriptionCheckout
// below is a single charge for the plan's price, same mechanism as
// createOneOffCheckout, not an auto-renewing subscription. Concretely: a
// tenant who subscribes via Kora will NOT be silently re-charged by Kora
// itself when their period ends the way a Paystack/Flutterwave tenant might
// be — they still fall through to SubscriptionLapseScheduler's normal
// failed-renewal flow (PAST_DUE email → grace period → downgrade) and have
// to complete a fresh checkout to renew. This is a real product gap, not a
// bug to fix quietly — flagged here so it isn't mistaken for parity with
// the other two providers.
@Injectable()
export class KoraPaymentProvider implements IPaymentProvider {
  readonly providerName = KORA_PROVIDER_NAME;
  private readonly logger = new Logger(KoraPaymentProvider.name);
  private readonly secretKey: string;
  private readonly baseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,
  ) {
    this.secretKey = this.configService.get<string>('KORA_SECRET_KEY');
    this.baseUrl =
      this.configService.get<string>('KORA_BASE_URL') ??
      'https://api.korapay.com/merchant/api/v1';
  }

  private async request<T = any>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json: any = await response.json().catch(() => ({}));

    if (!response.ok || json.status !== true) {
      this.logger.error(`Korapay ${path} failed: ${JSON.stringify(json)}`);
      throw new InternalServerErrorException(
        json.message || 'Korapay request failed.',
      );
    }
    return json.data;
  }

  // Korapay's charge endpoint takes customer identity ({ email, name })
  // inline on every charge — no separate "pre-register a customer"
  // resource, same situation as Flutterwave. providerCustomerId is
  // synthesized as the tenant's own email so this class's shape still
  // matches IPaymentProvider without a fabricated API call.
  async createCustomer(tenant: {
    id: string;
    name: string;
    email: string;
  }): Promise<PaymentCustomer> {
    return { providerCustomerId: tenant.email };
  }

  private async chargeForPlan(
    planId: string,
    email: string,
    referencePrefix: 'sub' | 'topup',
  ): Promise<CheckoutSession> {
    const plan = await this.planRepo.findOneBy({ id: planId });
    if (!plan) {
      throw new InternalServerErrorException(`Unknown plan "${planId}".`);
    }
    return this.charge(plan.priceCents, plan.currency, email, referencePrefix);
  }

  private async charge(
    amountCents: number,
    currency: string,
    email: string,
    referencePrefix: 'sub' | 'topup',
  ): Promise<CheckoutSession> {
    const reference = `${referencePrefix}_${randomUUID()}`;
    const data = await this.request('POST', '/charges/initialize', {
      amount: amountCents / 100,
      currency,
      reference,
      customer: { email },
    });
    return { checkoutUrl: data.checkout_url, providerSessionId: reference };
  }

  // See class-level comment — a single charge for the plan's price, not a
  // registered recurring plan. `providerCustomerId` is unused (Korapay
  // takes email inline, same as Flutterwave's version of this method) but
  // kept in the signature to satisfy IPaymentProvider.
  async createSubscriptionCheckout(params: {
    tenantId: string;
    planId: string;
    providerCustomerId: string;
    email: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession> {
    return this.chargeForPlan(params.planId, params.email, 'sub');
  }

  async createOneOffCheckout(params: {
    tenantId: string;
    providerCustomerId: string;
    email: string;
    amountCents: number;
    description: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession> {
    return this.charge(params.amountCents, 'NGN', params.email, 'topup');
  }

  // No-op, not a fabricated API call — Korapay has no verified
  // subscription/plan object to cancel server-side (see class-level
  // comment). CheckoutService already treats a provider cancelSubscription
  // failure as best-effort/non-blocking (logs a warning, downgrades
  // locally regardless), so resolving cleanly here is equivalent in
  // practice to every other provider's failure path, without pretending
  // there's something real to call.
  async cancelSubscription(_providerSubscriptionId: string): Promise<void> {
    this.logger.debug(
      'KoraPaymentProvider.cancelSubscription is a no-op — Korapay has no server-side subscription object to cancel.',
    );
  }

  // Deliberately NOT implemented against a guessed endpoint — this
  // codebase's own standing discipline (see SubscriptionLapseScheduler,
  // CheckoutService) is to document a real gap rather than ship a
  // plausible-looking but unverified API call. Korapay's refund endpoint
  // shape hasn't been verified against real sandbox behavior the way
  // /charges/initialize and its webhook signing have (proven in
  // KoraGivingProvider). Throws rather than silently no-op'ing, since a
  // refund is money-affecting and platform-admin-initiated — the caller
  // needs to know it didn't happen, not think it silently succeeded.
  async refund(
    _providerReference: string,
    _amountCents?: number,
  ): Promise<void> {
    throw new InternalServerErrorException(
      'Korapay refunds are not yet implemented — verify the real refund endpoint against Korapay sandbox/docs before adding it here, then update this method.',
    );
  }

  // Korapay signs the `data` object (not the full envelope) with
  // HMAC-SHA256 keyed by the secret key — the x-korapay-signature header is
  // that digest, hex-encoded. Identical mechanism to KoraGivingProvider,
  // except keyed by the platform's own single KORA_SECRET_KEY rather than a
  // per-tenant BYOK credential, since there's only one Korapay account here.
  verifyAndParseWebhook(
    rawBody: Buffer,
    signatureHeader: string,
  ): NormalizedPaymentEvent {
    const payload = JSON.parse(rawBody.toString('utf-8'));
    const data = payload.data ?? {};

    const expected = createHmac('sha256', this.secretKey)
      .update(JSON.stringify(data))
      .digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf-8');
    const actualBuf = Buffer.from(signatureHeader || '', 'utf-8');
    const valid =
      expectedBuf.length === actualBuf.length &&
      timingSafeEqual(expectedBuf, actualBuf);

    if (!valid) {
      throw new InternalServerErrorException('Invalid Korapay signature.');
    }

    const event = payload.event as string;
    if (event === 'charge.success') {
      return {
        type: 'charge.succeeded',
        providerReference: data.reference,
        raw: payload,
      };
    }
    return {
      type: 'charge.failed',
      providerReference: data.reference,
      raw: payload,
    };
  }
}
