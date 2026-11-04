import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  TeamSpaceService,
  decodeCursor,
  encodeCursor,
  excerpt,
} from './team-space.service';
import { isUnder18 } from './team-space-access.service';
import { digestSummary } from './team-space-digest.service';
import { TeamSpaceKindEnum } from '../entity/team-space.entity';

const DEPT = TeamSpaceKindEnum.DEPARTMENT;

describe('team space helpers', () => {
  it('counts someone as under 18 only when their birth year is known', () => {
    const today = new Date('2026-10-19T12:00:00Z');
    expect(isUnder18({ year: 2010, month: 1, day: 1 }, today)).toBe(true);
    expect(isUnder18({ year: 2008, month: 10, day: 19 }, today)).toBe(false);
    expect(isUnder18({ year: 2008, month: 10, day: 20 }, today)).toBe(true);
    expect(isUnder18({ year: null, month: 5, day: 4 }, today)).toBe(false);
  });

  it('round-trips a page cursor and rejects a broken one', () => {
    const at = new Date('2026-10-19T08:00:00Z');
    expect(decodeCursor(encodeCursor(at, 'p1'))).toEqual({ at, id: 'p1' });
    expect(decodeCursor(undefined)).toBeNull();
    expect(() => decodeCursor('bm9wZQ')).toThrow(BadRequestException);
  });

  it('shortens long text for notifications', () => {
    expect(excerpt('a  b\n c')).toBe('a b c');
    expect(excerpt('x'.repeat(200))).toHaveLength(120);
  });

  it('writes the evening summary', () => {
    expect(digestSummary([{ name: 'Choir', n: 3 }])).toBe('3 new in Choir');
    expect(
      digestSummary([
        { name: 'Choir', n: 1 },
        { name: 'Ushering', n: 4 },
      ]),
    ).toBe('5 new in Ushering and Choir');
    expect(
      digestSummary([
        { name: 'A', n: 1 },
        { name: 'B', n: 2 },
        { name: 'C', n: 3 },
        { name: 'D', n: 1 },
      ]),
    ).toBe('7 new in C, B and 2 more');
  });
});

