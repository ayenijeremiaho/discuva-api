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
  NormalizedPaymentEvent,
  PAYSTACK_PROVIDER_NAME,
  PaymentCustomer,
} from '../interface/payment-provider.interface';

// Paystack's Initialize Transaction takes `amount` in the currency's
// smallest unit (kobo for NGN) — the same convention this codebase already
// uses for priceCents/amountCents, so no conversion needed here (contrast
// FlutterwavePaymentProvider, which does need one).
@Injectable()
export class PaystackPaymentProvider implements IPaymentProvider {
  readonly providerName = PAYSTACK_PROVIDER_NAME;
  private readonly logger = new Logger(PaystackPaymentProvider.name);
  private readonly secretKey: string;
  private readonly baseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,
  ) {
    this.secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    this.baseUrl =
      this.configService.get<string>('PAYSTACK_BASE_URL') ??
      'https://api.paystack.co';
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

    if (!response.ok || json.status === false) {
      this.logger.error(`Paystack ${path} failed: ${JSON.stringify(json)}`);
      throw new InternalServerErrorException(
        json.message || 'Paystack request failed.',
      );
    }
    return json.data;
  }

  async createCustomer(tenant: {
    id: string;
    name: string;
    email: string;
  }): Promise<PaymentCustomer> {
    const data = await this.request('POST', '/customer', {
      email: tenant.email,
      first_name: tenant.name,
      metadata: { tenantId: tenant.id },
    });
    return { providerCustomerId: data.customer_code };
  }

  // Lazily creates (and persists onto Plan.billingProviderPriceId) a
  // matching Paystack Plan the first time this planId is ever checked out
  // against — Paystack requires a Plan object to exist server-side before a
  // transaction can be initialized against it.
  private async resolvePlanCode(planId: string): Promise<{
    planCode: string;
    amountCents: number;
    currency: string;
  }> {
    const plan = await this.planRepo.findOneBy({ id: planId });
    if (!plan) {
      throw new InternalServerErrorException(`Unknown plan "${planId}".`);
    }
    if (plan.billingProviderPriceId) {
      return {
        planCode: plan.billingProviderPriceId,
        amountCents: plan.priceCents,
        currency: plan.currency,
      };
    }

    const data = await this.request('POST', '/plan', {
      name: `${plan.name} (${plan.id})`,
      amount: plan.priceCents,
      interval: 'monthly',
      currency: plan.currency,
    });
    plan.billingProviderPriceId = data.plan_code;
    await this.planRepo.save(plan);

    return {
      planCode: data.plan_code,
      amountCents: plan.priceCents,
      currency: plan.currency,
    };
  }

  async createSubscriptionCheckout(params: {
    tenantId: string;
    planId: string;
    providerCustomerId: string;
    email: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession> {
    const { planCode, amountCents } = await this.resolvePlanCode(params.planId);
    const reference = `sub_${randomUUID()}`;

    // Including `plan` alongside `amount` in the same Initialize Transaction
    // call is Paystack's actual mechanism for "charge now, and if it
    // succeeds, also start a recurring subscription on this plan" — there is
    // no separate "create subscription" call needed up front.
    const data = await this.request('POST', '/transaction/initialize', {
      email: params.email,
      amount: amountCents,
      plan: planCode,
      reference,
      callback_url: params.successUrl,
      metadata: { tenantId: params.tenantId, cancel_url: params.cancelUrl },
    });

    return {
      checkoutUrl: data.authorization_url,
      providerSessionId: reference,
    };
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
    const reference = `topup_${randomUUID()}`;

    const data = await this.request('POST', '/transaction/initialize', {
      email: params.email,
      amount: params.amountCents,
      reference,
      callback_url: params.successUrl,
      metadata: {
        tenantId: params.tenantId,
        description: params.description,
        cancel_url: params.cancelUrl,
      },
    });

    return {
      checkoutUrl: data.authorization_url,
      providerSessionId: reference,
    };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    // Paystack requires the subscription's email token (obtained via GET
    // /subscription/:code) alongside its code to disable it — fetch then
    // disable, rather than assuming the caller already has the token.
    const subscription = await this.request(
      'GET',
      `/subscription/${providerSubscriptionId}`,
    );
    await this.request('POST', '/subscription/disable', {
      code: providerSubscriptionId,
      token: subscription.email_token,
    });
  }

  // Paystack refunds by transaction reference directly — no separate
  // lookup needed (contrast Flutterwave, which requires resolving tx_ref to
  // a numeric transaction id first).
  async refund(providerReference: string, amountCents?: number): Promise<void> {
    await this.request('POST', '/refund', {
      transaction: providerReference,
      amount: amountCents,
    });
  }

  // Paystack signs the raw request body with HMAC-SHA512 keyed by the
  // secret key — timingSafeEqual (not ===) so response time doesn't leak
  // how many leading bytes of a forged signature happened to match.
  verifyAndParseWebhook(
    rawBody: Buffer,
    signatureHeader: string,
  ): NormalizedPaymentEvent {
    const expected = createHmac('sha512', this.secretKey)
      .update(rawBody)
      .digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf-8');
    const actualBuf = Buffer.from(signatureHeader || '', 'utf-8');
    const valid =
      expectedBuf.length === actualBuf.length &&
      timingSafeEqual(expectedBuf, actualBuf);

    if (!valid) {
      throw new InternalServerErrorException('Invalid Paystack signature.');
    }

    const payload = JSON.parse(rawBody.toString('utf-8'));
    const event = payload.event as string;
    const data = payload.data ?? {};

    if (event === 'charge.success') {
      return {
        type: 'charge.succeeded',
        providerReference: data.reference,
        raw: payload,
      };
    }
    if (event === 'charge.failed') {
      return {
        type: 'charge.failed',
        providerReference: data.reference,
        raw: payload,
      };
    }
    if (
      event === 'subscription.disable' ||
      event === 'subscription.not_renew'
    ) {
      return {
        type: 'subscription.canceled',
        providerSubscriptionId: data.subscription_code,
        raw: payload,
      };
    }

    // Any other Paystack event (e.g. transfer/refund events unrelated to
    // this flow) — return a no-op-shaped event rather than throwing, so an
    // unrecognized-but-legitimately-signed webhook still 200s instead of
    // Paystack retrying it forever.
    return { type: 'charge.failed', raw: payload };
  }
}
