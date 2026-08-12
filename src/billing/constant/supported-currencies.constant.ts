// Plan.currency is passed straight through to whichever payment provider
// processes a subscription charge (PaymentProviderRegistryService) — none of
// Paystack/Flutterwave/Kora integrations validate that Discuva's own
// merchant account is actually enabled to settle in a given currency, so an
// unsupported currency here would only fail at charge time, not plan-creation
// time. Restricted to what's actually been verified settleable for now;
// widen this list only after confirming the new currency with each active
// provider's Discuva-owned account.
export const SUPPORTED_BILLING_CURRENCIES = ['NGN', 'USD'] as const;
