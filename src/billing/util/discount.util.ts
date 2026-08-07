import { Subscription } from '../entity/subscription.entity';
import { DiscountType } from '../enum/discount-type.enum';

type DiscountFields = Pick<
  Subscription,
  'discountType' | 'discountValue' | 'discountExpiresAt'
>;

// Shared by PlatformAnalyticsService's MRR math and CheckoutService's
// billing summary so both report the same comped price — never touches
// checkout/provider calls (see subscription.entity.ts's discountType
// comment for why a comp can't change actual provider auto-renewal amounts).
export function computeEffectivePriceCents(
  priceCents: number,
  subscription: DiscountFields | null | undefined,
): number {
  if (!subscription?.discountType || subscription.discountValue == null) {
    return priceCents;
  }
  if (
    subscription.discountExpiresAt &&
    subscription.discountExpiresAt <= new Date()
  ) {
    return priceCents;
  }
  if (subscription.discountType === DiscountType.PERCENTAGE) {
    return Math.round(priceCents * (1 - subscription.discountValue / 100));
  }
  return Math.max(priceCents - subscription.discountValue, 0);
}
