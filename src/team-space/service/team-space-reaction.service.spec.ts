import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TeamSpaceReactionService } from './team-space-reaction.service';

describe('TeamSpaceReactionService', () => {
  const repo = { query: jest.fn() };
  let acc: { closed?: boolean };
  const access = {
    accessBySpace: jest.fn(() => Promise.resolve(acc)),
    assertOpen: jest.fn((a: { closed?: boolean }) => {
      if (a.closed) throw new ForbiddenException('closed');
    }),
  };
  const service = new TeamSpaceReactionService(repo as never, access as never);
  const space = [{ space_id: 's1', kind: 'DEPARTMENT', ref_id: 'd1' }];

  beforeEach(() => {
    jest.clearAllMocks();
    acc = {};
  });

  it('counts reactions for a page of posts and replies, in the offered order', async () => {
    repo.query
      .mockResolvedValueOnce([
        { target_id: 'p1', emoji: '🎉', count: 1, mine: false },
        { target_id: 'p1', emoji: '👍', count: 3, mine: true },
      ])
      .mockResolvedValueOnce([
        { target_id: 'r1', emoji: '🙏', count: 2, mine: false },
      ]);
    const map = await service.summaries('m1', ['p1', 'p2'], ['r1']);
    expect(map.get('p1')).toEqual([
      { emoji: '👍', count: 3, mine: true },
      { emoji: '🎉', count: 1, mine: false },
    ]);
    expect(map.get('r1')).toEqual([{ emoji: '🙏', count: 2, mine: false }]);
    expect(map.get('p2')).toBeUndefined();
    expect(repo.query.mock.calls[0][0]).toContain('AND reply_id IS NULL');
    expect(repo.query).toHaveBeenCalledTimes(2);
  });

  it('makes no query when there is nothing on the page', async () => {
    expect((await service.summaries('m1', [], [])).size).toBe(0);
    expect(repo.query).not.toHaveBeenCalled();
  });

  it('adds a reaction to a post, and takes it away on a second tap', async () => {
    repo.query
      .mockResolvedValueOnce(space)
      .mockResolvedValueOnce([{ id: 'x1' }])
      .mockResolvedValueOnce([
        { target_id: 'p1', emoji: '❤️', count: 1, mine: true },
      ]);
    expect(await service.toggle('m1', { postId: 'p1' }, '❤️')).toEqual({
      reactions: [{ emoji: '❤️', count: 1, mine: true }],
    });
    expect(repo.query.mock.calls[1][1]).toEqual(['p1', 'm1', '❤️']);

    repo.query
      .mockResolvedValueOnce(space)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([]);
    expect(await service.toggle('m1', { postId: 'p1' }, '❤️')).toEqual({
      reactions: [],
    });
    expect(repo.query.mock.calls[5][0]).toContain(
      'DELETE FROM team_post_reactions WHERE post_id = $1 AND reply_id IS NULL',
    );
  });

  it('reacts to replies by reply', async () => {
    repo.query
      .mockResolvedValueOnce([{ post_id: 'p1', ...space[0] }])
      .mockResolvedValueOnce([{ id: 'x2' }])
      .mockResolvedValueOnce([]);
    await service.toggle('m1', { replyId: 'r1' }, '🙏');
    expect(repo.query.mock.calls[1][1]).toEqual(['p1', 'r1', 'm1', '🙏']);
  });

  it('only takes the offered emojis, and not in a closed space', async () => {
    await expect(service.toggle('m1', { postId: 'p1' }, '💩')).rejects.toThrow(
      BadRequestException,
    );
    acc = { closed: true };
    repo.query.mockResolvedValueOnce(space);
    await expect(service.toggle('m1', { postId: 'p1' }, '👍')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lists who reacted with what, for team members only', async () => {
    repo.query.mockResolvedValueOnce(space).mockResolvedValueOnce([
      { emoji: '👍', id: 'm2', name: 'Grace Eze', photo_url: null },
      { emoji: '❤️', id: 'm3', name: null, photo_url: null },
      { emoji: '👍', id: 'm4', name: 'Tunde', photo_url: 'x.jpg' },
    ]);
    expect(await service.who('m1', { postId: 'p1' })).toEqual({
      reactions: [
        {
          emoji: '👍',
          people: [
            { id: 'm2', name: 'Grace Eze', photoUrl: null },
            { id: 'm4', name: 'Tunde', photoUrl: 'x.jpg' },
          ],
        },
        {
          emoji: '❤️',
          people: [{ id: 'm3', name: 'A member', photoUrl: null }],
        },
      ],
    });
    expect(access.accessBySpace).toHaveBeenCalled();
  });
});
