import { Transform } from 'class-transformer';
import { registerDecorator, type ValidationOptions } from 'class-validator';
import {
  getExampleNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';
import examples from 'libphonenumber-js/mobile/examples';

// Only used for local-format numbers; an explicit country code always wins.
const FALLBACK_REGION: CountryCode = 'NG';

export function phoneRegionFromLocale(locale?: string): CountryCode {
  const region = locale?.split(/[-_]/)[1]?.toUpperCase();
  return (
    region && region.length === 2 ? region : FALLBACK_REGION
  ) as CountryCode;
}

// Returns E.164 (e.g. "+2348012345678"), or null if not a valid number.
export function normalizePhoneNumber(
  raw: string,
  defaultRegion: CountryCode = FALLBACK_REGION,
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parsed = parsePhoneNumberFromString(trimmed, defaultRegion);
  return parsed?.isValid() ? parsed.number : null;
}

// Read per request, not at import, so env is loaded by then.
function deploymentPhoneRegion(): CountryCode {
  return phoneRegionFromLocale(process.env.CURRENCY_LOCALE);
}

// Blank → undefined (skipped by @IsOptional()), or null with clearable to erase a stored number.
export function NormalizePhone(
  options: { defaultRegion?: CountryCode; clearable?: boolean } = {},
) {
  return Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    if (!value.trim()) return options.clearable ? null : undefined;
    return (
      normalizePhoneNumber(
        value,
        options.defaultRegion ?? deploymentPhoneRegion(),
      ) ?? value
    );
  });
}

export function invalidPhoneMessage(
  region: CountryCode = deploymentPhoneRegion(),
): string {
  const example = getExampleNumber(region, examples)?.formatNational();
  const country = new Intl.DisplayNames(['en'], { type: 'region' }).of(region);
  return `Please enter a valid phone number${example ? ` (e.g. ${example})` : ''}, or include the country code (e.g. ${region === 'GB' ? '+1' : '+44'}…) for numbers outside ${country ?? region}.`;
}

export function IsNormalizedPhone(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isNormalizedPhone',
      target: object.constructor,
      propertyName,
      options: {
        message: () => invalidPhoneMessage(),
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && normalizePhoneNumber(value) === value,
      },
    });
  };
}
