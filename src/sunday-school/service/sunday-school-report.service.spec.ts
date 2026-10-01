import * as ExcelJS from 'exceljs';
import { NotFoundException } from '@nestjs/common';
import { SundaySchoolReportService } from './sunday-school-report.service';
import { SundaySchoolAttendanceStatus as S } from '../enums/sunday-school-attendance-status.enum';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';

const qb = (rows: unknown[]) => {
  const b: Record<string, jest.Mock> = {};
  for (const m of [
    'select',
    'addSelect',
    'where',
    'andWhere',
    'innerJoin',
    'groupBy',
    'addGroupBy',
  ])
    b[m] = jest.fn().mockReturnValue(b);
  b.getRawMany = jest.fn().mockResolvedValue(rows);
  return b;
};

const juniors = { id: 'c1', name: 'Juniors' };
const session = (id: string, date: string) => ({
  id,
  sessionDate: date,
  sundaySchoolClass: juniors,
});
const member = (id: string, firstname: string, status = 'ACTIVE') => ({
  id,
  firstname,
  lastname: 'Obi',
  email: `${firstname.toLowerCase()}@x.org`,
  phoneNumber: '+2348000000000',
  status,
});

describe('SundaySchoolReportService', () => {
  const classRepo = { find: jest.fn(), existsBy: jest.fn() };
  const assignRepo = { find: jest.fn(), createQueryBuilder: jest.fn() };
  const sessionRepo = { find: jest.fn() };
  const attendanceRepo = { createQueryBuilder: jest.fn() };
  const service = new SundaySchoolReportService(
    classRepo as any,
    assignRepo as any,
    sessionRepo as any,
    attendanceRepo as any,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-10-20T12:00:00Z'));
    classRepo.existsBy.mockResolvedValue(true);
  });
  afterEach(() => jest.useRealTimers());

  describe('resolveRange', () => {
    it('defaults to the last 12 weeks and never reaches past today', () => {
      expect(service.resolveRange({})).toEqual({
        from: '2026-07-28',
        to: '2026-10-20',
      });
      expect(
        service.resolveRange({ from: '2026-09-01', to: '2027-01-01' }),
      ).toEqual({ from: '2026-09-01', to: '2026-10-20' });
    });
  });

  describe('attendanceReport', () => {
    it('counts each session, counting only members who had joined by then', async () => {
      sessionRepo.find.mockResolvedValue([
        session('s1', '2026-10-04'),
        session('s2', '2026-10-11'),
      ]);
      attendanceRepo.createQueryBuilder.mockReturnValue(
        qb([
          {
            sessionId: 's1',
            status: S.PRESENT,
            members: '2',
            firstTimers: '1',
          },
          {
            sessionId: 's1',
            status: S.EXCUSED,
            members: '1',
            firstTimers: '0',
          },
          {
            sessionId: 's2',
            status: S.PRESENT,
            members: '1',
            firstTimers: '0',
          },
          { sessionId: 's2', status: S.ABSENT, members: '2', firstTimers: '0' },
        ]),
      );
      assignRepo.createQueryBuilder.mockReturnValue(
        qb([
          { classId: 'c1', memberId: 'm1', assignedAt: new Date('2026-09-01') },
          { classId: 'c1', memberId: 'm2', assignedAt: new Date('2026-09-01') },
          { classId: 'c1', memberId: 'm3', assignedAt: new Date('2026-09-01') },
          // Joined after the first session: only expected at the second.
          { classId: 'c1', memberId: 'm4', assignedAt: new Date('2026-10-08') },
        ]),
      );
      classRepo.find.mockResolvedValue([juniors]);

      const report = await service.attendanceReport({});

      expect(report.bySession).toEqual([
        expect.objectContaining({
          sessionId: 's1',
          enrolled: 3,
          present: 2,
          excused: 1,
          absent: 0,
          unmarked: 0,
          firstTimers: 1,
          rate: 100,
        }),
        expect.objectContaining({
          sessionId: 's2',
          enrolled: 4,
          present: 1,
          absent: 2,
          unmarked: 1,
          rate: 25,
        }),
      ]);
      expect(report.byClass).toEqual([
        expect.objectContaining({
          classId: 'c1',
          enrolled: 4,
          sessions: 2,
          averagePresent: 1.5,
          firstTimers: 1,
          rate: 50,
        }),
      ]);
      expect(report.summary).toEqual({
        sessions: 2,
        present: 3,
        firstTimers: 1,
        averagePresent: 1.5,
        rate: 50,
      });
      expect(report.members).toBeUndefined();
    });

    it('returns an empty report when no sessions were held', async () => {
      sessionRepo.find.mockResolvedValue([]);
      classRepo.find.mockResolvedValue([juniors]);
      assignRepo.createQueryBuilder.mockReturnValue(qb([]));

      const report = await service.attendanceReport({});

      expect(report.summary).toEqual({
        sessions: 0,
        present: 0,
        firstTimers: 0,
        averagePresent: 0,
        rate: null,
      });
      expect(report.byClass[0]).toEqual(
        expect.objectContaining({ sessions: 0, rate: null }),
      );
    });

    it('adds per-member rates for a single class', async () => {
      sessionRepo.find.mockResolvedValue([
        session('s1', '2026-10-04'),
        session('s2', '2026-10-11'),
      ]);
      attendanceRepo.createQueryBuilder
        .mockReturnValueOnce(qb([]))
        .mockReturnValueOnce(
          qb([
            {
              memberId: 'm1',
              classId: 'c1',
              status: S.PRESENT,
              sessionDate: '2026-10-04',
            },
            {
              memberId: 'm1',
              classId: 'c1',
              status: S.PRESENT,
              sessionDate: '2026-10-11',
            },
            {
              memberId: 'm2',
              classId: 'c1',
              status: S.ABSENT,
              sessionDate: '2026-10-04',
            },
          ]),
        );
      assignRepo.createQueryBuilder.mockReturnValue(qb([]));
      classRepo.find.mockResolvedValue([juniors]);
      assignRepo.find.mockResolvedValue([
        {
          member: member('m1', 'Ada'),
          sundaySchoolClass: juniors,
          assignedAt: new Date('2026-09-01'),
        },
        {
          member: member('m2', 'Tunde'),
          sundaySchoolClass: juniors,
          assignedAt: new Date('2026-09-01'),
        },
      ]);

      const report = await service.attendanceReport({ classId: 'c1' });

      expect(report.members).toEqual([
        expect.objectContaining({
          firstname: 'Tunde',
          sessionsHeld: 2,
          present: 0,
          absent: 1,
          rate: 0,
          lastPresent: null,
        }),
        expect.objectContaining({
          firstname: 'Ada',
          present: 2,
          rate: 100,
          lastPresent: '2026-10-11',
        }),
      ]);
    });

    it('404s for an unknown class', async () => {
      classRepo.existsBy.mockResolvedValue(false);
      await expect(
        service.attendanceReport({ classId: 'nope' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('absentees', () => {
    beforeEach(() => {
      sessionRepo.find.mockResolvedValue([
        session('s4', '2026-10-18'),
        session('s3', '2026-10-11'),
        session('s2', '2026-10-04'),
        session('s1', '2026-09-27'),
      ]);
    });

    it('lists members whose latest sessions in a row were missed (absent or unmarked), longest first', async () => {
      assignRepo.find.mockResolvedValue([
        // Came on s1 only: missed 3 in a row.
        {
          member: member('m1', 'Ada'),
          sundaySchoolClass: juniors,
          assignedAt: new Date('2026-09-01'),
        },
        // Came last week: fine.
        {
          member: member('m2', 'Tunde'),
          sundaySchoolClass: juniors,
          assignedAt: new Date('2026-09-01'),
        },
        // Never came: 4 in a row.
        {
          member: member('m3', 'Chidi'),
          sundaySchoolClass: juniors,
          assignedAt: new Date('2026-09-01'),
        },
        // Joined before the last 2 sessions only: can't have missed 3 yet.
        {
          member: member('m4', 'Bola'),
          sundaySchoolClass: juniors,
          assignedAt: new Date('2026-10-05'),
        },
        // Inactive members are left out.
        {
          member: member('m5', 'Femi', MemberStatusEnum.INACTIVE),
          sundaySchoolClass: juniors,
          assignedAt: new Date('2026-09-01'),
        },
      ]);
      attendanceRepo.createQueryBuilder.mockReturnValue(
        qb([
          { sessionId: 's1', memberId: 'm1' },
          { sessionId: 's4', memberId: 'm2' },
        ]),
      );

      const rows = await service.absentees(undefined, 3);

      expect(
        rows.map((r) => [r.firstname, r.missedInARow, r.lastAttended]),
      ).toEqual([
        ['Chidi', 4, null],
        ['Ada', 3, '2026-09-27'],
      ]);
      expect(rows[0]).toEqual(
        expect.objectContaining({
          className: 'Juniors',
          phoneNumber: '+2348000000000',
        }),
      );
    });

    it('counts excused as attended', async () => {
      assignRepo.find.mockResolvedValue([
        {
          member: member('m1', 'Ada'),
          sundaySchoolClass: juniors,
          assignedAt: new Date('2026-09-01'),
        },
      ]);
      const builder = qb([{ sessionId: 's3', memberId: 'm1' }]);
      attendanceRepo.createQueryBuilder.mockReturnValue(builder);

      expect(await service.absentees('c1', 3)).toEqual([]);
      expect(builder.andWhere).toHaveBeenCalledWith('a.status IN (:...ok)', {
        ok: [S.PRESENT, S.EXCUSED],
      });
    });

    it('is empty when there are no past sessions', async () => {
      sessionRepo.find.mockResolvedValue([]);
      expect(await service.absentees()).toEqual([]);
      expect(assignRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('exportWorkbook', () => {
    it('builds Classes, Sessions and Members sheets', async () => {
      // The xlsx zip writer relies on real timers.
      jest.useRealTimers();
      sessionRepo.find.mockResolvedValue([session('s1', '2026-10-04')]);
      attendanceRepo.createQueryBuilder.mockReturnValue(
        qb([
          {
            sessionId: 's1',
            status: S.PRESENT,
            members: '1',
            firstTimers: '0',
          },
        ]),
      );
      assignRepo.createQueryBuilder.mockReturnValue(
        qb([
          { classId: 'c1', memberId: 'm1', assignedAt: new Date('2026-09-01') },
        ]),
      );
      classRepo.find.mockResolvedValue([juniors]);
      assignRepo.find.mockResolvedValue([
        {
          member: member('m1', 'Ada'),
          sundaySchoolClass: juniors,
          assignedAt: new Date('2026-09-01'),
        },
      ]);

      const buffer = await service.exportWorkbook({});
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as never);

      expect(wb.worksheets.map((w) => w.name)).toEqual([
        'Classes',
        'Sessions',
        'Members',
      ]);
      expect(wb.getWorksheet('Sessions')!.getRow(2).getCell(2).value).toBe(
        'Juniors',
      );
      expect(wb.getWorksheet('Classes')!.getRow(2).getCell(5).value).toBe(
        '100%',
      );
    });
  });
});
