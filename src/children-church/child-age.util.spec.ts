import { childAgeInMonths } from './child-age.util';

describe('childAgeInMonths', () => {
  const today = new Date(2026, 10, 16);

  it('uses the date of birth when there is one', () => {
    expect(childAgeInMonths({ dateOfBirth: '2021-11-16' }, today)).toBe(60);
  });

  it('places an age range at its midpoint on the day it was given', () => {
    expect(
      childAgeInMonths({ ageRange: '4-5', ageRangeSetOn: '2026-11-16' }, today),
    ).toBe(60);
    expect(
      childAgeInMonths({ ageRange: '0-3', ageRangeSetOn: '2026-11-16' }, today),
    ).toBe(24);
  });

  it('ages a range child from the day it was given', () => {
    expect(
      childAgeInMonths({ ageRange: '4-5', ageRangeSetOn: '2025-11-16' }, today),
    ).toBe(72);
  });

  it('returns null when there is no age at all', () => {
    expect(childAgeInMonths({}, today)).toBeNull();
  });
});
