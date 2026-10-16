// What saving an event would do, worked out without saving anything.

// One clash, in parts: the service being saved, what it overlaps, and (under Groups apart) why that matters.
export interface OverlapDetail {
  service: { name: string; time: string };
  other: { eventName: string; serviceName: string; time: string };
  why: string | null;
}

// READY: will be saved. SKIPPED: a series date left out (or, on an edit, left as it was) because it clashes.
// BLOCKED: a one-off that can't be saved.
export type PreviewStatus = 'READY' | 'SKIPPED' | 'BLOCKED';

export interface PreviewDate {
  // Church-local YYYY-MM-DD.
  date: string;
  startTime: string;
  endTime: string;
  status: PreviewStatus;
  clashes: OverlapDetail[];
  // Series edit: services were added or removed, so this date is recreated and its draft programme rebuilt.
  recreated?: boolean;
}

// A series date not created yet that will step aside for a one-off.
export interface GivingWay {
  seriesName: string;
  date: string;
  // "Sun 5 Apr"
  day: string;
  clash: OverlapDetail;
}

export interface EventPreview {
  dates: PreviewDate[];
  givingWay: GivingWay[];
  canSave: boolean;
  // Series edit: upcoming dates with check-ins or a session, which the edit doesn't touch.
  keptWithHistory?: number;
  movedTo?: string;
}
