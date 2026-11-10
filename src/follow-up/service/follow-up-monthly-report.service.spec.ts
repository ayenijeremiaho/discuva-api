import { BadRequestException } from '@nestjs/common';
import { FollowUpMonthlyReportService } from './follow-up-monthly-report.service';
import { FirstTimerFieldType } from '../enums/follow-up.enum';

const fields = [
  {
    id: 'wa',
    key: 'whatsapp',
    label: 'WhatsApp group',
    type: FirstTimerFieldType.YES_NO,
    options: [],
    inReport: true,
  },
  {
    id: 'heard',
    key: 'heard_from',
    label: 'How did you hear about us?',
    type: FirstTimerFieldType.CHOICE,
    options: ['Friend', 'Signage', 'Flyers'],
    inReport: true,
  },
  {
    id: 'imp',
    key: 'improve',
    label: 'What could we do better?',
    type: FirstTimerFieldType.LONG_TEXT,
    options: [],
    inReport: true,
  },
  {
    id: 'by',
    key: 'attended_by',
    label: 'Attended to by',
    type: FirstTimerFieldType.TEXT,
    options: [],
    inReport: true,
  },
  {
    id: 'pr',
    key: 'prayer_request',
    label: 'Prayer request',
    type: FirstTimerFieldType.LONG_TEXT,
    options: [],
    inReport: false,
  },
];

const row = (over: object) => ({
  firstname: 'Ada',
  visitedOn: '2026-10-04',
  source: 'WALK_IN',
  wantsToJoinChurch: false,
  wantsToJoinWorkforce: false,
  enjoyedAboutChurch: null,
  answers: {},
  eventName: 'First Service',
  ...over,
});

describe('FollowUpMonthlyReportService', () => {
  const query = jest.fn();
  const service = new FollowUpMonthlyReportService(
    { tx: { query } } as never,
    { findAll: jest.fn().mockResolvedValue(fields) } as never,
    { getOrSet: (_: string, fn: () => unknown) => fn() } as never,
  );

  beforeEach(() => query.mockReset());

  it('refuses a malformed month', () => {
    expect(() => service.getReport('2026-13')).toThrow(BadRequestException);
  });

  it('builds the month from the visit date, with last month as the recap', async () => {
    query
      .mockResolvedValueOnce([
        row({
          wantsToJoinChurch: true,
          enjoyedAboutChurch: 'The warm welcome',
          answers: { wa: true, heard: 'Friend', by: 'Pastor A', pr: 'private' },
        }),
        row({
          firstname: 'Bayo',
          answers: {
            wa: false,
            heard: 'Friend',
            by: 'Pastor A',
            imp: 'Time management',
          },
        }),
        row({
          firstname: 'Chi',
          eventName: 'Second Service',
          wantsToJoinWorkforce: true,
          answers: { heard: 'Signage', by: 'Pastor B' },
        }),
        row({
          firstname: 'Dami',
          visitedOn: '2026-10-11',
          source: 'APP_SIGNUP',
        }),
      ])
      .mockResolvedValueOnce([
        {
          wants: true,
          status: 'COMPLETED',
          outcome: 'STILL_ATTENDING',
          count: '34',
        },
        {
          wants: true,
          status: 'COMPLETED',
          outcome: 'TEMPORARILY_AWAY',
          count: '4',
        },
        { wants: true, status: 'COMPLETED', outcome: 'RELOCATED', count: '3' },
        { wants: true, status: 'UNREACHABLE', outcome: null, count: '29' },
        { wants: false, status: 'PENDING', outcome: null, count: '51' },
      ]);

    const r = await service.getReport('2026-10');

    expect(query.mock.calls[0][1]).toEqual(['2026-10-01', '2026-10-31']);
    expect(query.mock.calls[1][1]).toEqual([
      '2026-09-01',
      '2026-09-30',
      'FIRST_TIMER',
    ]);
    expect(r.totals).toEqual({
      firstTimers: 4,
      wantsToJoinChurch: 1,
      wantsToJoinWorkforce: 1,
    });
    expect(r.byDate).toEqual([
      { date: '2026-10-04', count: 3 },
      { date: '2026-10-11', count: 1 },
    ]);
    expect(r.strongestDay).toEqual({ date: '2026-10-04', count: 3 });
    expect(r.services[0]).toEqual({
      date: '2026-10-04',
      eventName: 'First Service',
      count: 2,
      attendedBy: ['Pastor A'],
    });
    expect(r.services[1].attendedBy).toEqual(['Pastor B']);
    expect(r.liked).toEqual([{ name: 'Ada', text: 'The warm welcome' }]);

    const byId = Object.fromEntries(r.fields.map((f) => [f.id, f]));
    expect(byId.wa.counts).toEqual([
      { option: 'Yes', count: 1 },
      { option: 'No', count: 1 },
    ]);
    expect(byId.heard.counts).toEqual([
      { option: 'Friend', count: 2 },
      { option: 'Signage', count: 1 },
      { option: 'Flyers', count: 0 },
    ]);
    expect(byId.imp.quotes).toEqual([
      { name: 'Bayo', text: 'Time management' },
    ]);
    expect(byId.by).toBeUndefined();
    expect(byId.pr).toBeUndefined();

    expect(r.recap).toEqual({
      month: '2026-09',
      firstTimers: 121,
      wantedToJoin: 70,
      outcomes: [
        { outcome: 'STILL_ATTENDING', label: 'Still attending', count: 34 },
        { outcome: 'TEMPORARILY_AWAY', label: 'Temporarily away', count: 4 },
        { outcome: 'RELOCATED', label: 'Relocated', count: 3 },
      ],
      unreachable: 29,
      notYetReached: 0,
    });
  });

  it('recaps December when the report is for January', async () => {
    query.mockResolvedValue([]);
    const r = await service.getReport('2027-01');
    expect(r.recap.month).toBe('2026-12');
    expect(r.strongestDay).toBeNull();
  });
});
