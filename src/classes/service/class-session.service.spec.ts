import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ClassSessionService,
  MAX_SERIES_SESSIONS,
  weeklyDates,
} from './class-session.service';
import { wallTimeToUtc, churchDateOf } from '../util/church-time';
import { ClassAttendanceStatusEnum as A } from '../enum/class-attendance-status.enum';
import { ClassSessionModeEnum } from '../enum/class-session-mode.enum';

const qb = (rows: unknown[] = [], one: unknown = null) => {
  const b: Record<string, jest.Mock> = {};
  for (const m of [
    'select',
    'addSelect',
    'where',
    'andWhere',
    'groupBy',
    'addGroupBy',
    'orderBy',
  ])
    b[m] = jest.fn().mockReturnValue(b);
  b.getRawMany = jest.fn().mockResolvedValue(rows);
  b.getOne = jest.fn().mockResolvedValue(one);
  return b;
};

describe('church time', () => {
  it('turns a local wall time into the right instant, across a DST change', () => {
    expect(
      wallTimeToUtc('2026-10-04', '09:00', 'Africa/Lagos').toISOString(),
    ).toBe('2026-10-04T08:00:00.000Z');
    expect(
      wallTimeToUtc('2026-03-22', '09:00', 'Europe/London').toISOString(),
    ).toBe('2026-03-22T09:00:00.000Z');
    expect(
      wallTimeToUtc('2026-04-05', '09:00', 'Europe/London').toISOString(),
    ).toBe('2026-04-05T08:00:00.000Z');
    expect(churchDateOf(new Date('2026-10-04T23:30:00Z'), 'Africa/Lagos')).toBe(
      '2026-10-05',
    );
  });

  it('lists weekly dates inclusive of both ends', () => {
    expect(weeklyDates('2026-10-04', '2026-10-25', 1)).toEqual([
      '2026-10-04',
      '2026-10-11',
      '2026-10-18',
      '2026-10-25',
    ]);
    expect(weeklyDates('2026-10-04', '2026-11-01', 2)).toHaveLength(3);
    expect(weeklyDates('2026-10-04', '2026-10-01', 1)).toEqual([]);
  });
});

