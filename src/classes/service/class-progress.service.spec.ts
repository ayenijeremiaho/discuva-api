import { NotFoundException } from '@nestjs/common';
import { ClassProgressService, hasRules } from './class-progress.service';
import { ClassAttendanceStatusEnum as A } from '../enum/class-attendance-status.enum';
import { EnrollmentStatusEnum as E } from '../enum/enrollment-status.enum';

const qb = (rows: unknown[]) => {
  const b: Record<string, jest.Mock> = {};
  for (const m of ['select', 'addSelect', 'where', 'andWhere', 'groupBy'])
    b[m] = jest.fn().mockReturnValue(b);
  b.getRawMany = jest.fn().mockResolvedValue(rows);
  return b;
};

describe('ClassProgressService', () => {
  const classRepo = { find: jest.fn() };
  const enrollmentRepo = { find: jest.fn() };
  const sessionRepo = { find: jest.fn(), createQueryBuilder: jest.fn() };
  const attendanceRepo = { createQueryBuilder: jest.fn() };
  const assignmentRepo = { find: jest.fn() };
  const submissionRepo = { createQueryBuilder: jest.fn() };
  const classesService = { closeClass: jest.fn() };
  const service = new ClassProgressService(
    classRepo as any,
    enrollmentRepo as any,
    sessionRepo as any,
    attendanceRepo as any,
    assignmentRepo as any,
    submissionRepo as any,
    classesService as any,
  );

  const c1 = { id: 'c1' };
  const enrolled = new Date('2026-09-01T09:00:00Z');
  const ada = {
    id: 'e1',
    status: E.IN_PROGRESS,
    enrolledAt: enrolled,
    certificateIssued: false,
    churchClass: c1,
    member: { id: 'm1', firstname: 'Ada', lastname: 'Obi', email: 'ada@x.org' },
  };
  const tunde = {
    id: 'e2',
    status: E.IN_PROGRESS,
    enrolledAt: enrolled,
    certificateIssued: false,
    churchClass: c1,
    member: {
      id: 'm2',
      firstname: 'Tunde',
      lastname: 'Bello',
      email: 't@x.org',
    },
  };
  // Joined after the first two sessions: only the last two count for them.
  const chidi = {
    id: 'e3',
    status: E.IN_PROGRESS,
    enrolledAt: new Date('2026-09-20T09:00:00Z'),
    certificateIssued: false,
    churchClass: c1,
    guest: { id: 'g1', firstName: 'Chidi', lastName: 'Eze', email: 'c@x.org' },
  };
  const held = ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27'].map(
    (d, i) => ({
      id: `s${i + 1}`,
      startsAt: new Date(`${d}T08:00:00Z`),
      churchClass: c1,
    }),
  );

  let submissionQb: ReturnType<typeof qb>;
  const setup = (rules: {
    minAttendancePercent: number | null;
    requireAllAssignments: boolean;
  }) => {
    classRepo.find.mockResolvedValue([{ ...c1, ...rules }]);
    enrollmentRepo.find.mockResolvedValue([ada, tunde, chidi]);
    sessionRepo.createQueryBuilder.mockReturnValue(
      qb([{ classId: 'c1', count: '10' }]),
    );
    sessionRepo.find.mockResolvedValue(held);
    assignmentRepo.find.mockResolvedValue([
      { id: 'a1', maxScore: 20, churchClass: c1 },
      { id: 'a2', maxScore: 100, churchClass: c1 },
    ]);
    attendanceRepo.createQueryBuilder.mockReturnValue(
      qb([
        ...['s1', 's2', 's3', 's4'].map((s) => ({
          enrollmentId: 'e1',
          sessionId: s,
          status: A.PRESENT,
        })),
        { enrollmentId: 'e2', sessionId: 's1', status: A.PRESENT },
        { enrollmentId: 'e2', sessionId: 's2', status: A.EXCUSED },
        { enrollmentId: 'e2', sessionId: 's3', status: A.ABSENT },
        { enrollmentId: 'e3', sessionId: 's3', status: A.PRESENT },
        { enrollmentId: 'e3', sessionId: 's4', status: A.PRESENT },
      ]),
    );
    submissionQb = qb([
      { assignmentId: 'a1', memberId: 'm1', enrollmentId: null, score: 18 },
      { assignmentId: 'a2', memberId: 'm1', enrollmentId: null, score: 70 },
      { assignmentId: 'a1', memberId: null, enrollmentId: 'e3', score: null },
    ]);
    submissionRepo.createQueryBuilder.mockReturnValue(submissionQb);
  };

  beforeEach(() => jest.clearAllMocks());

  it('works out attendance and assignments per person against the rules', async () => {
    setup({ minAttendancePercent: 75, requireAllAssignments: true });

    const { people, sessionsHeld, sessionsTotal } =
      await service.classProgress('c1');

    expect(sessionsHeld).toBe(4);
    expect(sessionsTotal).toBe(10);
    const [ada_, chidi_, tunde_] = people;
    expect(ada_).toMatchObject({
      name: 'Ada Obi',
      present: 4,
      attendancePercent: 100,
      assignmentsSubmitted: 2,
      averageScorePercent: 80,
      meetsRules: true,
      missing: [],
    });
    // Tunde: 1 present of 4 held, 1 excused → 1/3.
    expect(tunde_).toMatchObject({
      present: 1,
      excused: 1,
      absent: 1,
      attendancePercent: 33.3,
      meetsRules: false,
    });
    expect(tunde_.missing).toEqual([
      'Attendance 33.3% (needs 75%)',
      '2 assignment(s) not submitted',
    ]);
    // Chidi (guest) joined late: only sessions 3 and 4 count.
    expect(chidi_).toMatchObject({
      name: 'Chidi Eze',
      sessionsHeld: 2,
      attendancePercent: 100,
      assignmentsSubmitted: 1,
      averageScorePercent: null,
    });
    expect(chidi_.missing).toEqual(['1 assignment(s) not submitted']);
  });

  it('computes several classes with the same handful of queries as one', async () => {
    setup({ minAttendancePercent: null, requireAllAssignments: false });
    classRepo.find.mockResolvedValue([c1, { id: 'c2' }]);

    const result = await service.progressFor(['c1', 'c2']);

    expect(result.get('c1')!.people).toHaveLength(3);
    expect(result.get('c2')).toEqual({
      rules: expect.any(Object),
      sessionsHeld: 0,
      sessionsTotal: 0,
      people: [],
    });
    expect(enrollmentRepo.find).toHaveBeenCalledTimes(1);
    expect(attendanceRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(submissionRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
  });

  it("only loads one person's records for their own progress", async () => {
    setup({ minAttendancePercent: 75, requireAllAssignments: false });
    enrollmentRepo.find.mockResolvedValue([ada]);

    const mine = await service.enrollmentProgress('c1', 'e1');

    expect(enrollmentRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: expect.anything() }),
      }),
    );
    expect(submissionQb.andWhere).toHaveBeenCalledWith(
      '(s.member_id IN (:...memberIds) OR s.class_enrollment_id IN (:...enrollmentIds))',
      { memberIds: ['m1'], enrollmentIds: ['e1'] },
    );
    expect(mine).toMatchObject({ enrollmentId: 'e1', attendancePercent: 100 });
  });

  it('with no rules everyone meets them', async () => {
    setup({ minAttendancePercent: null, requireAllAssignments: false });
    const { people } = await service.classProgress('c1');
    expect(people.every((p) => p.meetsRules)).toBe(true);
    expect(
      hasRules({ minAttendancePercent: null, requireAllAssignments: false }),
    ).toBe(false);
  });

  it('closing with rules completes only people who meet them and lists the rest', async () => {
    setup({ minAttendancePercent: 75, requireAllAssignments: false });
    classesService.closeClass.mockResolvedValue({ closedEnrollments: 2 });

    const result = await service.closeClass('c1');

    expect(classesService.closeClass).toHaveBeenCalledWith('c1', ['e1', 'e3']);
    expect(result).toEqual({
      closedEnrollments: 2,
      needsReview: [
        {
          enrollmentId: 'e2',
          name: 'Tunde Bello',
          missing: ['Attendance 33.3% (needs 75%)'],
        },
      ],
    });
  });

  it('closing without rules completes everyone as before', async () => {
    setup({ minAttendancePercent: null, requireAllAssignments: false });
    classesService.closeClass.mockResolvedValue({ closedEnrollments: 3 });

    await expect(service.closeClass('c1')).resolves.toEqual({
      closedEnrollments: 3,
      needsReview: [],
    });
    expect(classesService.closeClass).toHaveBeenCalledWith('c1');
  });

  it('404s for an unknown class', async () => {
    setup({ minAttendancePercent: null, requireAllAssignments: false });
    classRepo.find.mockResolvedValue([]);
    await expect(service.classProgress('x')).rejects.toThrow(NotFoundException);
  });
});
