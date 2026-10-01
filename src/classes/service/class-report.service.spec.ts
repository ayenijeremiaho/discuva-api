import * as ExcelJS from 'exceljs';
import { ClassReportService } from './class-report.service';
import { EnrollmentStatusEnum as E } from '../enum/enrollment-status.enum';

const qb = (
  opts: { many?: unknown[]; raw?: unknown[]; one?: unknown } = {},
) => {
  const b: Record<string, jest.Mock> = {};
  for (const m of [
    'select',
    'addSelect',
    'where',
    'andWhere',
    'groupBy',
    'addGroupBy',
    'orderBy',
    'addOrderBy',
    'leftJoinAndSelect',
    'innerJoin',
  ])
    b[m] = jest.fn().mockReturnValue(b);
  b.getMany = jest.fn().mockResolvedValue(opts.many ?? []);
  b.getRawMany = jest.fn().mockResolvedValue(opts.raw ?? []);
  b.getRawOne = jest.fn().mockResolvedValue(opts.one ?? null);
  return b;
};

describe('ClassReportService', () => {
  const classRepo = { createQueryBuilder: jest.fn() };
  const enrollmentRepo = { createQueryBuilder: jest.fn(), query: jest.fn() };
  const classTypeRepo = { find: jest.fn() };
  const progress = { progressFor: jest.fn() };
  const service = new ClassReportService(
    classRepo as any,
    enrollmentRepo as any,
    classTypeRepo as any,
    progress as any,
  );

  const believersType = {
    id: 't1',
    name: "Believers' Class",
    nextClassType: { id: 't2', name: 'Baptismal Class' },
  };
  const cls = {
    id: 'c1',
    name: 'Believers Jan',
    status: 'CLOSED',
    startDate: '2026-01-04',
    endDate: '2026-04-12',
    classType: believersType,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    classTypeRepo.find.mockResolvedValue([
      believersType,
      { id: 't2', name: 'Baptismal Class', nextClassType: null },
    ]);
    progress.progressFor.mockResolvedValue(
      new Map([
        [
          'c1',
          {
            sessionsHeld: 14,
            people: [
              {
                name: 'Ada Obi',
                email: 'a@x.org',
                status: E.COMPLETED,
                attendancePercent: 90,
                present: 13,
                sessionsHeld: 14,
                assignmentsSubmitted: 3,
                assignmentsTotal: 3,
                averageScorePercent: 85,
                certificateIssued: true,
              },
              {
                name: 'Tunde Bello',
                email: 't@x.org',
                status: E.IN_PROGRESS,
                attendancePercent: 60,
                present: 8,
                sessionsHeld: 14,
                assignmentsSubmitted: 1,
                assignmentsTotal: 3,
                averageScorePercent: null,
                certificateIssued: false,
              },
            ],
          },
        ],
      ]),
    );
  });

  const wire = () => {
    const classesQb = qb({ many: [cls] });
    classRepo.createQueryBuilder.mockReturnValue(classesQb);
    enrollmentRepo.createQueryBuilder.mockReturnValueOnce(
      qb({
        raw: [
          {
            classId: 'c1',
            status: E.COMPLETED,
            count: '8',
            certificates: '6',
          },
          {
            classId: 'c1',
            status: E.IN_PROGRESS,
            count: '1',
            certificates: '0',
          },
          {
            classId: 'c1',
            status: E.CANCELLED,
            count: '1',
            certificates: '0',
          },
        ],
      }),
    );
    enrollmentRepo.query.mockResolvedValue([{ completed: '4', moved: '3' }]);
    return classesQb;
  };

  it('summarises each class and how many people move on to the next class', async () => {
    const classesQb = wire();

    const report = await service.summary({
      from: '2026-01-01',
      to: '2026-06-30',
    });

    expect(classesQb.andWhere).toHaveBeenCalledWith(
      '(c.start_date IS NULL OR c.start_date <= :to)',
      { to: '2026-06-30' },
    );
    expect(report.classes).toEqual([
      expect.objectContaining({
        className: 'Believers Jan',
        enrolled: 10,
        completed: 8,
        inProgress: 1,
        cancelled: 1,
        completionRate: 80,
        sessionsHeld: 14,
        averageAttendance: 75,
        certificatesIssued: 6,
      }),
    ]);
    expect(report.totals).toMatchObject({
      classes: 1,
      enrolled: 10,
      completed: 8,
      completionRate: 80,
    });
    expect(report.pipeline).toEqual([
      {
        classTypeId: 't1',
        classTypeName: "Believers' Class",
        nextClassTypeName: 'Baptismal Class',
        completed: 4,
        movedOn: 3,
        rate: 75,
      },
    ]);
    expect(report).not.toHaveProperty('progressByClass');
    expect(progress.progressFor).toHaveBeenCalledWith(['c1']);
    const [sql, params] = enrollmentRepo.query.mock.calls[0];
    expect(sql).toContain('WITH completers AS');
    expect(params).toEqual([
      't1',
      E.COMPLETED,
      't2',
      E.CANCELLED,
      '2026-01-01',
      '2026-06-30',
    ]);
  });

  it('exports Classes, Next steps and People sheets', async () => {
    wire();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await service.exportWorkbook({})) as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Classes',
      'Next steps',
      'People',
    ]);
    expect(wb.getWorksheet('People')!.rowCount).toBe(3);
    expect(wb.getWorksheet('Next steps')!.getRow(2).getCell(5).value).toBe(
      '75%',
    );
  });
});
