import { computeEffectivePriceCents } from './discount.util';
import { DiscountType } from '../enum/discount-type.enum';

describe('computeEffectivePriceCents', () => {
  it('returns the full price when there is no subscription', () => {
    expect(computeEffectivePriceCents(10000, null)).toBe(10000);
  });

  it('returns the full price when the subscription has no discount', () => {
    expect(
      computeEffectivePriceCents(10000, {
        discountType: null,
        discountValue: null,
        discountExpiresAt: null,
      }),
    ).toBe(10000);
  });

  it('applies a PERCENTAGE discount, rounding to the nearest cent', () => {
    expect(
      computeEffectivePriceCents(10000, {
        discountType: DiscountType.PERCENTAGE,
        discountValue: 20,
        discountExpiresAt: null,
      }),
    ).toBe(8000);

    expect(
      computeEffectivePriceCents(999, {
        discountType: DiscountType.PERCENTAGE,
        discountValue: 33,
        discountExpiresAt: null,
      }),
    ).toBe(Math.round(999 * 0.67));
  });

  it('applies a FIXED_AMOUNT discount, floored at zero', () => {
    expect(
      computeEffectivePriceCents(10000, {
        discountType: DiscountType.FIXED_AMOUNT,
        discountValue: 3000,
        discountExpiresAt: null,
      }),
    ).toBe(7000);

    expect(
      computeEffectivePriceCents(1000, {
        discountType: DiscountType.FIXED_AMOUNT,
        discountValue: 5000,
        discountExpiresAt: null,
      }),
    ).toBe(0);
  });

  it('ignores an expired discount', () => {
    expect(
      computeEffectivePriceCents(10000, {
        discountType: DiscountType.PERCENTAGE,
        discountValue: 50,
        discountExpiresAt: new Date('2020-01-01'),
      }),
    ).toBe(10000);
  });

  it('applies a discount that has not expired yet', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    expect(
      computeEffectivePriceCents(10000, {
        discountType: DiscountType.PERCENTAGE,
        discountValue: 50,
        discountExpiresAt: future,
      }),
    ).toBe(5000);
  });
});
