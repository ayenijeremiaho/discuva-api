import { ConflictException } from '@nestjs/common';
import { BibleCharacterGameService } from './bible-character-game.service';
import { CharacterRoundStatus } from '../entity/bible-character-round.entity';
import { characterData } from '../engine/characters';

describe('BibleCharacterGameService', () => {
  const { list } = characterData();
  let rounds: any[];
  let scoredToday = 0;
  const roundRepo = {
    findOne: jest.fn(
      async ({ where }: any) =>
        rounds.find(
          (r) =>
            (where.id ? r.id === where.id : r.status === where.status) &&
            r.memberId === where.memberId,
        ) ?? null,
    ),
    find: jest.fn(async () => []),
    update: jest.fn(async () => undefined),
    create: jest.fn((v: any) => ({ id: 'r1', ...v })),
    save: jest.fn(async (v: any) => {
      rounds = [...rounds.filter((r) => r.id !== v.id), v];
      return v;
    }),
  };
  const txHost = {
    tx: { query: jest.fn(async () => [{ n: String(scoredToday) }]) },
  };
  const characters = { playable: jest.fn(async () => list) };
  const board = { me: { rank: 3, points: 120 } };
  const bibleGames = {
    inService: jest.fn(async () => false),
    scoreboard: jest.fn(async () => board),
    awardPoints: jest.fn(async () => undefined),
  };
  const tz = { get: jest.fn(async () => 'Africa/Lagos') };
  let service: BibleCharacterGameService;

  const startOn = async (id: string) => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const easy = list.filter(
      (c) => c.difficulty === characterData().byId.get(id)!.difficulty,
    );
    characters.playable.mockResolvedValueOnce([
      characterData().byId.get(id)!,
      ...easy.filter((c) => c.id !== id),
    ]);
    return service.start('m1', characterData().byId.get(id)!.difficulty);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    rounds = [];
    scoredToday = 0;
    service = new BibleCharacterGameService(
      roundRepo as any,
      characters as any,
      bibleGames as any,
      tz as any,
      txHost as any,
    );
  });

  it('starts a game on a character of the chosen difficulty and leaves any old one unfinished', async () => {
    const view = await startOn('david');
    expect(rounds[0]).toMatchObject({
      characterId: 'david',
      difficulty: 'easy',
      status: 'active',
    });
    expect(roundRepo.update).toHaveBeenCalledWith(
      { memberId: 'm1', status: CharacterRoundStatus.ACTIVE },
      expect.objectContaining({ status: CharacterRoundStatus.ABANDONED }),
    );
    expect(view).toMatchObject({
      stillPossible: list.filter((c) => c.difficulty === 'easy').length,
      worth: 60,
      hintsLeft: 3,
      guessesLeft: 3,
      result: null,
    });
  });

  it('answers questions from the data and refuses repeats', async () => {
    await startOn('david');
    const view = await service.ask('m1', 'r1', 'king');
    expect(view.asked).toEqual([
      { questionId: 'king', text: 'Were they a king?', answer: true },
    ]);
    expect(view.stillPossible).toBeLessThan(
      list.filter((c) => c.difficulty === 'easy').length,
    );
    await expect(service.ask('m1', 'r1', 'king')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('gives clue verses with the name blanked out', async () => {
    await startOn('david');
    const view = await service.hint('m1', 'r1');
    expect(view.hints[0].label).toBe('1 Samuel 16:13');
    expect(view.hints[0].text).not.toMatch(/David/);
    expect(view.hints[0].text).toMatch(/___/);
    expect(view.worth).toBe(51);
  });

  it('scores a correct guess and adds it to the Characters board', async () => {
    await startOn('david');
    await service.ask('m1', 'r1', 'king');
    const view = await service.guess('m1', 'r1', 'david');
    expect(view.status).toBe('won');
    expect(view.result).toMatchObject({
      won: true,
      points: 60,
      scored: true,
      questionsAsked: 1,
      character: { name: 'David' },
    });
    expect(bibleGames.awardPoints).toHaveBeenCalledWith(
      'm1',
      'characters',
      60,
      1,
    );
  });

  it('plays for fun after the day’s scored games', async () => {
    scoredToday = 5;
    await startOn('david');
    const view = await service.guess('m1', 'r1', 'david');
    expect(view.result).toMatchObject({ won: true, points: 0, scored: false });
    expect(bibleGames.awardPoints).not.toHaveBeenCalled();
  });

  it('ends the game after three wrong guesses, with no points', async () => {
    await startOn('david');
    await service.guess('m1', 'r1', 'saul');
    let view = await service.guess('m1', 'r1', 'solomon');
    expect(view).toMatchObject({ status: 'active', guessesLeft: 1 });
    view = await service.guess('m1', 'r1', 'goliath');
    expect(view.status).toBe('lost');
    expect(view.result).toMatchObject({
      won: false,
      points: 0,
      character: { name: 'David' },
    });
    await expect(service.ask('m1', 'r1', 'king')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(bibleGames.awardPoints).not.toHaveBeenCalled();
  });

  it('reveals the character when a member gives up', async () => {
    await startOn('ruth');
    const view = await service.giveUp('m1', 'r1');
    expect(view.result).toMatchObject({
      won: false,
      points: 0,
      character: { name: 'Ruth' },
    });
    expect(view.result!.character.clues[0].text).toMatch(/Ruth/);
  });

  it('waits until the service ends', async () => {
    bibleGames.inService.mockResolvedValueOnce(true);
    await expect(service.start('m1', 'easy')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('deals a shuffled Charades deck from the playable characters, optionally at one level', async () => {
    const all = await service.charadesDeck();
    expect(all.deck.length).toBe(Math.min(80, list.length));
    expect(new Set(all.deck.map((c) => c.id)).size).toBe(all.deck.length);
    expect(all.deck[0]).toEqual({
      id: expect.any(String),
      name: expect.any(String),
      summary: expect.any(String),
      testament: expect.stringMatching(/OT|NT/),
      difficulty: expect.any(String),
    });
    const hard = await service.charadesDeck('hard');
    expect(hard.deck.every((c) => c.difficulty === 'hard')).toBe(true);
  });
});
