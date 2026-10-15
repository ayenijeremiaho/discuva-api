import { UtilityService } from './utility.service';

// Reference distances from GeographicLib's WGS84 geodesic (Python, geographiclib 2.0).
const REFERENCE: [string, [number, number, number, number], number][] = [
  ['Lagos, due north', [6.5244, 3.3792, 6.5254, 3.3792], 110.58861508562453],
  ['Lagos, diagonal', [6.5244, 3.3792, 6.5251, 3.3799], 109.48438215918894],
  ['London', [51.5074, -0.1278, 51.508, -0.127], 86.84026912462372],
  ['Sydney', [-33.8688, 151.2093, -33.87, 151.21], 148.02566515936184],
  [
    'across the 180th meridian',
    [0, 179.9995, 0, -179.9995],
    111.31949079064123,
  ],
];

describe('UtilityService.calculateDistanceInMeters', () => {
  it.each(REFERENCE)(
    'matches the WGS84 reference to the millimetre: %s',
    (_place, [lat1, lon1, lat2, lon2], expected) => {
      expect(
        UtilityService.calculateDistanceInMeters(lat1, lon1, lat2, lon2),
      ).toBeCloseTo(expected, 3);
    },
  );

  it('is zero for the same point and the same either way round', () => {
    expect(UtilityService.calculateDistanceInMeters(6.5, 3.4, 6.5, 3.4)).toBe(
      0,
    );
    expect(
      UtilityService.calculateDistanceInMeters(6.5244, 3.3792, 6.53, 3.38),
    ).toBeCloseTo(
      UtilityService.calculateDistanceInMeters(6.53, 3.38, 6.5244, 3.3792),
      6,
    );
  });

  it('accepts coordinates that arrive as text, as some clients send them', () => {
    expect(
      UtilityService.calculateDistanceInMeters(
        '6.5244' as unknown as number,
        '3.3792' as unknown as number,
        6.5254,
        3.3792,
      ),
    ).toBeCloseTo(110.5886, 3);
  });
});
