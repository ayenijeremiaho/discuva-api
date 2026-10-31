import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TeamMeetingFollowUpService } from './team-meeting-follow-up.service';

const NOW = new Date('2026-11-01T12:00:00Z');
const PAST = new Date('2026-11-01T08:00:00Z');
const FUTURE = new Date('2026-11-08T08:00:00Z');

describe('TeamMeetingFollowUpService', () => {
  const meetings = { findOne: jest.fn(), update: jest.fn() };
  const actions = {
    query: jest.fn(),
    save: jest.fn().mockResolvedValue({ id: 'x1' }),
    create: jest.fn((v) => v),
    findOne: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  let isLeader: boolean;
  const access = {
    memberIds: jest.fn().mockResolvedValue(['m1', 'm2', 'm3']),
    accessBySpace: jest.fn(() => Promise.resolve({ isLeader, name: 'Choir' })),
  };
  const notifications = {
    notifyMember: jest.fn().mockResolvedValue(undefined),
    pushCovered: jest.fn().mockResolvedValue(new Set<string>()),
  };
  const service = new TeamMeetingFollowUpService(
    meetings as never,
    actions as never,
    access as never,
    notifications as never,
    { resolveMemberUrl: jest.fn().mockResolvedValue('https://app/m') } as never,
    { format: () => 'Sun 8 Nov' } as never,
    { get: jest.fn().mockResolvedValue('Africa/Lagos') } as never,
  );
  const meeting = (over = {}) => ({
    postId: 'p1',
    title: 'Planning',
    startsAt: PAST,
    minutes: 'Agreed',
    cancelledAt: null,
    summarySentAt: null,
    space: { kind: 'DEPARTMENT', refId: 'd1' },
    ...over,
  });
  const calls = () => notifications.notifyMember.mock.calls.map((c) => c[0]);

  beforeEach(() => {
    jest.clearAllMocks();
    isLeader = true;
    notifications.pushCovered.mockResolvedValue(new Set<string>());
    meetings.findOne.mockResolvedValue(meeting());
    actions.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM members WHERE id = ANY'))
        return Promise.resolve([
          { id: 'm2', email: 'm2@x.org', firstname: 'Ada' },
          { id: 'm3', email: 'm3@x.org', firstname: 'Ben' },
        ]);
      if (sql.includes('FROM team_meeting_actions a LEFT JOIN'))
        return Promise.resolve([
          {
            id: 'a1',
            text: 'Book hall',
            assignee_id: 'm2',
            assignee_name: 'Ada',
            due_date: '2026-11-08',
            done_at: null,
          },
        ]);
      return Promise.resolve([]);
    });
  });

  const invite = (notice: 'new' | 'cancelled' = 'new') =>
    service.sendInvite(
      {
        postId: 'p1',
        title: 'Planning',
        startsAt: FUTURE,
        location: 'Hall',
        onlineLink: null,
        agenda: 'Budget @[Ada](2e8857e4-35ca-4218-8dcd-623479c64e07)',
      },
      { kind: 'DEPARTMENT', refId: 'd1' } as never,
      'Choir',
      notice,
      'm1',
    );

  it('emails each person separately, leaving out the organiser', async () => {
    await invite();
    expect(calls().map((c) => c.email.to)).toEqual(['m2@x.org', 'm3@x.org']);
    expect(calls()[0].email.template).toBe('team-meeting-invite');
    expect(calls()[0].email.data.meeting_agenda).toBe('Budget @Ada');
  });

  it('respects Push first for people reached by push', async () => {
    notifications.pushCovered.mockResolvedValue(new Set(['m2']));
    await invite();
    expect(calls().map((c) => c.email.to)).toEqual(['m3@x.org']);
  });

  it('says when a meeting is cancelled', async () => {
    await invite('cancelled');
    expect(calls()[0].email.subject).toBe('Choir: Meeting cancelled: Planning');
  });

  it('puts your own actions first in the summary', async () => {
    const result = await service.sendSummary('m1', 'p1', NOW);
    expect(result).toEqual({ sentTo: 2 });
    const [ada, ben] = calls();
    expect(ada.email.data.my_actions).toEqual([
      { text: 'Book hall', due: 'Sun 8 Nov' },
    ]);
    expect(ada.push.vars.actions).toBe('You have 1 action.');
    expect(ben.email.data.my_actions).toEqual([]);
    expect(ben.email.data.other_actions[0].who).toBe('Ada');
    expect(meetings.update).toHaveBeenCalledWith('p1', { summarySentAt: NOW });
  });

  it('marks a second send as an update', async () => {
    meetings.findOne.mockResolvedValue(meeting({ summarySentAt: PAST }));
    await service.sendSummary('m1', 'p1', NOW);
    expect(calls()[0].email.subject).toContain('updated summary');
  });

  it('only lets a leader send the summary', async () => {
    isLeader = false;
    await expect(service.sendSummary('m2', 'p1', NOW)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses a summary before the meeting or with nothing in it', async () => {
    meetings.findOne.mockResolvedValue(meeting({ startsAt: FUTURE }));
    await expect(service.sendSummary('m1', 'p1', NOW)).rejects.toThrow(
      BadRequestException,
    );
    meetings.findOne.mockResolvedValue(meeting({ minutes: null }));
    actions.query.mockResolvedValue([]);
    await expect(service.sendSummary('m1', 'p1', NOW)).rejects.toThrow(
      'Add minutes',
    );
  });

  it('only assigns an action to someone in the team', async () => {
    await expect(
      service.create('m1', 'p1', { text: 'Do it', assigneeId: 'outsider' }),
    ).rejects.toThrow('Choose someone');
  });

  it('tells someone given an action once the summary has gone out, but not before', async () => {
    await service.create('m1', 'p1', { text: 'Do it', assigneeId: 'm2' });
    expect(notifications.notifyMember).not.toHaveBeenCalled();
    meetings.findOne.mockResolvedValue(meeting({ summarySentAt: PAST }));
    await service.create('m1', 'p1', { text: 'Do it', assigneeId: 'm2' });
    expect(calls()[0].push.key).toBe('TEAM_SPACE_MEETING_ACTION');
  });

  it('lets the person responsible tick their action, but not others', async () => {
    isLeader = false;
    actions.findOne.mockResolvedValue({
      id: 'a1',
      assignee: { id: 'm2' },
      meeting: meeting(),
    });
    await service.setDone('m2', 'a1', true, NOW);
    expect(actions.update).toHaveBeenCalledWith('a1', { doneAt: NOW });
    await expect(service.setDone('m3', 'a1', true, NOW)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
