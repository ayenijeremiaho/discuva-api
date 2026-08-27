export interface IcsEventParams {
  // Full UID, including whatever domain-like suffix the caller wants
  // (e.g. `${slotId}@service-programme`) — this builder doesn't own
  // identity/namespacing, callers do, so existing UIDs (and therefore
  // "is this an update to the same calendar event" behavior in the
  // recipient's calendar app) are unaffected by which module calls this.
  uid: string;
  startTime: Date;
  endTime: Date;
  summary: string;
  description: string;
  location?: string;
}

function toIcsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function escapeIcsText(text: string): string {
  return text.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
}

export function buildIcsEvent(params: IcsEventParams): Buffer {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Discuva//Calendar//EN',
    'BEGIN:VEVENT',
    `UID:${params.uid}`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(params.startTime)}`,
    `DTEND:${toIcsUtc(params.endTime)}`,
    `SUMMARY:${escapeIcsText(params.summary)}`,
    `DESCRIPTION:${escapeIcsText(params.description)}`,
    ...(params.location ? [`LOCATION:${escapeIcsText(params.location)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return Buffer.from(lines.join('\r\n'), 'utf-8');
}
