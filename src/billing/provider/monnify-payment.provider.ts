import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { Plan } from '../entity/plan.entity';
import {
  CheckoutSession,
  IPaymentProvider,
  MONNIFY_PROVIDER_NAME,
  NormalizedPaymentEvent,
  PaymentCustomer,
} from '../interface/payment-provider.interface';
import {
  MonnifyApi,
  MonnifyCredentials,
  isValidMonnifySignature,
} from '../../utility/monnify/monnify-api';

// Platform billing through Discuva's own Monnify account (MONNIFY_API_KEY/SECRET_KEY/CONTRACT_CODE).
// Like Korapay, Monnify has no recurring-plan product: a subscription is one charge for the plan's price and
// renews through SubscriptionLapseScheduler's normal flow. Refunds are not implemented (unverified endpoint).
@Injectable()
export class MonnifyPaymentProvider implements IPaymentProvider {
  readonly providerName = MONNIFY_PROVIDER_NAME;
  private readonly logger = new Logger(MonnifyPaymentProvider.name);
  private readonly api = new MonnifyApi(this.logger);
  private readonly credentials: MonnifyCredentials;

  constructor(
    configService: ConfigService,
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,
  ) {
    this.credentials = {
      apiKey: configService.get<string>('MONNIFY_API_KEY') ?? '',
      secretKey: configService.get<string>('MONNIFY_SECRET_KEY') ?? '',
      contractCode: configService.get<string>('MONNIFY_CONTRACT_CODE') ?? '',
    };
  }

  // Monnify takes the customer inline on each transaction; the email stands in as the customer id.
  async createCustomer(tenant: {
    id: string;
    name: string;
    email: string;
  }): Promise<PaymentCustomer> {
    return { providerCustomerId: tenant.email };
  }

  private async charge(
    amountCents: number,
    currency: string,
    email: string,
    description: string,
    redirectUrl: string,
    referencePrefix: 'sub' | 'topup',
  ): Promise<CheckoutSession> {
    if (!this.credentials.apiKey || !this.credentials.secretKey) {
      throw new InternalServerErrorException(
        'Monnify is not configured for platform billing.',
      );
    }
    const reference = `${referencePrefix}_${randomUUID()}`;
    const checkoutUrl = await this.api.initTransaction(this.credentials, {
      amountCents,
      currency,
      reference,
      customerName: email,
      customerEmail: email,
      description,
      redirectUrl,
    });
    return { checkoutUrl, providerSessionId: reference };
  }

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
    return this.charge(
      plan.priceCents,
      plan.currency,
      params.email,
      `Subscription: ${plan.name}`,
      params.successUrl,
      'sub',
    );
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
    return this.charge(
      params.amountCents,
      'NGN',
      params.email,
      params.description,
      params.successUrl,
      'topup',
    );
  }

  // Nothing to cancel on Monnify's side — there is no subscription object.
  async cancelSubscription(_providerSubscriptionId: string): Promise<void> {
    this.logger.debug(
      'MonnifyPaymentProvider.cancelSubscription is a no-op — Monnify has no server-side subscription object.',
    );
  }

  // Money-affecting and platform-admin-initiated, so it fails loudly rather than calling an unverified endpoint.
  async refund(
    _providerReference: string,
    _amountCents?: number,
  ): Promise<void> {
    throw new InternalServerErrorException(
      'Monnify refunds are not implemented yet — refund from the Monnify dashboard.',
    );
  }

  verifyAndParseWebhook(
    rawBody: Buffer,
    signatureHeader: string,
  ): NormalizedPaymentEvent {
    if (
      !isValidMonnifySignature(
        rawBody,
        signatureHeader,
        this.credentials.secretKey,
      )
    ) {
      throw new InternalServerErrorException('Invalid Monnify signature.');
    }

    const payload = JSON.parse(rawBody.toString('utf-8'));
    const data = payload.eventData ?? {};
    const status = String(data.paymentStatus ?? '').toUpperCase();

    if (payload.eventType === 'SUCCESSFUL_TRANSACTION' && status === 'PAID') {
      return {
        type: 'charge.succeeded',
        providerReference: data.paymentReference,
        raw: payload,
      };
    }
    // A part/over-payment must not activate a plan, but money moved — leave the checkout pending for the platform team.
    if (['PARTIALLY_PAID', 'OVERPAID'].includes(status)) {
      this.logger.error(
        `Monnify billing payment ${data.paymentReference} was ${status}; left pending for manual review.`,
      );
      return { type: 'charge.failed', raw: payload };
    }
    const failed = ['FAILED', 'EXPIRED', 'CANCELLED', 'ABANDONED'].includes(
      status,
    );
    return {
      type: 'charge.failed',
      providerReference: failed ? data.paymentReference : undefined,
      raw: payload,
    };
  }
}
