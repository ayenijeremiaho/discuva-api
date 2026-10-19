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
    isMinor: jest.fn(() => Promise.resolve(minor)),
    memberIds: jest.fn().mockResolvedValue(['m1', 'm2', 'm3']),
    memberships: jest.fn(),
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
  const cache = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };
  const service = new TeamSpaceService(
    spaceRepo as never,
    postRepo as never,
    replyRepo as never,
    readRepo as never,
    access as never,
    notifications as never,
    audit as never,
    cache as never,
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
});
