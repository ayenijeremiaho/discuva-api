import { intrinsicLocationFlags, LocationFlagEnum } from './location-flags';

describe('intrinsicLocationFlags', () => {
  it('passes a normal phone fix', () => {
    expect(
      intrinsicLocationFlags({
        latitude: 6.524412345,
        longitude: 3.379198761,
        accuracy: 23.4,
      }),
    ).toEqual([]);
  });

  it('flags sub-metre precision, which phones do not report indoors', () => {
    expect(
      intrinsicLocationFlags({
        latitude: 6.524412345,
        longitude: 3.379198761,
        accuracy: 0,
      }),
    ).toEqual([LocationFlagEnum.PERFECT_ACCURACY]);
  });

  it('flags coordinates rounded to 4 decimals or fewer, as typed-in ones are', () => {
    expect(
      intrinsicLocationFlags({
        latitude: 6.5244,
        longitude: 3.38,
        accuracy: 10,
      }),
    ).toEqual([LocationFlagEnum.ROUNDED_COORDINATES]);
    expect(
      intrinsicLocationFlags({
        latitude: 6.5244,
        longitude: 3.379198761,
        accuracy: 10,
      }),
    ).toEqual([]);
  });

  it('does not flag a fix without a reported accuracy (older app versions)', () => {
    expect(
      intrinsicLocationFlags({ latitude: 6.524412345, longitude: 3.379198761 }),
    ).toEqual([]);
  });

  it('treats accuracy: null as not reported, not as perfect precision', () => {
    expect(
      intrinsicLocationFlags({
        latitude: 6.524412345,
        longitude: 3.379198761,
        accuracy: null,
      }),
    ).toEqual([]);
  });
});
