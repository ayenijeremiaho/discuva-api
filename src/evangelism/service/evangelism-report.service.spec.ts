import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  EvangelismReportService,
  resolveRange,
  toCsv,
} from './evangelism-report.service';
import { Convert } from '../entity/convert.entity';
import { ConvertService } from './convert.service';
import { EvangelismSettingsService } from './evangelism-settings.service';
import { CacheService } from '../../utility/service/cache.service';

const mockConvertRepo = { query: jest.fn() };
const mockConvertService = { findForExport: jest.fn() };
const mockSettingsService = {
  get: jest.fn().mockResolvedValue({ overdueDays: 7, autoAssign: true }),
};
const mockCacheService = {
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
  key: jest.fn().mockReturnValue('cache-key'),
  getOrSet: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
};

// Answers each report query by a fragment of its SQL.
function answer(sql: string): unknown[] {
  if (sql.includes('GROUP BY status')) {
    return [
      { status: 'UNSAVED', count: '3' },
      { status: 'SAVED', count: '2' },
    ];
  }
  if (sql.includes('DATE_TRUNC') && sql.includes('first_timer_linked_at'))
    return [{ period: '2026-09-21', count: '2' }];
  if (sql.includes('DATE_TRUNC') && sql.includes('linked_at'))
    return [{ period: '2026-09-28', count: '1' }];
  if (sql.includes('DATE_TRUNC'))
    return [
      { period: '2026-09-21', count: '2' },
      { period: '2026-09-28', count: '3' },
    ];
  if (sql.includes('FROM converts WHERE first_timer_linked_at BETWEEN'))
    return [{ count: '2' }];
  if (sql.includes('FROM converts WHERE linked_at BETWEEN'))
    return [{ count: '1' }];
  if (sql.includes('FROM convert_follow_up_logs WHERE contacted_at'))
    return [{ count: '6' }];
  if (sql.includes('FROM outreaches WHERE outreach_date'))
    return [{ count: '2' }];
  if (sql.includes('AS unassigned')) return [{ overdue: '4', unassigned: '1' }];
  if (sql.includes('brought_in'))
    return [
      { member_id: 'm-1', brought_in: '5', joined: '1' },
      { member_id: 'm-2', brought_in: '2', joined: '0' },
    ];
  if (sql.includes('FROM outreach_team ot JOIN outreaches'))
    return [{ member_id: 'm-1', count: '2' }];
  if (sql.includes('logged_by AS member_id'))
    return [{ member_id: 'm-3', count: '6' }];
  if (sql.includes('JOIN worker_profiles'))
    return [{ member_id: 'm-3', open: '4', overdue: '2' }];
  if (sql.includes('FROM outreaches o LEFT JOIN converts'))
    return [
      {
        id: 'o-1',
        date: '2026-09-28',
        title: 'Market',
        location: null,
        team_size: '3',
        converts: '5',
        saved: '2',
        discipleship: '0',
        visited: '3',
        joined: '1',
      },
    ];
  if (sql.includes('FROM members'))
    return [
      { id: 'm-1', firstname: 'Ada', lastname: 'L' },
      { id: 'm-2', firstname: 'Grace', lastname: 'H' },
      { id: 'm-3', firstname: 'Alan', lastname: 'T' },
    ];
  throw new Error(`Unexpected SQL: ${sql}`);
}

