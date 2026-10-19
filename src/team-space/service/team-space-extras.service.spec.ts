import { formatInTimeZone } from 'date-fns-tz';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TeamSpaceExtrasService } from './team-space-extras.service';
import { TeamSpaceKindEnum } from '../entity/team-space.entity';
import { RsvpResponseEnum } from '../entity/team-meeting-rsvp.entity';

const DEPT = TeamSpaceKindEnum.DEPARTMENT;

describe('TeamSpaceExtrasService', () => {
  const now = new Date('2026-10-19T08:00:00Z');
  const space = { id: 's1', kind: DEPT, refId: 'd1' };
  let acc: Record<string, unknown>;
  const access = {
    access: jest.fn(() => Promise.resolve(acc)),
    accessBySpace: jest.fn(() => Promise.resolve(acc)),
    memberIds: jest.fn().mockResolvedValue(['m1', 'm2', 'm3']),
  };
  const spaceRepo = {
    query: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
  };
  const postRepo = {
    save: jest.fn((p) => Promise.resolve({ id: 'p-new', ...p })),
    create: jest.fn((p) => p),
    update: jest.fn(),
  };
  const meetingRepo = {
    insert: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const pollRepo = { insert: jest.fn(), findOne: jest.fn(), update: jest.fn() };
  const seriesRepo = {
    save: jest.fn((x) => Promise.resolve({ id: 'series1', ...x })),
    create: jest.fn((x) => x),
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const notifications = {
    notifyMember: jest.fn().mockResolvedValue(undefined),
  };
  const service = new TeamSpaceExtrasService(
    spaceRepo as never,
    postRepo as never,
    meetingRepo as never,
    pollRepo as never,
    seriesRepo as never,
    access as never,
    notifications as never,
    {
      format: (d: Date, pattern: string, tz: string) =>
        pattern === 'HH:mm'
          ? formatInTimeZone(d, tz, 'HH:mm')
          : 'Sat 24 Oct at 5:00 PM',
    } as never,
    { get: jest.fn().mockResolvedValue('Africa/Lagos') } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    acc = { kind: DEPT, refId: 'd1', name: 'Choir', isLeader: true, space };
  });

  describe('meetings', () => {
    const dto = {
      title: 'Planning meeting',
      startsAt: '2026-10-24T16:00:00Z',
      location: ' Room 2 ',
    };

    it('lets leaders set one up as a post, and tells the team', async () => {
      await service.createMeeting('m1', DEPT, 'd1', dto, now);
      expect(postRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'MEETING', body: 'Planning meeting' }),
      );
      expect(meetingRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          postId: 'p-new',
          title: 'Planning meeting',
          location: 'Room 2',
        }),
      );
      const push = notifications.notifyMember.mock.calls[0][0].push;
      expect(push.memberIds).toEqual(['m2', 'm3']);
      expect(push.vars.when).toBe('Sat 24 Oct at 5:00 PM');
    });

    it("doesn't let members set up meetings, or schedule one in the past", async () => {
      acc.isLeader = false;
      await expect(
        service.createMeeting('m1', DEPT, 'd1', dto, now),
      ).rejects.toBeInstanceOf(ForbiddenException);
      acc.isLeader = true;
      await expect(
        service.createMeeting(
          'm1',
          DEPT,
          'd1',
          { ...dto, startsAt: '2026-10-18T16:00:00Z' },
          now,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('tells the team when a meeting is moved or cancelled', async () => {
      meetingRepo.findOne.mockResolvedValue({
        postId: 'p1',
        title: 'Planning',
        startsAt: new Date('2026-10-24T16:00:00Z'),
        endsAt: null,
        location: null,
        onlineLink: null,
        cancelledAt: null,
        space,
      });
      await service.updateMeeting(
        'm1',
        'p1',
        { startsAt: '2026-10-25T15:00:00Z' },
        now,
      );
      expect(notifications.notifyMember.mock.calls[0][0].push.vars.change).toBe(
        'moved to Sat 24 Oct at 5:00 PM',
      );
      await service.updateMeeting('m1', 'p1', { cancel: true }, now);
      expect(meetingRepo.update).toHaveBeenCalledWith('p1', {
        cancelledAt: now,
      });
      expect(notifications.notifyMember.mock.calls[1][0].push.vars.change).toBe(
        'is cancelled',
      );
    });

    it('saves an RSVP, and turns one away for a cancelled meeting', async () => {
      meetingRepo.findOne.mockResolvedValue({
        postId: 'p1',
        cancelledAt: null,
        space,
      });
      await service.rsvp('m2', 'p1', RsvpResponseEnum.GOING);
      expect(spaceRepo.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (meeting_id, member_id)'),
        ['p1', 'm2', 'GOING'],
      );
      meetingRepo.findOne.mockResolvedValue({
        postId: 'p1',
        cancelledAt: now,
        space,
      });
      await expect(
        service.rsvp('m2', 'p1', RsvpResponseEnum.GOING),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('records attendance as given by a leader', async () => {
      meetingRepo.findOne.mockResolvedValue({ postId: 'p1', space });
      await service.saveAttendance('m1', 'p1', ['m2']);
      expect(spaceRepo.query.mock.calls[0][1]).toEqual(['p1', ['m2']]);
      expect(spaceRepo.query.mock.calls[1][0]).toContain('attended = true');
      acc.isLeader = false;
      await expect(
        service.saveAttendance('m2', 'p1', []),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('repeating meetings', () => {
    // Saturday 24 Oct 2026, 5pm Lagos.
    const base = {
      title: 'Choir practice',
      startsAt: '2026-10-24T16:00:00Z',
      endsAt: '2026-10-24T17:30:00Z',
      onlineLink: 'https://meet.example.org/choir',
    };

    it('makes a weekly series from the first meeting, in church time', async () => {
      await service.createMeeting(
        'm1',
        DEPT,
        'd1',
        { ...base, repeat: 'WEEKLY' as never },
        now,
      );
      expect(seriesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          frequency: 'WEEKLY',
          weekday: 6,
          startTime: '17:00',
          endTime: '18:30',
          intervalWeeks: 1,
          weekOfMonth: null,
          startsOn: '2026-10-24',
          onlineLink: 'https://meet.example.org/choir',
        }),
      );
      expect(meetingRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          series: expect.objectContaining({ id: 'series1' }),
        }),
      );
    });

    it('handles every two weeks, and the same week of each month', async () => {
      await service.createMeeting(
        'm1',
        DEPT,
        'd1',
        { ...base, repeat: 'FORTNIGHTLY' as never },
        now,
      );
      expect(seriesRepo.create.mock.calls[0][0]).toEqual(
        expect.objectContaining({ frequency: 'WEEKLY', intervalWeeks: 2 }),
      );
      await service.createMeeting(
        'm1',
        DEPT,
        'd1',
        { ...base, repeat: 'MONTHLY' as never },
        now,
      );
      // The 24th is the fourth Saturday.
      expect(seriesRepo.create.mock.calls[1][0]).toEqual(
        expect.objectContaining({ frequency: 'MONTHLY', weekOfMonth: 4 }),
      );
      await service.createMeeting(
        'm1',
        DEPT,
        'd1',
        {
          ...base,
          startsAt: '2026-10-31T16:00:00Z',
          endsAt: undefined,
          repeat: 'MONTHLY' as never,
        },
        now,
      );
      expect(seriesRepo.create.mock.calls[2][0]).toEqual(
        expect.objectContaining({ weekOfMonth: -1 }),
      );
    });

    it('rejects an end date before the first meeting', async () => {
      await expect(
        service.createMeeting(
          'm1',
          DEPT,
          'd1',
          { ...base, repeat: 'WEEKLY' as never, repeatUntil: '2026-10-20' },
          now,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    const series = {
      id: 'series1',
      space: { id: 's1' },
      createdBy: { id: 'm1' },
      title: 'Choir practice',
      location: 'Room 2',
      onlineLink: 'https://meet.example.org/choir',
      agenda: null,
      frequency: 'WEEKLY',
      weekday: 6,
      startTime: '17:00',
      endTime: '18:30',
      intervalWeeks: 1,
      weekOfMonth: null,
      startsOn: '2026-10-24',
      endsOn: null,
      active: true,
    };

    it('adds the next meeting with the same details and link once the latest has started', async () => {
      spaceRepo.query.mockResolvedValueOnce([
        { id: 'series1', latest: new Date('2026-10-24T16:00:00Z') },
      ]);
      seriesRepo.findOne.mockResolvedValue(series);
      const next = await service.rollSeries(new Date('2026-10-24T16:05:00Z'));
      expect(meetingRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          startsAt: new Date('2026-10-31T16:00:00Z'),
          endsAt: new Date('2026-10-31T17:30:00Z'),
          onlineLink: 'https://meet.example.org/choir',
          location: 'Room 2',
          series: { id: 'series1' },
        }),
      );
      expect(notifications.notifyMember).not.toHaveBeenCalled();
      expect(next).toEqual(new Date('2026-10-31T16:00:00Z'));
    });

    it('waits until the latest meeting starts, and stops at the end date', async () => {
      spaceRepo.query.mockResolvedValueOnce([
        { id: 'series1', latest: new Date('2026-10-31T16:00:00Z') },
      ]);
      await expect(
        service.rollSeries(new Date('2026-10-25T10:00:00Z')),
      ).resolves.toEqual(new Date('2026-10-31T16:00:00Z'));
      expect(meetingRepo.insert).not.toHaveBeenCalled();

      spaceRepo.query.mockResolvedValueOnce([
        { id: 'series1', latest: new Date('2026-10-24T16:00:00Z') },
      ]);
      seriesRepo.findOne.mockResolvedValue({ ...series, endsOn: '2026-10-30' });
      await service.rollSeries(new Date('2026-10-24T16:05:00Z'));
      expect(meetingRepo.insert).not.toHaveBeenCalled();
      expect(seriesRepo.update).toHaveBeenCalledWith('series1', {
        active: false,
      });
    });

    it('lets a leader stop a meeting repeating', async () => {
      meetingRepo.findOne.mockResolvedValue({
        postId: 'p1',
        title: 'Choir practice',
        space,
      });
      spaceRepo.query.mockResolvedValueOnce([{ series_id: 'series1' }]);
      await service.updateMeeting('m1', 'p1', { stopRepeating: true }, now);
      expect(seriesRepo.update).toHaveBeenCalledWith('series1', {
        active: false,
      });
    });
  });

  describe('polls', () => {
    const poll = (over = {}) => ({
      postId: 'p9',
      options: [
        { id: 'a', text: 'Sat 7' },
        { id: 'b', text: 'Sat 14' },
      ],
      multiple: false,
      closesAt: null,
      post: { removedAt: null, space },
      ...over,
    });

    it('needs at least two different options', async () => {
      await expect(
        service.createPoll(
          'm1',
          DEPT,
          'd1',
          { question: 'Which Saturday?', options: ['Sat 7', 'sat 7'] },
          now,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await service.createPoll(
        'm1',
        DEPT,
        'd1',
        { question: 'Which Saturday?', options: ['Sat 7', ' Sat 14 '] },
        now,
      );
      const saved = pollRepo.insert.mock.calls[0][0];
      expect(saved.options.map((o: { text: string }) => o.text)).toEqual([
        'Sat 7',
        'Sat 14',
      ]);
      expect(notifications.notifyMember).toHaveBeenCalled();
    });

    it('takes one choice, or several when allowed, and lets people change their vote', async () => {
      pollRepo.findOne.mockResolvedValue(poll());
      await expect(
        service.vote('m2', 'p9', ['a', 'b'], now),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.vote('m2', 'p9', ['z'], now)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.vote('m2', 'p9', ['b'], now)).resolves.toEqual({
        myVote: ['b'],
      });
      expect(spaceRepo.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (poll_id, member_id)'),
        ['p9', 'm2', ['b']],
      );
      pollRepo.findOne.mockResolvedValue(poll({ multiple: true }));
      await expect(
        service.vote('m2', 'p9', ['a', 'b', 'a'], now),
      ).resolves.toEqual({ myVote: ['a', 'b'] });
    });

    it('stops votes once closed', async () => {
      pollRepo.findOne.mockResolvedValue(
        poll({ closesAt: new Date('2026-10-18T00:00:00Z') }),
      );
      await expect(service.vote('m2', 'p9', ['a'], now)).rejects.toThrow(
        'This poll has closed.',
      );
    });
  });

  it('loads meeting and poll details for a whole page in at most two queries', async () => {
    spaceRepo.query
      .mockResolvedValueOnce([
        {
          post_id: 'p1',
          title: 'Planning',
          starts_at: now,
          ends_at: null,
          location: null,
          online_link: null,
          cancelled_at: null,
          has_minutes: false,
          my_response: 'GOING',
          counts: { GOING: 4, MAYBE: 1 },
        },
      ])
      .mockResolvedValueOnce([
        {
          post_id: 'p9',
          options: [
            { id: 'a', text: 'Sat 7' },
            { id: 'b', text: 'Sat 14' },
          ],
          multiple: false,
          closes_at: null,
          voters: 5,
          my_vote: ['b'],
          tallies: { a: 2, b: 3 },
        },
      ]);
    const { meetings, polls } = await service.details(
      [
        { id: 'p1', type: 'MEETING' },
        { id: 'p9', type: 'POLL' },
        { id: 'p5', type: 'POST' },
      ],
      'm1',
      now,
    );
    expect(spaceRepo.query).toHaveBeenCalledTimes(2);
    expect(meetings.get('p1')?.counts).toEqual({
      GOING: 4,
      MAYBE: 1,
      NOT_GOING: 0,
    });
    expect(polls.get('p9')?.options).toEqual([
      { id: 'a', text: 'Sat 7', votes: 2 },
      { id: 'b', text: 'Sat 14', votes: 3 },
    ]);
    expect(polls.get('p9')?.myVote).toEqual(['b']);
  });
});
