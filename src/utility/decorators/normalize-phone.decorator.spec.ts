import { plainToInstance } from 'class-transformer';
import { IsOptional, validate } from 'class-validator';
import {
  IsNormalizedPhone,
  invalidPhoneMessage,
  NormalizePhone,
  normalizePhoneNumber,
  phoneRegionFromLocale,
} from './normalize-phone.decorator';

describe('phoneRegionFromLocale', () => {
  it('extracts a country region from a locale', () => {
    expect(phoneRegionFromLocale('en-NG')).toBe('NG');
    expect(phoneRegionFromLocale('en_US')).toBe('US');
  });

  it('falls back to Nigeria for an absent or regionless locale', () => {
    expect(phoneRegionFromLocale(undefined)).toBe('NG');
    expect(phoneRegionFromLocale('en')).toBe('NG');
  });
});

describe('normalizePhoneNumber', () => {
  it('converts a leading-zero Nigerian number to E.164, defaulting to NG', () => {
    expect(normalizePhoneNumber('08012345678')).toBe('+2348012345678');
  });

  it('converts a plain 234-prefixed number to E.164', () => {
    expect(normalizePhoneNumber('2348012345678')).toBe('+2348012345678');
  });

  it('leaves an already E.164 number unchanged', () => {
    expect(normalizePhoneNumber('+2348012345678')).toBe('+2348012345678');
  });

  it('strips spaces and dashes before parsing', () => {
    expect(normalizePhoneNumber('080 1234 5678')).toBe('+2348012345678');
    expect(normalizePhoneNumber('0801-234-5678')).toBe('+2348012345678');
  });

  it('returns null for a number too short to be valid', () => {
    expect(normalizePhoneNumber('0801234567')).toBeNull();
  });

  it('correctly parses a non-Nigerian number in full international format, regardless of the default region', () => {
    expect(normalizePhoneNumber('+14155552671', 'NG')).toBe('+14155552671');
    expect(normalizePhoneNumber('+442079460958', 'NG')).toBe('+442079460958');
  });

  it('interprets a local-format number using the given default region', () => {
    expect(normalizePhoneNumber('4155552671', 'US')).toBe('+14155552671');
  });

  it('falls back to NG when no default region is given', () => {
    expect(normalizePhoneNumber('08012345678')).toBe('+2348012345678');
  });

  it('returns null for garbage input', () => {
    expect(normalizePhoneNumber('not a phone number')).toBeNull();
    expect(normalizePhoneNumber('')).toBeNull();
    expect(normalizePhoneNumber('   ')).toBeNull();
  });
});

class PhoneDto {
  @IsOptional()
  @NormalizePhone()
  @IsNormalizedPhone()
  phone?: string;
}

class ClearablePhoneDto {
  @IsOptional()
  @NormalizePhone({ clearable: true })
  @IsNormalizedPhone()
  phone?: string | null;
}

class RequiredPhoneDto {
  @NormalizePhone()
  @IsNormalizedPhone()
  phone: string;
}

describe('NormalizePhone + IsNormalizedPhone', () => {
  const originalLocale = process.env.CURRENCY_LOCALE;

  afterEach(() => {
    process.env.CURRENCY_LOCALE = originalLocale;
  });

  async function run(phone: unknown) {
    const dto = plainToInstance(PhoneDto, { phone });
    return { dto, errors: await validate(dto) };
  }

  it('stores a local-format number in E.164', async () => {
    const { dto, errors } = await run('08012345678');
    expect(errors).toHaveLength(0);
    expect(dto.phone).toBe('+2348012345678');
  });

  it('keeps a number that already has a country code', async () => {
    const { dto, errors } = await run('+44 7911 123456');
    expect(errors).toHaveLength(0);
    expect(dto.phone).toBe('+447911123456');
  });

  it('uses the CURRENCY_LOCALE region for local-format numbers', async () => {
    process.env.CURRENCY_LOCALE = 'en-US';
    const { dto, errors } = await run('(415) 555-2671');
    expect(errors).toHaveLength(0);
    expect(dto.phone).toBe('+14155552671');
  });

  it.each(['', '   '])(
    'treats blank %p as omitted on an optional field',
    async (phone) => {
      const { dto, errors } = await run(phone);
      expect(errors).toHaveLength(0);
      expect(dto.phone).toBeUndefined();
    },
  );

  it.each(['12345', '0801234567', 'not a phone'])(
    'rejects %p',
    async (phone) => {
      const { errors } = await run(phone);
      expect(errors[0].constraints).toHaveProperty('isNormalizedPhone');
    },
  );

  it('returns a region-aware message', async () => {
    const { errors } = await run('0801234567');
    expect(errors[0].constraints?.isNormalizedPhone).toBe(
      'Please enter a valid phone number (e.g. 0802 123 4567), or include the country code (e.g. +44…) for numbers outside Nigeria.',
    );
  });

  it('never suggests the tenant its own country code as the foreign example', () => {
    expect(invalidPhoneMessage('GB')).toContain(
      '(e.g. +1…) for numbers outside United Kingdom',
    );
  });

  it('rejects a non-string value', async () => {
    const { errors } = await run(8012345678);
    expect(errors[0].constraints).toHaveProperty('isNormalizedPhone');
  });

  it('turns blank into null on a clearable field', async () => {
    const dto = plainToInstance(ClearablePhoneDto, { phone: ' ' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.phone).toBeNull();
  });

  it('rejects blank on a required field', async () => {
    const dto = plainToInstance(RequiredPhoneDto, { phone: '' });
    const errors = await validate(dto);
    expect(errors[0].constraints).toHaveProperty('isNormalizedPhone');
  });

  it('allows the field to be omitted', async () => {
    const { errors } = await run(undefined);
    expect(errors).toHaveLength(0);
  });
});
