interface IcsEventParams {
  uid: string;
  startTime: Date;
  endTime: Date;
  summary: string;
  description: string;
}

function toIcsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function escapeIcsText(text: string): string {
  return text.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
}

export function buildServiceSlotIcs(params: IcsEventParams): Buffer {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Discuva//Service Programme//EN',
    'BEGIN:VEVENT',
    `UID:${params.uid}@service-programme`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(params.startTime)}`,
    `DTEND:${toIcsUtc(params.endTime)}`,
    `SUMMARY:${escapeIcsText(params.summary)}`,
    `DESCRIPTION:${escapeIcsText(params.description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return Buffer.from(lines.join('\r\n'), 'utf-8');
}
