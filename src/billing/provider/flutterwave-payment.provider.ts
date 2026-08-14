import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Plan } from '../entity/plan.entity';
import {
  CheckoutSession,
  FLUTTERWAVE_PROVIDER_NAME,
  IPaymentProvider,
  NormalizedPaymentEvent,
  PaymentCustomer,
} from '../interface/payment-provider.interface';

// Flutterwave's Standard Payment endpoint takes `amount` in the currency's
// major unit (naira, not kobo) — unlike Paystack, which takes the smallest
// unit. amountCents/priceCents throughout this codebase are always the
// smallest unit, so every amount is divided by 100 before being sent, and
// multiplied back on the way in from webhook payloads.
//
// KNOWN LIMITATION, not silently papered over: this class used to attach a
// `payment_plan` to subscription checkouts, the same "plan" + interval
// mechanism Paystack uses. Live sandbox testing showed this doesn't
// reliably create a real recurring subscription — a real successful
// subscription checkout came back with `paymentPlan: null` on the
// charge.completed webhook. Flutterwave's hosted checkout offers whichever
// payment channels are enabled on the account (card, USSD, bank transfer,
// etc.), and only a card payment is actually re-chargeable later — the
// charge that exposed this was paid via USSD (`"event.type":
// "USSD_TRANSACTION"` in the webhook payload), which has nothing to debit
// again. Rather than depend on the customer happening to pick a channel
// that supports it, this class now treats Flutterwave the same as
// KoraPaymentProvider below: createSubscriptionCheckout is a single charge
// for the plan's price, not an auto-renewing subscription. A tenant who
// subscribes via Flutterwave will NOT be silently re-charged by
// Flutterwave itself when their period ends — they fall through to
// SubscriptionLapseScheduler's normal failed-renewal flow (PAST_DUE email
// → grace period → downgrade) and have to complete a fresh checkout to
// renew, same as Kora. This is a real product gap, not a bug to fix
// quietly — flagged here so it isn't mistaken for parity with Paystack.
@Injectable()
export class FlutterwavePaymentProvider implements IPaymentProvider {
  readonly providerName = FLUTTERWAVE_PROVIDER_NAME;
  private readonly logger = new Logger(FlutterwavePaymentProvider.name);
  private readonly secretKey: string;
  private readonly secretHash: string;
  private readonly baseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,
  ) {
    this.secretKey = this.configService.get<string>('FLUTTERWAVE_SECRET_KEY');
    this.secretHash = this.configService.get<string>('FLUTTERWAVE_SECRET_HASH');
    this.baseUrl =
      this.configService.get<string>('FLUTTERWAVE_BASE_URL') ??
      'https://api.flutterwave.com/v3';
  }

  private async request<T = any>(
    method: 'GET' | 'POST' | 'PUT',
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

    if (!response.ok || json.status === 'error') {
      this.logger.error(`Flutterwave ${path} failed: ${JSON.stringify(json)}`);
      throw new InternalServerErrorException(
        json.message || 'Flutterwave request failed.',
      );
    }
    return json.data;
  }

  // Flutterwave has no separate "pre-register a customer" resource the way
  // Paystack does — customer identity is just an { email, name } object
  // passed inline on every charge. providerCustomerId is synthesized as the
  // tenant's own email so the rest of this class's shape still matches
  // IPaymentProvider without a real API call here.
  async createCustomer(tenant: {
    id: string;
    name: string;
    email: string;
  }): Promise<PaymentCustomer> {
    return { providerCustomerId: tenant.email };
  }

  // See class-level comment — a single charge for the plan's price, not a
  // registered recurring plan (no payment_plan attached, unlike this
  // method's previous shape).
  async createSubscriptionCheckout(params: {
    tenantId: string;
    planId: string;
    providerCustomerId: string;
    email: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession> {
    const plan = await this.planRepo.findOneBy({ id: params.planId });
    if (!plan) {
      throw new InternalServerErrorException(
        `Unknown plan "${params.planId}".`,
      );
    }
    const txRef = `sub_${randomUUID()}`;

    const data = await this.request('POST', '/payments', {
      tx_ref: txRef,
      amount: plan.priceCents / 100,
      currency: plan.currency,
      redirect_url: params.successUrl,
      customer: { email: params.email },
      meta: { tenantId: params.tenantId, cancel_url: params.cancelUrl },
    });

    return { checkoutUrl: data.link, providerSessionId: txRef };
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
    const txRef = `topup_${randomUUID()}`;

    const data = await this.request('POST', '/payments', {
      tx_ref: txRef,
      amount: params.amountCents / 100,
      currency: 'NGN',
      redirect_url: params.successUrl,
      customer: { email: params.email },
      meta: {
        tenantId: params.tenantId,
        description: params.description,
        cancel_url: params.cancelUrl,
      },
    });

    return { checkoutUrl: data.link, providerSessionId: txRef };
  }

  // No-op, not a fabricated API call — see class-level comment. There's no
  // real server-side subscription object to cancel, since
  // createSubscriptionCheckout never reliably creates one.
  // CheckoutService already treats a provider cancelSubscription failure
  // as best-effort/non-blocking (logs a warning, downgrades locally
  // regardless), so resolving cleanly here is equivalent in practice to
  // every other provider's failure path, without pretending there's
  // something real to call.
  async cancelSubscription(_providerSubscriptionId: string): Promise<void> {
    this.logger.debug(
      'FlutterwavePaymentProvider.cancelSubscription is a no-op — no real recurring subscription is ever created (see class-level comment).',
    );
  }

  // Unlike Paystack, Flutterwave's refund endpoint needs the transaction's
  // own numeric id, not the tx_ref we generated — look it up first.
  async refund(providerReference: string, amountCents?: number): Promise<void> {
    const transactions = await this.request(
      'GET',
      `/transactions?tx_ref=${encodeURIComponent(providerReference)}`,
    );
    const transaction = Array.isArray(transactions)
      ? transactions[0]
      : transactions;
    if (!transaction?.id) {
      throw new InternalServerErrorException(
        `No Flutterwave transaction found for reference "${providerReference}".`,
      );
    }
    await this.request('POST', `/transactions/${transaction.id}/refund`, {
      amount: amountCents !== undefined ? amountCents / 100 : undefined,
    });
  }

  // Flutterwave's webhook verification is a direct shared-secret string
  // comparison, not an HMAC — the `verif-hash` header is expected to equal
  // whatever FLUTTERWAVE_SECRET_HASH was configured in the Flutterwave
  // dashboard, verbatim. Still timingSafeEqual, not ===, for the same
  // constant-time reasoning as Paystack's HMAC comparison.
  verifyAndParseWebhook(
    rawBody: Buffer,
    signatureHeader: string,
  ): NormalizedPaymentEvent {
    const expectedBuf = Buffer.from(this.secretHash || '', 'utf-8');
    const actualBuf = Buffer.from(signatureHeader || '', 'utf-8');
    const valid =
      expectedBuf.length > 0 &&
      expectedBuf.length === actualBuf.length &&
      timingSafeEqual(expectedBuf, actualBuf);

    if (!valid) {
      throw new InternalServerErrorException('Invalid Flutterwave signature.');
    }

    const payload = JSON.parse(rawBody.toString('utf-8'));
    const event = payload.event as string;
    const data = payload.data ?? {};

    if (event === 'charge.completed') {
      return {
        type:
          data.status === 'successful' ? 'charge.succeeded' : 'charge.failed',
        providerReference: data.tx_ref,
        raw: payload,
      };
    }
    // No subscription.cancelled handling — see class-level comment. No real
    // recurring subscription is ever created here, so there's nothing
    // Flutterwave's own hosted portal could cancel to raise this event
    // against in the first place.

    return { type: 'charge.failed', raw: payload };
  }
}
