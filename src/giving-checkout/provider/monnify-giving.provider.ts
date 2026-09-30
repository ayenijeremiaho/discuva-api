import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  MonnifyApi,
  MonnifyCredentials,
  isValidMonnifySignature,
} from '../../utility/monnify/monnify-api';
import {
  GivingCheckoutParams,
  GivingCheckoutResult,
  GivingPaymentDetails,
  GivingProviderCredentials,
  IGivingProvider,
  MONNIFY_GIVING_PROVIDER_NAME,
  NormalizedGivingEvent,
} from '../interface/giving-provider.interface';

// Monnify reports these; mapped to the same channel names Paystack uses so statements read alike.
const CHANNELS: Record<string, string> = {
  CARD: 'card',
  ACCOUNT_TRANSFER: 'bank_transfer',
  USSD: 'ussd',
  PHONE_NUMBER: 'phone_number',
};

// Monnify (by Moniepoint) for church giving, with each church's own apiKey/secretKey/contractCode.
@Injectable()
export class MonnifyGivingProvider implements IGivingProvider {
  readonly providerName = MONNIFY_GIVING_PROVIDER_NAME;
  private readonly logger = new Logger(MonnifyGivingProvider.name);
  private readonly api = new MonnifyApi(this.logger);

  async createCheckoutSession(
    params: GivingCheckoutParams,
  ): Promise<GivingCheckoutResult> {
    const checkoutUrl = await this.api.initTransaction(
      params.credentials as unknown as MonnifyCredentials,
      {
        amountCents: params.amountCents,
        currency: params.currency,
        reference: params.reference,
        customerName: params.payerName,
        customerEmail: params.payerEmail,
        description: 'Giving',
        redirectUrl: params.successUrl,
      },
    );
    return { checkoutUrl };
  }

  verifyAndParseWebhook(
    rawBody: Buffer,
    signatureHeader: string,
    credentials: GivingProviderCredentials,
  ): NormalizedGivingEvent {
    if (
      !isValidMonnifySignature(rawBody, signatureHeader, credentials.secretKey)
    ) {
      throw new InternalServerErrorException('Invalid Monnify signature.');
    }

    const payload = JSON.parse(rawBody.toString('utf-8'));
    const data = payload.eventData ?? {};
    const status = String(data.paymentStatus ?? '').toUpperCase();

    // PARTIALLY_PAID/OVERPAID still moved money, so they go through as charges and the amount check holds them for review.
    if (
      payload.eventType === 'SUCCESSFUL_TRANSACTION' &&
      ['PAID', 'PARTIALLY_PAID', 'OVERPAID'].includes(status)
    ) {
      return {
        type: 'charge.succeeded',
        providerReference: data.paymentReference,
        payment: MonnifyGivingProvider.paymentDetails(data, status),
        raw: payload,
      };
    }
    // Only an explicit failure ends a pending checkout; other events (refunds, settlements) are ignored.
    const failed = ['FAILED', 'EXPIRED', 'CANCELLED', 'ABANDONED'].includes(
      status,
    );
    return {
      type: 'charge.failed',
      providerReference: failed ? data.paymentReference : undefined,
      raw: payload,
    };
  }

  private static paymentDetails(
    data: Record<string, any>,
    status: string,
  ): GivingPaymentDetails {
    const minor = (v: unknown) =>
      v === null || v === undefined || v === '' || Number.isNaN(Number(v))
        ? null
        : Math.round(Number(v) * 100);
    const str = (v: unknown) =>
      v === null || v === undefined || v === '' ? null : String(v);
    const paid = minor(data.amountPaid);
    const settled = minor(data.settlementAmount);
    const paidOn = data.paidOn ? new Date(data.paidOn) : null;
    const method = String(data.paymentMethod ?? '').toUpperCase();
    return {
      transactionId: str(data.transactionReference),
      channel: CHANNELS[method] ?? (method ? method.toLowerCase() : null),
      paidAt: paidOn && !Number.isNaN(paidOn.getTime()) ? paidOn : null,
      // A PAID status is Monnify's own confirmation of the full amount (even when fees are added for the payer),
      // so the amount is only checked for part/over-payments.
      amountCents: status === 'PAID' ? null : paid,
      currency: str(data.currency),
      feesCents: paid !== null && settled !== null ? paid - settled : null,
      details: {
        cardType: str(data.cardDetails?.cardType),
        last4: str(data.cardDetails?.last4),
        bank: str(data.paymentSourceInformation?.[0]?.bankCode),
        gatewayResponse: status || null,
      },
    };
  }
}
