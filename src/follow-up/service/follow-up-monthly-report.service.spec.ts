import { BadRequestException } from '@nestjs/common';
import {
  FollowUpMonthlyReportService,
  highlightsOf,
} from './follow-up-monthly-report.service';
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
    expect(r.change).toBeNull();
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

  describe('highlightsOf', () => {
    const base = {
      month: '2026-10',
      from: '2026-10-01',
      to: '2026-10-31',
      totals: {
        firstTimers: 75,
        wantsToJoinChurch: 36,
        wantsToJoinWorkforce: 17,
      },
      byDate: [
        { date: '2026-10-04', count: 15 },
        { date: '2026-10-11', count: 28 },
      ],
      strongestDay: { date: '2026-10-11', count: 28 },
      services: [],
      bySource: [],
      liked: [],
      fields: [
        {
          id: 'h',
          key: 'heard_from',
          label: 'Heard',
          type: FirstTimerFieldType.CHOICE,
          answered: 75,
          counts: [
            { option: 'Other', count: 30 },
            { option: 'Friend', count: 27 },
          ],
        },
        {
          id: 'i',
          key: 'improve',
          label: 'Better',
          type: FirstTimerFieldType.LONG_TEXT,
          answered: 1,
          quotes: [{ name: 'A', text: 'Time management' }],
        },
      ],
      recap: {
        month: '2026-09',
        firstTimers: 121,
        wantedToJoin: 70,
        outcomes: [
          { outcome: 'STILL_ATTENDING', label: 'Still attending', count: 34 },
        ],
        unreachable: 29,
        notYetReached: 2,
      },
    } as never;

    it('praises what is going well and flags what needs attention', () => {
      const { good, watch } = highlightsOf(base);
      expect(good).toEqual(
        expect.arrayContaining([
          '48% of first-timers want to join.',
          '"Friend" is how most first-timers heard about you (27).',
        ]),
      );
      expect(watch).toEqual(
        expect.arrayContaining([
          'First-timers are down 38% on last month (75, against 121).',
          expect.stringContaining(
            "29 of last month's first-timers couldn't be reached (41%)",
          ),
          "2 people from last month still haven't been followed up.",
          "1 suggestion on what to do better. It's at the end of this report.",
        ]),
      );
    });

    it("doesn't turn a handful of people into percentages", () => {
      const { good, watch } = highlightsOf({
        ...(base as object),
        totals: {
          firstTimers: 6,
          wantsToJoinChurch: 3,
          wantsToJoinWorkforce: 1,
        },
        fields: [],
        recap: {
          month: '2026-09',
          firstTimers: 3,
          wantedToJoin: 2,
          outcomes: [
            { outcome: 'STILL_ATTENDING', label: 'Still attending', count: 1 },
          ],
          unreachable: 1,
          notYetReached: 1,
        },
      } as never);
      expect(good).toEqual([]);
      expect(watch).toEqual([
        "1 person from last month still hasn't been followed up.",
      ]);
    });

    it('says nothing about a month with too little to go on', () => {
      expect(
        highlightsOf({
          ...(base as object),
          totals: {
            firstTimers: 2,
            wantsToJoinChurch: 0,
            wantsToJoinWorkforce: 0,
          },
          byDate: [],
          strongestDay: null,
          fields: [],
          recap: {
            month: '2026-09',
            firstTimers: 0,
            wantedToJoin: 0,
            outcomes: [],
            unreachable: 0,
            notYetReached: 0,
          },
        } as never),
      ).toEqual({ good: [], watch: [] });
    });
  });
});