describe('EvangelismReportService', () => {
  let service: EvangelismReportService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConvertRepo.query.mockImplementation((sql: string) =>
      Promise.resolve(answer(sql)),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvangelismReportService,
        { provide: getRepositoryToken(Convert), useValue: mockConvertRepo },
        { provide: ConvertService, useValue: mockConvertService },
        { provide: EvangelismSettingsService, useValue: mockSettingsService },
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();
    service = module.get(EvangelismReportService);
  });

  it('builds the summary, trend, per-worker and per-outreach sections', async () => {
    const report = await service.getReport('2026-09-01', '2026-09-30');

    expect(mockCacheService.getOrSet).toHaveBeenCalledWith(
      'evangelism:report:2026-09-01:2026-09-30',
      expect.any(Function),
      300,
    );
    expect(report.summary).toEqual({
      added: 5,
      byStatus: { UNSAVED: 3, SAVED: 2, UNDERGOING_DISCIPLESHIP: 0 },
      visitedChurch: 2,
      joinedChurch: 1,
      followUpsLogged: 6,
      outreaches: 2,
      needsFollowUp: 4,
      unassigned: 1,
    });
    expect(report.trend).toEqual([
      { period: '2026-09-21', added: 2, visited: 2, joined: 0 },
      { period: '2026-09-28', added: 3, visited: 0, joined: 1 },
    ]);
    expect(report.byWorker.map((w) => w.name)).toEqual([
      'Ada L',
      'Grace H',
      'Alan T',
    ]);
    expect(report.byWorker[0]).toEqual(
      expect.objectContaining({ outreaches: 2, broughtIn: 5, joinedChurch: 1 }),
    );
    expect(report.byWorker[2]).toEqual(
      expect.objectContaining({
        followUpsLogged: 6,
        assignedOpen: 4,
        overdue: 2,
      }),
    );
    expect(report.byOutreach[0]).toEqual(
      expect.objectContaining({
        teamSize: 3,
        converts: 5,
        visitedChurch: 3,
        joinedChurch: 1,
      }),
    );
  });

  it('exports the worker table as CSV', async () => {
    const csv = await service.exportCsv('workers', {
      from: '2026-09-01',
      to: '2026-09-30',
    });

    const lines = csv.split('\n');
    expect(lines[0]).toContain('"Converts brought in"');
    expect(lines[1]).toBe('"Ada L",2,5,0,0,0,1');
  });

  it('exports converts through the shared list filters', async () => {
    mockConvertService.findForExport.mockResolvedValue([
      {
        name: '=HYPERLINK("x")',
        phone: '+234',
        status: 'SAVED',
        stage: 'FOLLOWED_UP',
        createdAt: new Date('2026-09-02T10:00:00Z'),
        onboardedByName: 'Ada L',
        outreach: { title: 'Market', outreachDate: '2026-09-02', team: [] },
        assignedTo: null,
        lastContactedAt: null,
        isOverdue: true,
        member: null,
        notes: null,
      },
    ]);

    const csv = await service.exportCsv('converts', {
      status: 'SAVED' as never,
    });

    expect(mockConvertService.findForExport).toHaveBeenCalledWith({
      status: 'SAVED',
    });
    expect(csv.split('\n')[1]).toBe(
      `"'=HYPERLINK(""x"")","+234","SAVED","Followed up","2026-09-02","Ada L","Market · 2026-09-02","","","","Yes","No",""`,
    );
  });
});

describe('resolveRange', () => {
  it('uses weekly buckets up to 26 weeks and monthly beyond', () => {
    expect(resolveRange('2026-01-01', '2026-06-01').bucket).toBe('week');
    expect(resolveRange('2025-01-01', '2026-06-01').bucket).toBe('month');
  });

  it('defaults to the last 90 days', () => {
    const r = resolveRange(undefined, '2026-10-05');
    expect(r).toEqual({ from: '2026-07-07', to: '2026-10-05', bucket: 'week' });
  });
});

describe('toCsv', () => {
  it('quotes text, escapes quotes and neutralises formula prefixes', () => {
    expect(
      toCsv(
        ['A', 'B'],
        [
          ['say "hi"', 3],
          ['+SUM(1)', null],
          ['@x', '-2+3*cmd'],
          ['+234 801 234', '-12.5'],
        ],
      ),
    ).toBe(
      [
        '"A","B"',
        '"say ""hi""",3',
        `"'+SUM(1)",""`,
        `"'@x","'-2+3*cmd"`,
        '"+234 801 234","-12.5"',
      ].join('\n'),
    );
  });
});
