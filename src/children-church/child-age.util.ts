export const CHILD_AGE_RANGES = [
  '0-3',
  '4-5',
  '6-8',
  '9-12',
  '13-15',
  '16-19',
] as const;
export type ChildAgeRange = (typeof CHILD_AGE_RANGES)[number];

// A church's own age group, kept in months so it ages the same way as the fixed ranges.
export const monthsRange = (min: number, max: number) => `${min}-${max}m`;

function monthsBetween(from: Date, to: Date): number {
  let months =
    (to.getFullYear() - from.getFullYear()) * 12 +
    (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months--;
  return months;
}

// A range has no birthday, so place the child mid-range on the day it was given and let them age from there.
export function childAgeInMonths(
  child: {
    dateOfBirth?: string | null;
    ageRange?: string | null;
    ageRangeSetOn?: string | null;
  },
  today: Date = new Date(),
): number | null {
  if (child.dateOfBirth) {
    return monthsBetween(new Date(child.dateOfBirth), today);
  }
  if (!child.ageRange || !child.ageRangeSetOn) return null;
  const inMonths = child.ageRange.endsWith('m');
  const [min, max] = child.ageRange.replace('m', '').split('-').map(Number);
  const midpoint = inMonths
    ? Math.floor((min + max) / 2)
    : Math.floor(((min + max + 1) * 12) / 2);
  return (
    midpoint + Math.max(0, monthsBetween(new Date(child.ageRangeSetOn), today))
  );
}
