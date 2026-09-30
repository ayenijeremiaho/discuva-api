import { In, Repository } from 'typeorm';
import { GivingCheckoutSession } from '../entity/giving-checkout-session.entity';

// "Paid Via" wording shared by the giving statement and the admin pledge export.
const GIVING_PROVIDER_LABELS: Record<string, string> = {
  paystack: 'Paystack',
  flutterwave: 'Flutterwave',
  kora: 'Korapay',
  stripe: 'Stripe',
  monnify: 'Monnify',
};

const CHANNEL_LABELS: Record<string, string> = {
  card: 'Card',
  bank: 'Bank',
  bank_transfer: 'Bank Transfer',
  ussd: 'USSD',
  qr: 'QR',
  mobile_money: 'Mobile Money',
  eft: 'EFT',
  apple_pay: 'Apple Pay',
  phone_number: 'Phone Number',
};

export type CheckoutSummary = Pick<
  GivingCheckoutSession,
  'id' | 'provider' | 'paymentChannel'
>;

export function providerLabel(provider?: string | null): string | null {
  if (!provider) return null;
  return (
    GIVING_PROVIDER_LABELS[provider.toLowerCase()] ??
    provider.charAt(0).toUpperCase() + provider.slice(1)
  );
}

// "Paystack · Card" when the provider reported a channel, "Paystack" otherwise, "Online" for older gateway rows.
export function onlinePaidVia(
  checkout: CheckoutSummary | undefined,
  provider: string | null,
  isOnline: boolean,
): string | null {
  const name = providerLabel(checkout?.provider ?? provider);
  if (!name) return isOnline ? 'Online' : null;
  const channel = checkout?.paymentChannel;
  if (!channel) return name;
  const label =
    CHANNEL_LABELS[channel.toLowerCase()] ??
    channel.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return `${name} · ${label}`;
}

// One query for every giving_… reference in a batch.
export async function loadCheckoutSummaries(
  repo: Repository<GivingCheckoutSession>,
  references: (string | null | undefined)[],
): Promise<Map<string, CheckoutSummary>> {
  const ids = [
    ...new Set(
      references.filter((ref): ref is string => !!ref?.startsWith('giving_')),
    ),
  ];
  if (!ids.length) return new Map();
  const sessions = await repo.find({
    where: { id: In(ids) },
    select: { id: true, provider: true, paymentChannel: true },
  });
  return new Map(sessions.map((s) => [s.id, s]));
}
