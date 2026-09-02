import { Transform } from 'class-transformer';
import {
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';

// This is a multi-tenant platform — CURRENCY_LOCALE/Tenant.currency are
// both configurable per deployment (see TenantCurrencyService), so a
// tenant is never assumed to be Nigerian. Nigeria is only the *fallback*
// region used to interpret a LOCAL-format number with no country code
// (e.g. "0801234567") when the caller doesn't supply a better one — any
// number already carrying its own country code (typed with a leading
// "+", or as a bare international dialing code) is parsed correctly
// regardless of this default. Matches CURRENCY_LOCALE's own convenience
// default ("en-NG") without hardcoding phone handling to Nigeria only.
const FALLBACK_REGION: CountryCode = 'NG';

// Parses/normalizes a phone number to E.164 (e.g. "+2348012345678"),
// using `defaultRegion` only to interpret a number with no explicit
// country code — pass the tenant's own region when known (see
// resolvePhoneRegion in form-submission.service.ts) rather than relying
// on the Nigeria fallback for every tenant. Returns null for anything
// that doesn't parse as a valid number for its (explicit or assumed)
// country — never silently mangled into something else.
export function normalizePhoneNumber(
  raw: string,
  defaultRegion: CountryCode = FALLBACK_REGION,
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parsed = parsePhoneNumberFromString(trimmed, defaultRegion);
  return parsed?.isValid() ? parsed.number : null;
}

/**
 * class-transformer decorator counterpart to normalizePhoneNumber, for use
 * on a fixed DTO property (e.g. @IsString() @NormalizePhone() phoneNumber).
 * Leaves the raw value untouched if it doesn't normalize — validation
 * decorators on the property are what should reject it, not this.
 */
export function NormalizePhone(defaultRegion?: CountryCode) {
  return Transform(({ value }) =>
    typeof value === 'string'
      ? (normalizePhoneNumber(value, defaultRegion) ?? value)
      : value,
  );
}