describe('ClassSessionService', () => {
  const classRepo = {
    findOne: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const sessionRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn((v) => Promise.resolve(v)),
    create: jest.fn((v) => v),
    remove: jest.fn(),
    exists: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const attendanceRepo = {
    find: jest.fn(),
    count: jest.fn(),
    save: jest.fn((v) => Promise.resolve(v)),
    create: jest.fn((v) => v),
    createQueryBuilder: jest.fn(),
  };
  const enrollmentRepo = { find: jest.fn() };
  const service = new ClassSessionService(
    classRepo as any,
    sessionRepo as any,
    attendanceRepo as any,
    enrollmentRepo as any,
  );
  const cls = { id: 'c1', name: 'Believers' };

  beforeEach(() => {
    jest.clearAllMocks();
    classRepo.findOne.mockResolvedValue(cls);
    sessionRepo.exists.mockResolvedValue(true);
    sessionRepo.createQueryBuilder.mockReturnValue(qb([], null));
  });

  it('lists sessions with attendance counts and whether each has been held', async () => {
    sessionRepo.find.mockResolvedValue([
      {
        id: 's1',
        startsAt: new Date('2020-01-05T08:00:00Z'),
        mode: 'PHYSICAL',
      },
      { id: 's2', startsAt: new Date('2099-01-05T08:00:00Z'), mode: 'VIRTUAL' },
    ]);
    attendanceRepo.createQueryBuilder.mockReturnValue(
      qb([
        { sessionId: 's1', status: A.PRESENT, count: '12' },
        { sessionId: 's1', status: A.ABSENT, count: '3' },
      ]),
    );

    const list = await service.listSessions('c1');

    expect(list[0]).toMatchObject({
      id: 's1',
      held: true,
      attendance: { present: 12, absent: 3, excused: 0 },
    });
    expect(list[1]).toMatchObject({ id: 's2', held: false });
  });

  it('creates a session and moves the class reminder to the next upcoming session', async () => {
    const next = {
      startsAt: new Date('2099-01-05T08:00:00Z'),
      meetingLink: 'https://meet/x',
    };
    sessionRepo.createQueryBuilder.mockReturnValue(qb([], next));

    await service.createSession('c1', {
      startsAt: '2099-01-05T08:00:00Z',
      mode: ClassSessionModeEnum.VIRTUAL,
      meetingLink: 'https://meet/x',
      title: '  Week 1 ',
    });

    expect(sessionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Week 1',
        mode: 'VIRTUAL',
        location: null,
      }),
    );
    expect(classRepo.update).toHaveBeenCalledWith('c1', {
      nextSessionAt: next.startsAt,
      meetingLink: 'https://meet/x',
    });
  });

  it('gives a session without an end time the default 2 hours', async () => {
    await service.createSession('c1', { startsAt: '2099-01-05T08:00:00Z' });
    expect(sessionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ endsAt: new Date('2099-01-05T10:00:00Z') }),
    );
  });

  it('a series without a length gets 2-hour sessions', async () => {
    sessionRepo.find.mockResolvedValue([]);
    await service.createSeries('c1', {
      startDate: '2026-10-04',
      endDate: '2026-10-11',
      time: '18:00',
    });
    const saved = sessionRepo.save.mock.calls[0][0];
    expect(
      saved.map((x: any) => x.endsAt.getTime() - x.startsAt.getTime()),
    ).toEqual([7_200_000, 7_200_000]);
  });

  it('moving a session keeps its length; clearing the end restores the default', async () => {
    const session = {
      id: 's1',
      churchClass: cls,
      startsAt: new Date('2099-01-05T08:00:00Z'),
      endsAt: new Date('2099-01-05T09:30:00Z'),
    };
    sessionRepo.findOne.mockResolvedValue(session);

    await service.updateSession('s1', { startsAt: '2099-01-06T17:00:00Z' });
    expect(session.endsAt).toEqual(new Date('2099-01-06T18:30:00Z'));

    await service.updateSession('s1', { endsAt: null });
    expect(session.endsAt).toEqual(new Date('2099-01-06T19:00:00Z'));

    await service.updateSession('s1', { endsAt: '2099-01-06T20:00:00Z' });
    expect(session.endsAt).toEqual(new Date('2099-01-06T20:00:00Z'));

    await service.updateSession('s1', { notes: 'Bring a Bible' });
    expect(session.endsAt).toEqual(new Date('2099-01-06T20:00:00Z'));
  });

  it('refuses a session that ends before it starts', async () => {
    await expect(
      service.createSession('c1', {
        startsAt: '2099-01-05T10:00:00Z',
        endsAt: '2099-01-05T09:00:00Z',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates a weekly series at the same local time, skipping ones that exist', async () => {
    const existing = wallTimeToUtc('2026-10-11', '18:00');
    sessionRepo.find.mockResolvedValue([{ id: 'x', startsAt: existing }]);

    const result = await service.createSeries('c1', {
      startDate: '2026-10-04',
      endDate: '2026-10-25',
      time: '18:00',
      durationMinutes: 90,
      location: 'Room 3',
    });

    expect(result).toEqual({ created: 3, skipped: ['2026-10-11'] });
    const saved = sessionRepo.save.mock.calls[0][0];
    expect(saved).toHaveLength(3);
    expect(saved[0].endsAt.getTime() - saved[0].startsAt.getTime()).toBe(
      90 * 60_000,
    );
    expect(saved[0]).toMatchObject({ location: 'Room 3', mode: 'PHYSICAL' });
  });

  it(`refuses a series of more than ${MAX_SERIES_SESSIONS} sessions or with the dates the wrong way round`, async () => {
    await expect(
      service.createSeries('c1', {
        startDate: '2026-01-04',
        endDate: '2028-01-04',
        time: '09:00',
      }),
    ).rejects.toThrow(/smaller batches/);
    await expect(
      service.createSeries('c1', {
        startDate: '2026-10-04',
        endDate: '2026-10-01',
        time: '09:00',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("won't delete a session that has attendance", async () => {
    sessionRepo.findOne.mockResolvedValue({ id: 's1', churchClass: cls });
    attendanceRepo.count.mockResolvedValue(4);
    await expect(service.deleteSession('s1')).rejects.toThrow(
      /can't be deleted/,
    );
    expect(sessionRepo.remove).not.toHaveBeenCalled();
  });

  it('shows everyone still on the class with their mark, members and guests alike', async () => {
    sessionRepo.findOne.mockResolvedValue({ id: 's1', churchClass: cls });
    enrollmentRepo.find.mockResolvedValue([
      {
        id: 'e1',
        member: { firstname: 'Tunde', lastname: 'Bello', email: 't@x.org' },
      },
      {
        id: 'e2',
        guest: { firstName: 'Ada', lastName: 'Obi', email: 'a@x.org' },
      },
    ]);
    attendanceRepo.find.mockResolvedValue([
      { enrollment: { id: 'e2' }, status: A.PRESENT },
    ]);

    const { entries } = await service.getRoster('s1');

    expect(entries).toEqual([
      {
        enrollmentId: 'e2',
        name: 'Ada Obi',
        email: 'a@x.org',
        isGuest: true,
        status: 'PRESENT',
      },
      {
        enrollmentId: 'e1',
        name: 'Tunde Bello',
        email: 't@x.org',
        isGuest: false,
        status: null,
      },
    ]);
  });

  it('marks attendance, updating existing marks and ignoring people not on the class', async () => {
    sessionRepo.findOne.mockResolvedValue({ id: 's1', churchClass: cls });
    enrollmentRepo.find.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);
    const existing = { id: 'a1', enrollment: { id: 'e1' }, status: A.ABSENT };
    attendanceRepo.find.mockResolvedValue([existing]);

    const result = await service.markAttendance(
      's1',
      {
        attendances: [
          { enrollmentId: 'e1', status: A.PRESENT },
          { enrollmentId: 'e2', status: A.EXCUSED },
          { enrollmentId: 'stranger', status: A.PRESENT },
        ],
      },
      { memberId: 'fac-1' },
    );

    expect(result).toEqual({ marked: 2 });
    const rows = attendanceRepo.save.mock.calls[0][0];
    expect(rows[0]).toBe(existing);
    expect(rows[0]).toMatchObject({
      status: 'PRESENT',
      markedByMember: { id: 'fac-1' },
      markedByAdmin: null,
    });
    expect(rows[1]).toMatchObject({
      status: 'EXCUSED',
      enrollment: { id: 'e2' },
    });
  });

  it('404s for an unknown class or session', async () => {
    classRepo.findOne.mockResolvedValue(null);
    await expect(service.listSessions('x')).rejects.toThrow(NotFoundException);
    sessionRepo.findOne.mockResolvedValue(null);
    await expect(service.getRoster('x')).rejects.toThrow(NotFoundException);
  });

  it('moves classes whose next session has passed on to the following one', async () => {
    classRepo.createQueryBuilder.mockReturnValue(
      qb([{ id: 'c1' }, { id: 'c2' }]),
    );
    const spy = jest.spyOn(service, 'syncNextSession').mockResolvedValue();
    await expect(service.advancePastNextSessions()).resolves.toBe(2);
    expect(spy).toHaveBeenCalledWith('c1');
    expect(spy).toHaveBeenCalledWith('c2');
    spy.mockRestore();
  });

  it('leaves classes without any sessions to the manual next-session setting', async () => {
    sessionRepo.exists.mockResolvedValue(false);
    await service.syncNextSession('c1');
    expect(classRepo.update).not.toHaveBeenCalled();
  });
});
