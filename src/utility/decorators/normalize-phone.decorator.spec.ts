import { normalizePhoneNumber } from './normalize-phone.decorator';

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

  // The whole point of using a real phone-parsing library instead of
  // hand-rolled Nigeria-only regex: any number carrying its own country
  // code parses correctly regardless of the default region — this is a
  // multi-tenant platform, not a Nigeria-only one (see CURRENCY_LOCALE).
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
