import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BibleGamesAdminService } from './bible-games-admin.service';
import { BibleGamesService } from './bible-games.service';
import { BibleGameCustomQuestion } from '../entity/bible-game-custom-question.entity';
import { BibleGameHidden } from '../entity/bible-game-hidden.entity';
import { ChurchTimezoneService } from '../../event/service/church-timezone.service';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { refsInKey } from '../engine/questions';

describe('BibleGamesAdminService', () => {
  let service: BibleGamesAdminService;
  const customRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => ({ id: 'c1', ...v })),
    delete: jest.fn(),
  };
  const hiddenRepo = {
    find: jest.fn(),
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => v),
    delete: jest.fn(),
  };
  const query = jest.fn();
  const hidden = new Set<string>();
  const games = {
    content: jest.fn(async () => ({ hidden, custom: [] })),
    isHidden: jest.fn(
      (q: { key: string }, h: Set<string>) =>
        h.has(q.key) || refsInKey(q.key).some((r) => h.has(`verse:${r}`)),
    ),
  };
  const cacheService = {
    del: jest.fn(),
    key: jest.fn((a: string, b: string) => `${a}:${b}`),
  };
  const auditLog = { log: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    hidden.clear();
    const module = await Test.createTestingModule({
      providers: [
        BibleGamesAdminService,
        {
          provide: getRepositoryToken(BibleGameCustomQuestion),
          useValue: customRepo,
        },
        { provide: getRepositoryToken(BibleGameHidden), useValue: hiddenRepo },
        { provide: BibleGamesService, useValue: games },
        {
          provide: TransactionHost,
          useValue: { tx: { query: (...a: unknown[]) => query(...a) } },
        },
        {
          provide: ChurchTimezoneService,
          useValue: { get: jest.fn().mockResolvedValue('Africa/Lagos') },
        },
        { provide: CacheService, useValue: cacheService },
        { provide: AuditLogService, useValue: auditLog },
      ],
    }).compile();
    service = module.get(BibleGamesAdminService);
  });

  it('previews a level with answers, and the same sample for the same seed', async () => {
    const a = await service.preview(3, 1);
    const b = await service.preview(3, 1);
    expect(a).toHaveLength(12);
    expect(a.map((q) => q.key)).toEqual(b.map((q) => q.key));
    a.forEach((q) => expect(q.options[q.answer]).toBeDefined());
  });

  it('marks questions on a hidden verse', async () => {
    const sample = await service.preview(1, 2);
    const withVerse = sample.find((q) => q.verses.length)!;
    hidden.add(`verse:${withVerse.verses[0].ref}`);
    const again = await service.preview(1, 2);
    const marked = again.find((q) => q.key === withVerse.key)!;
    expect(marked.hidden).toBe(true);
    expect(marked.hiddenBy).toBe(`verse:${withVerse.verses[0].ref}`);
  });

  it('hiding a question clears the cached settings so the next round respects it', async () => {
    await service.hide({ key: 'finish:JHN.3.16:12' }, 'admin-1');
    expect(hiddenRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'finish:JHN.3.16:12',
        hiddenByAdminId: 'admin-1',
      }),
    );
    expect(cacheService.del).toHaveBeenCalledWith('bible-content:all');
  });

  it('says so when unhiding something that is not hidden', async () => {
    hiddenRepo.delete.mockResolvedValueOnce({ affected: 0 });
    await expect(service.unhide('x', 'admin-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects a church question whose answer is not one of its options or whose levels are reversed', async () => {
    await expect(
      service.createCustom(
        { prompt: 'Who built the ark?', options: ['Noah', 'Moses'], answer: 3 },
        'a',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createCustom(
        {
          prompt: 'Who built the ark?',
          options: ['Noah', 'Moses'],
          answer: 0,
          levelMin: 5,
          levelMax: 2,
        },
        'a',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('saves a church question trimmed, active, and for all levels by default', async () => {
    const saved = await service.createCustom(
      {
        prompt: '  Who built the ark? ',
        options: [' Noah ', 'Moses'],
        answer: 0,
      },
      'admin-1',
    );
    expect(saved).toMatchObject({
      prompt: 'Who built the ark?',
      options: ['Noah', 'Moses'],
      levelMin: 1,
      levelMax: 20,
      active: true,
    });
    expect(cacheService.del).toHaveBeenCalled();
  });

  it('builds stats from the running totals, not the points ledger', async () => {
    query
      .mockResolvedValueOnce([
        { playersThisMonth: 12, pointsThisMonth: 3400, playersAllTime: 40 },
      ])
      .mockResolvedValueOnce([{ players: 7 }])
      .mockResolvedValueOnce([{ level: 1, players: 10 }]);
    const stats = await service.stats();
    expect(stats).toMatchObject({
      playersThisMonth: 12,
      dailyPlayersToday: 7,
      levels: [{ level: 1, players: 10 }],
    });
    for (const [sql] of query.mock.calls)
      expect(sql).not.toContain('bible_game_points');
  });
});
