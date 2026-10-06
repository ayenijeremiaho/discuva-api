import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { CreateServiceSlotDto } from '../dto/create-service-slot.dto';

// A service as times of day rather than instants, so it can be placed on any date in the church's timezone.
export type SlotBlueprint = Omit<
  CreateServiceSlotDto,
  'startTime' | 'endTime'
> & {
  startTime: string; // "HH:mm", church-local
  durationMinutes: number;
  dayOffset: number; // days after the occurrence date (multi-day events)
};

const DAY_MS = 86_400_000;

// "YYYY-MM-DD" arithmetic in UTC so it never depends on the server's timezone.
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function dayDiff(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );
}

export function localDate(instant: Date | string, timezone: string): string {
  return formatInTimeZone(new Date(instant), timezone, 'yyyy-MM-dd');
}

export function blueprintToSlotDtos(
  blueprint: SlotBlueprint[],
  date: string,
  timezone: string,
): CreateServiceSlotDto[] {
  return blueprint.map(({ startTime, durationMinutes, dayOffset, ...rest }) => {
    const start = fromZonedTime(
      `${addDays(date, dayOffset ?? 0)}T${startTime}:00`,
      timezone,
    );
    return {
      ...rest,
      startTime: start.toISOString(),
      endTime: new Date(
        start.getTime() + durationMinutes * 60_000,
      ).toISOString(),
    };
  });
}

// The reverse: absolute slots (as the admin form sends them) to a blueprint anchored on the first slot's local date.
export function slotDtosToBlueprint(
  slots: CreateServiceSlotDto[],
  timezone: string,
): { date: string; blueprint: SlotBlueprint[] } {
  const sorted = [...slots].sort(
    (a, b) => Date.parse(a.startTime) - Date.parse(b.startTime),
  );
  const date = localDate(sorted[0].startTime, timezone);
  const blueprint = sorted.map(({ startTime, endTime, ...rest }) => {
    return {
      ...rest,
      startTime: formatInTimeZone(new Date(startTime), timezone, 'HH:mm'),
      durationMinutes: Math.round(
        (Date.parse(endTime) - Date.parse(startTime)) / 60_000,
      ),
      dayOffset: dayDiff(date, localDate(startTime, timezone)),
    };
  });
  return { date, blueprint };
}
