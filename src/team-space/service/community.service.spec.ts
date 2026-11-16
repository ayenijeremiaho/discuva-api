import { mockAdminAccess } from '../../admin/testing/admin-access.mock';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CommunityService } from './community.service';
import { TeamSpaceKindEnum } from '../entity/team-space.entity';
import { ReportOutcomeEnum } from '../entity/post-report.entity';

const qb = () => {
  const q: Record<string, jest.Mock> = {};
  for (const m of [
    'insert',
    'into',
    'values',
    'orIgnore',
    'update',
    'set',
    'where',
    'andWhere',
  ])
    q[m] = jest.fn().mockReturnValue(q);
  q.execute = jest.fn().mockResolvedValue({ raw: [{ id: 'new' }] });
  return q;
};

describe('CommunityService', () => {
  const reportRepo = {
    createQueryBuilder: jest.fn(qb),
    query: jest.fn(),
    findOne: jest.fn(),
  };
  const categoryRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findOneBy: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((c) => c),
    save: jest.fn((c) => Promise.resolve(c)),
    delete: jest.fn(),
    query: jest.fn(),
  };
  const postRepo = { findOne: jest.fn() };
  const replyRepo = { findOne: jest.fn() };
  const access = {
    access: jest.fn().mockResolvedValue({}),
    isModerator: jest.fn(),
    isMinor: jest.fn().mockResolvedValue(false),
  };
  const spaces = { removePost: jest.fn(), removeReply: jest.fn() };
  const notifications = {
    notifyMember: jest.fn().mockResolvedValue(undefined),
  };
  const cache = { get: jest.fn(), set: jest.fn() };
  const audit = { log: jest.fn() };
  const settings = { getNumber: jest.fn().mockResolvedValue(8) };
  const service = new CommunityService(
    mockAdminAccess as never,
    reportRepo as never,
    categoryRepo as never,
    postRepo as never,
    replyRepo as never,
    access as never,
    spaces as never,
    notifications as never,
    cache as never,
    audit as never,
    settings as never,
  );
  const communityPost = (authorId = 'm9') => ({
    id: 'p1',
    removedAt: null,
    author: { id: authorId },
    space: { kind: TeamSpaceKindEnum.COMMUNITY },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    access.isModerator.mockResolvedValue(true);
    cache.get.mockResolvedValue(undefined);
    reportRepo.query.mockResolvedValue([]);
  });

  describe('reporting', () => {
    it('records a report and tells moderators once per window', async () => {
      postRepo.findOne.mockResolvedValue(communityPost());
      reportRepo.query.mockResolvedValueOnce([
        { id: 'mod-1', name: 'Ada', named: true, admin: false },
      ]);
      await service.report('m1', { postId: 'p1' }, 'Spam');
      expect(reportRepo.createQueryBuilder).toHaveBeenCalled();
      expect(notifications.notifyMember.mock.calls[0][0].push).toMatchObject({
        memberIds: ['mod-1'],
        key: 'COMMUNITY_REPORT',
      });

      cache.get.mockResolvedValue(true);
      await service.report('m1', { postId: 'p1' }, 'Spam again');
      expect(notifications.notifyMember).toHaveBeenCalledTimes(1);
    });

    it("doesn't alert moderators again for a repeat report", async () => {
      postRepo.findOne.mockResolvedValue(communityPost());
      reportRepo.createQueryBuilder.mockImplementationOnce(() => {
        const q = qb();
        q.execute = jest.fn().mockResolvedValue({ raw: [] });
        return q;
      });
      await service.report('m1', { postId: 'p1' }, 'Spam');
      expect(notifications.notifyMember).not.toHaveBeenCalled();
    });

    it("can't be used on your own post or outside Community", async () => {
      postRepo.findOne.mockResolvedValue(communityPost('m1'));
      await expect(service.report('m1', { postId: 'p1' }, 'x')).rejects.toThrow(
        BadRequestException,
      );
      postRepo.findOne.mockResolvedValue({
        ...communityPost(),
        space: { kind: TeamSpaceKindEnum.DEPARTMENT },
      });
      await expect(service.report('m1', { postId: 'p1' }, 'x')).rejects.toThrow(
        'Only Community posts can be reported.',
      );
    });

    it('keeps the queue to moderators', async () => {
      access.isModerator.mockResolvedValue(false);
      await expect(service.reports('m1')).rejects.toThrow(ForbiddenException);
    });

    it('pages the open queue, newest first', async () => {
      reportRepo.query
        .mockResolvedValueOnce([
          {
            id: 'r1',
            reason: 'Spam',
            created_at: new Date(),
            reporter_id: 'm2',
            reporter_name: 'Ben',
            post_id: 'p1',
            post_title: null,
            post_body: 'Buy now',
            post_author_id: 'm9',
            post_author_name: 'Sam',
            reply_id: null,
            reply_body: null,
            reply_author_id: null,
            reply_author_name: null,
          },
        ])
        .mockResolvedValueOnce([{ n: 1 }]);
      const page = await service.reports('m1', 2);
      expect(reportRepo.query.mock.calls[0][1]).toEqual([20, 20]);
      expect(page).toMatchObject({
        page: 2,
        totalCount: 1,
        data: [
          {
            id: 'r1',
            reporter: { id: 'm2', name: 'Ben' },
            post: { excerpt: 'Buy now', author: { id: 'm9', name: 'Sam' } },
            reply: null,
          },
        ],
      });
    });

    it('removes the post and settles every open report on it', async () => {
      reportRepo.findOne.mockResolvedValue({
        id: 'r1',
        resolvedAt: null,
        post: { id: 'p1' },
        reply: null,
      });
      await service.resolve('m1', 'r1', ReportOutcomeEnum.REMOVED);
      expect(spaces.removePost).toHaveBeenCalledWith(
        'm1',
        'p1',
        'Removed after a report.',
      );
      const update = reportRepo.createQueryBuilder.mock.results[0].value;
      expect(update.where).toHaveBeenCalledWith(
        'resolved_at IS NULL AND post_id = :postId',
        { postId: 'p1' },
      );
      expect(update.andWhere).toHaveBeenCalledWith('reply_id IS NULL');
    });

    it('settles a report even if the post was already removed', async () => {
      reportRepo.findOne.mockResolvedValue({
        id: 'r1',
        resolvedAt: null,
        post: { id: 'p1' },
        reply: { id: 'y1' },
      });
      spaces.removeReply.mockRejectedValueOnce(new NotFoundException());
      await expect(
        service.resolve('m1', 'r1', ReportOutcomeEnum.REMOVED),
      ).resolves.toEqual({ outcome: ReportOutcomeEnum.REMOVED });
    });
  });

  describe('muting', () => {
    it('mutes for one of the allowed lengths', async () => {
      access.isModerator
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      const now = new Date('2026-11-04T10:00:00Z');
      const { until } = await service.mute('m1', 'm9', 7, 'Spam', now);
      expect(until.toISOString()).toBe('2026-11-11T10:00:00.000Z');
      await expect(service.mute('m1', 'm9', 3)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("doesn't let moderators mute themselves or each other", async () => {
      await expect(service.mute('m1', 'm1', 1)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.mute('m1', 'm2', 1)).rejects.toThrow(
        "Moderators can't mute each other.",
      );
    });
  });

  describe('moderators and categories', () => {
    it('only names active adults as moderators', async () => {
      reportRepo.query.mockResolvedValueOnce([{ status: 'PENDING' }]);
      await expect(service.addModerator('a1', 'm2')).rejects.toThrow(
        'Only active members can be moderators.',
      );
      reportRepo.query.mockResolvedValueOnce([{ status: 'ACTIVE' }]);
      access.isMinor.mockResolvedValueOnce(true);
      await expect(service.addModerator('a1', 'm2')).rejects.toThrow(
        'Moderators must be 18 or older.',
      );
    });

    it('stops at the category limit', async () => {
      categoryRepo.count.mockResolvedValueOnce(8);
      await expect(service.addCategory('a1', 'Prayer')).rejects.toThrow(
        'Up to 8 categories.',
      );
    });

    it('adds a category at the end', async () => {
      categoryRepo.findOne.mockResolvedValueOnce({ position: 2 });
      await service.addCategory('a1', 'Prayer');
      expect(categoryRepo.save).toHaveBeenCalledWith({
        name: 'Prayer',
        position: 3,
      });
    });

    it('reorders only with every category listed once', async () => {
      categoryRepo.find.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
      await expect(service.reorderCategories('a1', ['a'])).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
