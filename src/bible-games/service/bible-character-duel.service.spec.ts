import { CHARACTER_QUESTIONS } from '../engine/characters';
import { ConflictException } from '@nestjs/common';
import { BibleCharacterDuelService } from './bible-character-duel.service';
import { DuelStatus } from '../entity/bible-character-duel.entity';
import { characterData } from '../engine/characters';

const ME = '11111111-1111-1111-1111-111111111111';
const YOU = '22222222-2222-2222-2222-222222222222';

const matches = (row: any, where: any) =>
  Object.entries(where).every(([k, v]: [string, any]) =>
    v && typeof v === 'object' && Array.isArray(v._value)
      ? v._value.includes(row[k])
      : row[k] === v,
  );

describe('BibleCharacterDuelService', () => {
  const { list } = characterData();
  const easy = list.filter((c) => c.difficulty === 'easy');
  let duels: any[];
  let scoredToday: number;
  let nextId: number;

  const duelRepo = {
    find: jest.fn(async ({ where, take }: any) => {
      const ws = Array.isArray(where) ? where : [where];
      const rows = duels.filter((d) => ws.some((w: any) => matches(d, w)));
      return take ? rows.slice(0, take) : rows;
    }),
    count: jest.fn(async ({ where }: any) => {
      const ws = Array.isArray(where) ? where : [where];
      return duels.filter((d) => ws.some((w: any) => matches(d, w))).length;
    }),
    create: jest.fn((v: any) => ({
      id: `d${++nextId}`,
      challengerState: { asked: [], hints: 0, wrong: [] },
      opponentState: { asked: [], hints: 0, wrong: [] },
      challengerCharacter: null,
      opponentCharacter: null,
      turn: null,
      turnNumber: 0,
      finalTurn: false,
      winner: null,
      reason: null,
      challengerPoints: 0,
      opponentPoints: 0,
      challengerScored: false,
      opponentScored: false,
      finishedAt: null,
      createdAt: new Date(),
      ...v,
    })),
    save: jest.fn(async (v: any) => {
      duels = [...duels.filter((d) => d.id !== v.id), v];
      return v;
    }),
  };
  const txHost = {
    tx: {
      query: jest.fn(async (sql: string, params: any[] = []) => {
        if (sql.includes('FOR UPDATE SKIP LOCKED'))
          return duels
            .filter(
              (d) =>
                ['invited', 'active'].includes(d.status) &&
                d.turnDeadline &&
                d.turnDeadline.getTime() < Date.now() &&
                (!params[0] ||
                  d.challengerId === params[0] ||
                  d.opponentId === params[0]),
            )
            .map((d) => ({ id: d.id }));
        if (sql.includes('WHERE id = $1 AND status'))
          return [ME, YOU].includes(params[0]) ? [{ id: params[0] }] : [];
        if (sql.includes('id = ANY'))
          return [
            { id: ME, firstname: 'Ada', lastname: 'Obi' },
            { id: YOU, firstname: 'Grace', lastname: 'Adebayo' },
          ];
        if (sql.includes('FROM members m'))
          return [
            {
              id: YOU,
              firstname: 'Grace',
              lastname: 'Adebayo',
              photo_url: 'https://cdn.example.com/grace.jpg',
            },
          ];
        return [];
      }),
      getRepository: () => ({
        findOne: async ({ where }: any) =>
          duels.find((d) => d.id === where.id) ?? null,
      }),
    },
  };
  const characters = {
    playable: jest.fn(async () => list),
    settings: jest.fn(async () => ({ onlyReviewed: false, turnHours: 24 })),
  };
  const game = { scoredToday: jest.fn(async () => scoredToday) };
  const bibleGames = {
    inService: jest.fn(async () => false),
    awardPoints: jest.fn(async () => undefined),
  };
  const push = { dispatchToMemberIds: jest.fn(async () => undefined) };
  let service: BibleCharacterDuelService;

  // With Math.random at 0 the challenger gets the first easy character, the opponent the second.
  const started = async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const duel = await service.invite(ME, YOU, 'easy');
    return service.accept(YOU, duel.id);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    duels = [];
    scoredToday = 0;
    nextId = 0;
    service = new BibleCharacterDuelService(
      duelRepo as any,
      characters as any,
      game as any,
      bibleGames as any,
      push as any,
      { get: jest.fn(async () => 'Africa/Lagos') } as any,
      txHost as any,
    );
  });

  it('invites a member, tells them, and refuses a second open duel between the same two', async () => {
    const view = await service.invite(ME, YOU, 'easy');
    expect(view).toMatchObject({
      status: 'invited',
      you: 'challenger',
      opponent: { id: YOU, name: 'Grace Adebayo' },
      yourTurn: false,
      me: null,
    });
    expect(duels[0].turnDeadline.getTime()).toBeGreaterThan(
      Date.now() + 23 * 3600_000,
    );
    expect(push.dispatchToMemberIds).toHaveBeenCalledWith(
      [YOU],
      expect.objectContaining({
        key: 'BIBLE_DUEL_INVITE',
        vars: expect.objectContaining({
          player_name: 'Ada Obi',
          level: 'Easy',
        }),
        url: `/games/characters/duels/${view.id}`,
      }),
    );
    await expect(service.invite(YOU, ME, 'hard')).rejects.toMatchObject({
      response: { code: 'DUEL_EXISTS' },
    });
    await expect(service.invite(ME, ME, 'easy')).rejects.toThrow(
      "can't challenge yourself",
    );
  });

  it('starts on accept with a different character each, and the person invited moves first', async () => {
    const view = await started();
    expect(duels[0]).toMatchObject({
      status: DuelStatus.ACTIVE,
      challengerCharacter: easy[0].id,
      opponentCharacter: easy[1].id,
      turn: 'opponent',
    });
    expect(view.yourTurn).toBe(true);
    expect(view.me?.guessesLeft).toBe(3);
    await expect(service.ask(ME, view.id, 'ot')).rejects.toMatchObject({
      response: { code: 'NOT_YOUR_TURN' },
    });
  });

  it('takes turns, and gives the second player one last guess for a draw', async () => {
    const { id } = await started();
    const afterAsk = await service.ask(YOU, id, 'ot');
    expect(afterAsk.yourTurn).toBe(false);
    expect(afterAsk.me?.asked).toHaveLength(1);
    expect(push.dispatchToMemberIds).toHaveBeenLastCalledWith(
      [ME],
      expect.objectContaining({ key: 'BIBLE_DUEL_YOUR_TURN' }),
    );
    expect(afterAsk.me?.suggestions).toEqual([]);
    expect(afterAsk.me?.possibleNames).toBeNull();
    const myTurn = await service.get(ME, id);
    expect(myTurn.me?.suggestions.length).toBeGreaterThan(0);
    expect(myTurn.me?.possibleNames).not.toBeNull();
    const mine = await service.ask(ME, id, 'ot');
    expect(mine.them?.asked).toHaveLength(1);

    const found = await service.guess(YOU, id, easy[1].id);
    expect(found.status).toBe('active');
    const last = await service.get(ME, id);
    expect(last).toMatchObject({ yourTurn: true, finalTurn: true });
    await expect(service.ask(ME, id, 'early')).rejects.toMatchObject({
      response: { code: 'LAST_GUESS_ONLY' },
    });

    const draw = await service.guess(ME, id, easy[0].id);
    expect(draw.result).toMatchObject({ outcome: 'draw', reason: 'draw' });
    expect(draw.result?.yours.id).toBe(easy[0].id);
    expect(draw.result?.theirs.id).toBe(easy[1].id);
    expect(bibleGames.awardPoints).toHaveBeenCalledTimes(2);
    expect(bibleGames.awardPoints).toHaveBeenCalledWith(
      ME,
      'characters',
      60,
      1,
    );
  });

  it('ends at once when the second mover finds theirs; the loser scores nothing', async () => {
    const { id } = await started();
    await service.ask(YOU, id, 'ot');
    const won = await service.guess(ME, id, easy[0].id);
    expect(won.result).toMatchObject({
      outcome: 'won',
      reason: 'found',
      points: 60,
      scored: true,
    });
    const lost = await service.get(YOU, id);
    expect(lost.result).toMatchObject({ outcome: 'lost', points: 0 });
    expect(bibleGames.awardPoints).toHaveBeenCalledTimes(1);
    expect(push.dispatchToMemberIds).toHaveBeenCalledWith(
      [YOU],
      expect.objectContaining({
        key: 'BIBLE_DUEL_FINISHED',
        vars: expect.objectContaining({ outcome: 'they won this time.' }),
      }),
    );
  });

  it('gives the win to the other player at the minimum when a turn runs out of time', async () => {
    const { id } = await started();
    duels[0].turnDeadline = new Date(Date.now() - 1000);
    expect(await service.expireOverdue()).toBe(1);
    expect(duels[0]).toMatchObject({
      status: 'finished',
      winner: 'challenger',
      reason: 'timeout',
      challengerPoints: 12,
    });
    expect(bibleGames.awardPoints).toHaveBeenCalledWith(
      ME,
      'characters',
      12,
      0,
    );
    const view = await service.get(YOU, id);
    expect(view.result?.outcome).toBe('lost');
  });

  it('stops asking at twenty questions a side, leaving only a guess', async () => {
    const { id } = await started();
    const ids = CHARACTER_QUESTIONS.map((q) => q.id);
    for (let i = 0; i < 20; i++) {
      await service.ask(YOU, id, ids[i]);
      await service.ask(ME, id, ids[i]);
    }
    const view = await service.get(YOU, id);
    expect(view.me?.questionsLeft).toBe(0);
    expect(view.me?.suggestions).toEqual([]);
    await expect(service.ask(YOU, id, ids[20])).rejects.toMatchObject({
      response: { code: 'QUESTION_LIMIT' },
    });
  });

  it('lets an unanswered invite expire', async () => {
    const duel = await service.invite(ME, YOU, 'easy');
    duels[0].turnDeadline = new Date(Date.now() - 1000);
    const view = await service.accept(YOU, duel.id);
    expect(view.status).toBe('expired');
  });

  it('counts wins against the daily limit shared with Solo', async () => {
    scoredToday = 5;
    const { id } = await started();
    await service.ask(YOU, id, 'ot');
    const won = await service.guess(ME, id, easy[0].id);
    expect(won.result).toMatchObject({
      outcome: 'won',
      scored: false,
      points: 0,
    });
    expect(bibleGames.awardPoints).not.toHaveBeenCalled();
  });

  it('ends after three wrong guesses, and on resigning', async () => {
    const { id } = await started();
    const wrong = easy.slice(2, 5).map((c) => c.id);
    await service.guess(YOU, id, wrong[0]);
    await service.ask(ME, id, 'ot');
    await service.guess(YOU, id, wrong[1]);
    await service.ask(ME, id, 'early');
    const out = await service.guess(YOU, id, wrong[2]);
    expect(out.result).toMatchObject({
      outcome: 'lost',
      reason: 'out_of_guesses',
    });

    duels = [];
    const second = await started();
    const resigned = await service.resign(ME, second.id);
    expect(resigned.result).toMatchObject({
      outcome: 'lost',
      reason: 'resigned',
    });
  });

  it('declines for the person invited and cancels for the challenger', async () => {
    const a = await service.invite(ME, YOU, 'easy');
    expect((await service.decline(YOU, a.id)).status).toBe('declined');
    const b = await service.invite(ME, YOU, 'easy');
    expect((await service.decline(ME, b.id)).status).toBe('cancelled');
    await expect(service.decline(ME, b.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('searches active members by each word of their name', async () => {
    const found = await service.opponents(ME, 'gra 50%');
    expect(found).toEqual([
      {
        id: YOU,
        name: 'Grace Adebayo',
        photoUrl: 'https://cdn.example.com/grace.jpg',
      },
    ]);
    const [sql, params] = txHost.tx.query.mock.calls.at(-1)!;
    expect(sql).toContain("m.status = 'ACTIVE' AND m.id <> $1");
    expect(params).toEqual([ME, '%gra%', '%50\\%%']);
  });

  it('lists my duels with whose turn it is', async () => {
    await service.invite(YOU, ME, 'medium');
    const { duels: mine, maxOpen, turnHours } = await service.list(ME);
    expect(mine).toEqual([
      expect.objectContaining({
        you: 'opponent',
        yourTurn: true,
        status: 'invited',
        opponent: { id: YOU, name: 'Grace Adebayo' },
      }),
    ]);
    expect({ maxOpen, turnHours }).toEqual({ maxOpen: 10, turnHours: 24 });
  });
});
