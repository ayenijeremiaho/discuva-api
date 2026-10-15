export enum LocationFlagEnum {
  // Exactly the same coordinates as one of this member's earlier check-ins.
  REPEATED_SPOT = 'REPEATED_SPOT',
  // Exactly the same coordinates as someone else's check-in for this event.
  SHARED_SPOT = 'SHARED_SPOT',
  // Phones don't report sub-metre precision indoors; fake-GPS apps often do.
  PERFECT_ACCURACY = 'PERFECT_ACCURACY',
  // Real fixes carry many decimals; typed-in coordinates rarely do.
  ROUNDED_COORDINATES = 'ROUNDED_COORDINATES',
}

const decimals = (n: number): number => {
  const s = String(n);
  if (s.includes('e')) return 0;
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
};

// Flags readable from one fix alone; history-based ones need the database.
export function intrinsicLocationFlags(location: {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}): LocationFlagEnum[] {
  const flags: LocationFlagEnum[] = [];
  // typeof, not !== undefined: a client may send accuracy: null, and null < 1 is true.
  if (typeof location.accuracy === 'number' && location.accuracy < 1) {
    flags.push(LocationFlagEnum.PERFECT_ACCURACY);
  }
  if (decimals(location.latitude) <= 4 && decimals(location.longitude) <= 4) {
    flags.push(LocationFlagEnum.ROUNDED_COORDINATES);
  }
  return flags;
}