describe('TeamSpaceService', () => {
  const space = { id: 's1', kind: DEPT, refId: 'd1', leadersOnly: false };
  let acc: Record<string, unknown>;
  let minor: boolean;
  const access = {
    access: jest.fn(() => Promise.resolve(acc)),
    accessBySpace: jest.fn(() => Promise.resolve(acc)),
    assertOpen: jest.fn((a: { closed?: boolean }) => {
      if (a.closed) throw new ForbiddenException('closed');
    }),
    isMinor: jest.fn(() => Promise.resolve(minor)),
    memberIds: jest.fn().mockResolvedValue(['m1', 'm2', 'm3']),
    memberships: jest.fn(),
    mutedUntil: jest.fn().mockResolvedValue(null),
  };
  const qb = () => {
    const q: Record<string, jest.Mock> = {};
    for (const m of [
      'insert',
      'into',
      'values',
      'orUpdate',
      'update',
      'set',
      'where',
    ])
      q[m] = jest.fn().mockReturnValue(q);
    q.execute = jest.fn().mockResolvedValue({});
    return q;
  };
  const spaceRepo = {
    query: jest.fn().mockResolvedValue([{ name: 'Deacon Femi' }]),
    update: jest.fn(),
  };
  const postRepo = {
    save: jest.fn((p) => Promise.resolve({ id: 'p-new', ...p })),
    create: jest.fn((p) => p),
    findOne: jest.fn(),
    update: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn(qb),
  };
  const replyRepo = {
    save: jest.fn((r) => Promise.resolve({ id: 'r-new', ...r })),
    create: jest.fn((r) => r),
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const readRepo = { createQueryBuilder: jest.fn(qb) };
  const notifications = {
    notifyMember: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { log: jest.fn() };
  const extras = {
    details: jest
      .fn()
      .mockResolvedValue({ meetings: new Map(), polls: new Map() }),
    upcoming: jest.fn().mockResolvedValue([]),
  };
  const cache = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };
  const reactions = {
    summaries: jest.fn().mockResolvedValue(new Map()),
  };
  const service = new TeamSpaceService(
    spaceRepo as never,
    postRepo as never,
    replyRepo as never,
    readRepo as never,
    access as never,
    notifications as never,
    audit as never,
    cache as never,
    extras as never,
    reactions as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    acc = {
      kind: DEPT,
      refId: 'd1',
      name: 'Choir',
      isLeader: false,
      space: { ...space },
    };
    minor = false;
    postRepo.findOne.mockResolvedValue({
      id: 'p1',
      body: 'Rehearsal at 5',
      pinned: false,
      removedAt: null,
      author: { id: 'm9' },
      space,
    });
  });

  describe('starting a post', () => {
    it("doesn't let under-18s start posts", async () => {
      minor = true;
      await expect(service.createPost('m1', DEPT, 'd1', 'Hi')).rejects.toThrow(
        'Members under 18 can read and reply to posts, but not start them.',
      );
    });

    it('stops new posts and replies once a volunteering space has closed', async () => {
      acc.closed = true;
      await expect(service.createPost('m1', DEPT, 'd1', 'Hi')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.reply('m1', 'p1', 'Thanks')).rejects.toThrow(
        ForbiddenException,
      );
      expect(postRepo.save).not.toHaveBeenCalled();
    });

    it('keeps leaders-only spaces to leaders', async () => {
      acc.space = { ...space, leadersOnly: true };
      await expect(
        service.createPost('m1', DEPT, 'd1', 'Hi'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('tells the team straight away when a leader posts, but not the leader', async () => {
      acc.isLeader = true;
      await service.createPost('m1', DEPT, 'd1', 'Rehearsal moves to 5pm');
      const push = notifications.notifyMember.mock.calls[0][0].push;
      expect(push.memberIds).toEqual(['m2', 'm3']);
      expect(push.vars).toEqual({
        space_name: 'Choir',
        author_name: 'Deacon Femi',
        excerpt: 'Rehearsal moves to 5pm',
      });
    });

    it("saves other members' posts for the evening summary", async () => {
      await service.createPost('m1', DEPT, 'd1', 'Anyone free Saturday?');
      expect(notifications.notifyMember).not.toHaveBeenCalled();
      expect(spaceRepo.update).toHaveBeenCalledWith('s1', {
        lastActivityAt: expect.any(Date),
      });
    });
  });

  describe('replying', () => {
    it('lets under-18s reply, and lets the author know once per half hour', async () => {
      minor = true;
      await service.reply('m1', 'p1', 'Count me in');
      expect(replyRepo.save).toHaveBeenCalled();
      expect(
        notifications.notifyMember.mock.calls[0][0].push.memberIds,
      ).toEqual(['m9']);
      expect(cache.set).toHaveBeenCalledWith('team-reply-push:p1', true, 1800);

      cache.get.mockResolvedValueOnce(true);
      await service.reply('m2', 'p1', 'Me too');
      expect(notifications.notifyMember).toHaveBeenCalledTimes(1);
    });

    it("doesn't notify you about your own reply", async () => {
      await service.reply('m9', 'p1', 'Update: 5:30 now');
      expect(notifications.notifyMember).not.toHaveBeenCalled();
    });
  });

  describe('moderation', () => {
    it('lets only the author edit a post', async () => {
      await expect(service.editPost('m1', 'p1', 'x')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await service.editPost('m9', 'p1', 'Rehearsal at 5:30');
      expect(postRepo.update).toHaveBeenCalledWith('p1', {
        body: 'Rehearsal at 5:30',
        editedAt: expect.any(Date),
      });
    });

    it("lets a leader remove someone else's post, and records it", async () => {
      await expect(service.removePost('m1', 'p1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      acc.isLeader = true;
      await service.removePost('m1', 'p1');
      expect(audit.log).toHaveBeenCalledWith(
        'TEAM_POST_REMOVED',
        expect.objectContaining({ actorId: 'm1', targetId: 'm9' }),
      );
    });

    it('caps pinned posts at three', async () => {
      acc.isLeader = true;
      postRepo.count.mockResolvedValue(3);
      await expect(service.pin('m1', 'p1', true)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('tagging', () => {
    const IN = '2e8857e4-35ca-4218-8dcd-623479c64e07';
    const OUT = '11111111-35ca-4218-8dcd-623479c64e07';
    const AUTHOR = '22222222-35ca-4218-8dcd-623479c64e07';
    const OTHER = '33333333-35ca-4218-8dcd-623479c64e07';
    const pushed = () =>
      notifications.notifyMember.mock.calls.map(
        (c) => c[0] as { push: { key: string; memberIds: string[] } },
      );

    beforeEach(() => {
      access.memberIds.mockResolvedValue([IN, AUTHOR, OTHER]);
      spaceRepo.query.mockImplementation((_sql: string, args: string[][]) =>
        Promise.resolve(
          [args?.[0] ?? []].flat().map((id) => ({
            id,
            email: `${id}@x.org`,
            name: id === IN ? 'Ada Obi' : 'Author',
          })),
        ),
      );
    });

    afterEach(() => {
      access.memberIds.mockResolvedValue(['m1', 'm2', 'm3']);
      spaceRepo.query.mockResolvedValue([{ name: 'Deacon Femi' }]);
    });

    it('keeps the real name and tells the person tagged', async () => {
      await service.createPost(AUTHOR, DEPT, 'd1', `Hi @[Fake](${IN})`);
      expect(postRepo.save.mock.calls[0][0].body).toBe(`Hi @[Ada Obi](${IN})`);
      expect(pushed()[0].push.memberIds).toEqual([IN]);
      expect(pushed()[0].push.key).toBe('TEAM_SPACE_MENTION');
    });

    it("won't notify someone outside the space", async () => {
      await service.createPost(AUTHOR, DEPT, 'd1', `Hi @[Bob](${OUT})`);
      expect(postRepo.save.mock.calls[0][0].body).toBe('Hi @Bob');
      expect(notifications.notifyMember).not.toHaveBeenCalled();
    });

    it('lets anyone in the space tag the team', async () => {
      await service.createPost(AUTHOR, DEPT, 'd1', 'All @[team](team)');
      expect(postRepo.save.mock.calls[0][0].body).toBe('All @[team](team)');
      expect(pushed()[0].push.memberIds).toEqual([IN, OTHER]);
    });

    it('notifies a leader post once per person', async () => {
      acc.isLeader = true;
      await service.createPost(AUTHOR, DEPT, 'd1', `Hi @[Ada](${IN})`);
      const calls = pushed();
      expect(calls.map((c) => c.push.memberIds)).toEqual([[IN], [OTHER]]);
    });

    it('limits how many people can be tagged', async () => {
      const many = Array.from(
        { length: 11 },
        (_, i) =>
          `@[P](${String(i).padStart(8, '0')}-35ca-4218-8dcd-623479c64e07)`,
      ).join(' ');
      await expect(
        service.createPost(AUTHOR, DEPT, 'd1', many),
      ).rejects.toThrow(BadRequestException);
    });

    it('counts visible text against the length limit', async () => {
      await expect(
        service.createPost(AUTHOR, DEPT, 'd1', 'x'.repeat(2001)),
      ).rejects.toThrow(BadRequestException);
    });

    it('tells only people newly tagged when a post is edited', async () => {
      postRepo.findOne.mockResolvedValue({
        id: 'p1',
        body: `Hi @[Ada Obi](${IN})`,
        author: { id: AUTHOR },
        space,
      });
      await service.editPost(AUTHOR, 'p1', `Hi again @[Ada Obi](${IN})`);
      expect(notifications.notifyMember).not.toHaveBeenCalled();
    });
  });

  describe('Community', () => {
    const COMMUNITY = TeamSpaceKindEnum.COMMUNITY;
    const ref = '00000000-0000-0000-0000-000000000000';
    const communitySpace = {
      id: 'c1',
      kind: COMMUNITY,
      refId: ref,
      leadersOnly: false,
    };

    beforeEach(() => {
      acc = {
        kind: COMMUNITY,
        refId: ref,
        name: 'Community',
        isLeader: false,
        space: { ...communitySpace },
      };
      postRepo.findOne.mockResolvedValue({
        id: 'p1',
        body: 'Picnic on Saturday',
        pinned: false,
        removedAt: null,
        lockedAt: null,
        author: { id: 'm9' },
        space: communitySpace,
      });
    });

    it('keeps a muted member from posting or replying', async () => {
      access.mutedUntil.mockResolvedValue(new Date('2026-11-12T00:00:00Z'));
      await expect(
        service.createPost('m1', COMMUNITY, ref, 'Hi'),
      ).rejects.toThrow(/paused your posting in Community until 12 Nov/);
      await expect(service.reply('m1', 'p1', 'Hi')).rejects.toThrow(
        ForbiddenException,
      );
      expect(postRepo.save).not.toHaveBeenCalled();
      access.mutedUntil.mockResolvedValue(null);
    });

    it('keeps a muted member from editing what they already posted', async () => {
      postRepo.findOne.mockResolvedValue({
        id: 'p1',
        body: 'old',
        removedAt: null,
        author: { id: 'm1' },
        space: communitySpace,
      });
      access.mutedUntil.mockResolvedValue(new Date('2026-11-12T00:00:00Z'));
      await expect(service.editPost('m1', 'p1', 'new')).rejects.toThrow(
        ForbiddenException,
      );
      expect(postRepo.update).not.toHaveBeenCalled();
      access.mutedUntil.mockResolvedValue(null);
    });

    it('refuses replies to a locked conversation', async () => {
      postRepo.findOne.mockResolvedValue({
        id: 'p1',
        body: 'x',
        removedAt: null,
        lockedAt: new Date(),
        author: { id: 'm9' },
        space: communitySpace,
      });
      await expect(service.reply('m1', 'p1', 'Hi')).rejects.toThrow(
        'This conversation is locked. You can still read it.',
      );
    });

    it('leaves @everyone to moderators', async () => {
      await expect(
        service.createPost('m1', COMMUNITY, ref, '@[team](team) hello'),
      ).rejects.toThrow('Only moderators can use @everyone.');
    });

    it('saves a title and category, and pushes a moderator post as Community', async () => {
      acc.isLeader = true;
      spaceRepo.query.mockResolvedValueOnce([{}]);
      await service.createPost('m1', COMMUNITY, ref, 'Bring a dish', {
        title: 'Picnic',
        categoryId: 'cat-1',
      });
      expect(postRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Picnic', category: { id: 'cat-1' } }),
      );
      const call = notifications.notifyMember.mock.calls[0][0];
      expect(call.category).toBe('COMMUNITY');
      expect(call.push.key).toBe('COMMUNITY_MODERATOR_POST');
    });

    it('refuses a category that no longer exists', async () => {
      spaceRepo.query.mockResolvedValueOnce([]);
      await expect(
        service.createPost('m1', COMMUNITY, ref, 'Hi', { categoryId: 'gone' }),
      ).rejects.toThrow('That category is gone.');
    });

    it('tells the author why a moderator removed their post', async () => {
      acc.isLeader = true;
      await service.removePost('m1', 'p1', 'Off topic');
      const call = notifications.notifyMember.mock.calls[0][0];
      expect(call.push).toMatchObject({
        memberIds: ['m9'],
        key: 'COMMUNITY_POST_REMOVED',
        vars: { space_name: 'Community', reason: 'Off topic' },
      });
    });

    it('filters the feed by category', async () => {
      spaceRepo.query.mockResolvedValueOnce([]);
      await service.feed('m1', COMMUNITY, ref, undefined, 'cat-1');
      const [sql, params] = spaceRepo.query.mock.calls[0];
      expect(sql).toContain('p.category_id = $4');
      expect(params).toEqual(['c1', false, 21, 'cat-1']);
    });

    it('lets only moderators lock, and only in Community', async () => {
      await expect(service.lock('m1', 'p1', true)).rejects.toThrow(
        ForbiddenException,
      );
      acc.isLeader = true;
      await expect(service.lock('m1', 'p1', true)).resolves.toEqual({
        locked: true,
      });
    });
  });
});
