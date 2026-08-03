// Provider-agnostic billing contract — mirrors the ISmsProvider/IEmailProvider
// pattern already established in this codebase (src/sms/interface/sms-provider.interface.ts,
// src/utility/email-provider/email-provider.interface.ts). Swapping/adding a
// vendor means writing a new class and registering it with
// PaymentProviderRegistryService, no call site changes. Unlike SMS/email
// (one platform-default concrete class chosen at boot via an env var), both
// Paystack and Flutterwave are registered simultaneously — a tenant/checkout
// call picks one by name (docs/MULTI_TENANT_MIGRATION.md §9 Phase 3).
export interface PaymentCustomer {
  providerCustomerId: string;
}

export interface CheckoutSession {
  checkoutUrl: string;
  providerSessionId: string;
}

export type PaymentEventType =
  | 'charge.succeeded'
  | 'charge.failed'
  | 'subscription.canceled';

export interface NormalizedPaymentEvent {
  type: PaymentEventType;
  // Set for charge.succeeded/charge.failed — the reference CheckoutService
  // generated and handed to the provider at checkout-initiation time
  // (Paystack: `reference`, Flutterwave: `tx_ref`), echoed back verbatim on
  // the webhook. This is looked up against BillingCheckoutSession.id to
  // resolve which tenant and which intent (subscription vs wallet top-up)
  // this event belongs to, and for how much — deliberately never trusting
  // amount/tenant identity carried in the webhook payload itself, only that
  // a checkout CheckoutService itself recorded as pending has now resolved.
  providerReference?: string;
  // Set for subscription.canceled — looked up against
  // Subscription.billingProviderSubscriptionId, since a cancellation raised
  // from the provider's own hosted customer portal has no reference from
  // any checkout CheckoutService initiated.
  providerSubscriptionId?: string;
  raw: unknown;
}

export interface IPaymentProvider {
  readonly providerName: string;

  createCustomer(tenant: {
    id: string;
    name: string;
    email: string;
  }): Promise<PaymentCustomer>;

  // `email` is required alongside `providerCustomerId` because both
  // Paystack's Initialize Transaction and Flutterwave's Standard Payment
  // endpoints identify the payer by email at charge time — the earlier
  // createCustomer() call registers a customer record for future reference,
  // it doesn't remove the need to pass email again on every charge.
  createSubscriptionCheckout(params: {
    tenantId: string;
    planId: string;
    providerCustomerId: string;
    email: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession>;

  // Used by the SMS wallet top-up flow (§4.12).
  createOneOffCheckout(params: {
    tenantId: string;
    providerCustomerId: string;
    email: string;
    amountCents: number;
    description: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession>;

  cancelSubscription(providerSubscriptionId: string): Promise<void>;

  // `providerReference` is the same checkout reference used throughout this
  // interface (BillingCheckoutSession.id) — Paystack refunds by
  // transaction reference directly; Flutterwave requires looking up the
  // transaction's own numeric id from the tx_ref first (handled inside each
  // provider, not exposed here). `amountCents` omitted means a full refund.
  refund(providerReference: string, amountCents?: number): Promise<void>;

  verifyAndParseWebhook(
    rawBody: Buffer,
    signatureHeader: string,
  ): NormalizedPaymentEvent;
}

// Registry keys — also PaymentProvider.providerName and
// BillingCheckoutSession.provider / Subscription.paymentProvider's stored
// values, and the ?provider= value accepted by the checkout-initiation
// endpoints.
export const PAYSTACK_PROVIDER_NAME = 'paystack';
export const FLUTTERWAVE_PROVIDER_NAME = 'flutterwave';
