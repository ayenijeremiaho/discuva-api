// Provider-agnostic billing contract — mirrors the ISmsProvider/IEmailProvider
// pattern already established in this codebase (src/sms/interface/sms-provider.interface.ts,
// src/utility/email-provider/email-provider.interface.ts). Swapping vendors
// means writing a new class and changing a DI binding, no call site changes.
// Interface-only for now — see docs/MULTI_TENANT_MIGRATION.md §9 Phase 3 on
// why PaystackPaymentProvider is deliberately deferred.
export interface PaymentCustomer {
  providerCustomerId: string;
}

export interface CheckoutSession {
  checkoutUrl: string;
  providerSessionId: string;
}

export interface NormalizedPaymentEvent {
  type:
    | 'subscription.activated'
    | 'subscription.renewed'
    | 'subscription.canceled'
    | 'payment.failed';
  tenantId: string;
  providerSubscriptionId?: string;
  providerCustomerId?: string;
  raw: unknown;
}

export interface IPaymentProvider {
  readonly providerName: string;

  createCustomer(tenant: {
    id: string;
    name: string;
    email: string;
  }): Promise<PaymentCustomer>;

  createSubscriptionCheckout(params: {
    tenantId: string;
    planId: string;
    providerCustomerId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession>;

  // Used by the SMS wallet top-up flow (§4.12).
  createOneOffCheckout(params: {
    tenantId: string;
    providerCustomerId: string;
    amountCents: number;
    description: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession>;

  cancelSubscription(providerSubscriptionId: string): Promise<void>;

  verifyAndParseWebhook(
    rawBody: Buffer,
    signatureHeader: string,
  ): NormalizedPaymentEvent;
}

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';
