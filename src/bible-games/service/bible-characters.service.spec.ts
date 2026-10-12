import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BibleCharactersService } from './bible-characters.service';
import { characterData } from '../engine/characters';

describe('BibleCharactersService', () => {
  let rows: any[];
  let setting: any;
  const reviewRepo = {
    find: jest.fn(async () => rows),
    findOne: jest.fn(
      async ({ where }: any) =>
        rows.find((r) => r.characterId === where.characterId) ?? null,
    ),
    create: jest.fn((v: any) => ({ ...v })),
    save: jest.fn(async (v: any) => {
      rows = [...rows.filter((r) => r.characterId !== v.characterId), v];
      return v;
    }),
  };
  const settingRepo = {
    findOne: jest.fn(async () => setting),
    create: jest.fn((v: any) => v),
    save: jest.fn(async (v: any) => (setting = v)),
  };
  const cache = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(1),
    key: jest.fn((...parts: string[]) => parts.join(':')),
  };
  const audit = { log: jest.fn() };
  const admin = {
    id: 'admin-1',
    member: { id: 'm1', firstname: 'Grace', lastname: 'Adebayo' },
  } as any;
  let service: BibleCharactersService;

  beforeEach(() => {
    jest.clearAllMocks();
    rows = [];
    setting = null;
    service = new BibleCharactersService(
      reviewRepo as any,
      settingRepo as any,
      cache as any,
      audit as any,
    );
  });

  it('lists every character live by default, with clue text and what the game answers yes to', async () => {
    const list = await service.adminList();
    expect(list.total).toBe(characterData().list.length);
    expect(list).toMatchObject({
      reviewed: 0,
      hidden: 0,
      settings: { onlyReviewed: false },
    });
    const david = list.characters.find((c) => c.id === 'david')!;
    expect(david.clues[0]).toEqual(
      expect.objectContaining({
        ref: '1SA.16.13',
        label: '1 Samuel 16:13',
        text: expect.stringContaining('David'),
      }),
    );
    expect(david.family.children.map((c) => c.id)).toEqual([
      'solomon',
      'absalom',
    ]);
    expect(david.yes).toContainEqual({
      group: 'role',
      text: 'Were they a king?',
    });
  });

  it('records who reviewed a character and clears it when unmarked', async () => {
    rows = [];
    reviewRepo.find.mockImplementationOnce(async () => [
      {
        characterId: 'ruth',
        hidden: false,
        reviewedAt: new Date(),
        reviewedBy: admin,
        summaryOverride: null,
        cluesOverride: null,
      },
    ]);
    const view = await service.update('ruth', { reviewed: true }, admin);
    expect(rows[0]).toMatchObject({
      characterId: 'ruth',
      reviewedBy: admin,
      updatedBy: admin,
    });
    expect(rows[0].reviewedAt).toBeInstanceOf(Date);
    expect(view).toMatchObject({ reviewedBy: 'Grace Adebayo' });

    await service.update('ruth', { reviewed: false }, admin);
    expect(rows[0]).toMatchObject({ reviewedBy: null, reviewedAt: null });
    expect(cache.del).toHaveBeenCalledWith('bible-characters:reviews');
  });

  it('only accepts clue verses that exist and name the character', async () => {
    await expect(
      service.update('ruth', { clues: ['RUT.1.16', 'GEN.1.1'] }, admin),
    ).rejects.toThrow(/Genesis 1:1 doesn't mention Ruth/);
    await expect(
      service.update('ruth', { clues: ['RUT.1.16', 'RUT.99.1'] }, admin),
    ).rejects.toThrow(BadRequestException);
    await service.update('ruth', { clues: ['Ruth 1:16', 'RUT.4.13'] }, admin);
    expect(rows[0].cluesOverride).toEqual(['RUT.1.16', 'RUT.4.13']);
    await expect(
      service.update('ruth', { clues: ['Ruth 1:16', 'RUT.1.16'] }, admin),
    ).rejects.toThrow(/must be different/);
  });

  it('stores no override when an edit matches the original', async () => {
    const ruth = characterData().byId.get('ruth')!;
    await service.update(
      'ruth',
      { summary: ruth.summary, clues: ruth.clues },
      admin,
    );
    expect(rows[0]).toMatchObject({
      summaryOverride: null,
      cluesOverride: null,
    });
  });

  it('rejects an unknown character', async () => {
    await expect(
      service.update('goliath_2', { hidden: true }, admin),
    ).rejects.toThrow(NotFoundException);
  });

  it('plays only characters that are not hidden, and only reviewed ones when the church asks', async () => {
    rows = [
      {
        characterId: 'goliath',
        hidden: true,
        reviewedAt: null,
        reviewedBy: null,
        summaryOverride: null,
        cluesOverride: null,
      },
      {
        characterId: 'ruth',
        hidden: false,
        reviewedAt: new Date(),
        reviewedBy: admin,
        summaryOverride: 'Our summary',
        cluesOverride: null,
      },
    ];
    let playable = await service.playable();
    expect(playable.find((c) => c.id === 'goliath')).toBeUndefined();
    expect(playable.find((c) => c.id === 'ruth')!.summary).toBe('Our summary');
    expect(playable.length).toBe(characterData().list.length - 1);

    setting = {
      key: 'bible_characters:settings',
      value: { onlyReviewed: true },
    };
    playable = await service.playable();
    expect(playable.map((c) => c.id)).toEqual(['ruth']);
  });

  it('saves the only-reviewed switch', async () => {
    await service.updateSettings({ onlyReviewed: true }, admin);
    expect(setting).toMatchObject({
      key: 'bible_characters:settings',
      value: { onlyReviewed: true },
    });
    expect(cache.del).toHaveBeenCalledWith('bible-characters:settings');
  });

  it('saves the duel turn limit without touching the other setting, defaulting to 24 hours', async () => {
    expect((await service.settings()).turnHours).toBe(24);
    await service.updateSettings({ onlyReviewed: true }, admin);
    await service.updateSettings(
      { onlyReviewed: undefined, turnHours: 48 },
      admin,
    );
    expect(setting.value).toEqual({ onlyReviewed: true, turnHours: 48 });
    setting = { key: 'bible_characters:settings', value: { turnHours: 5 } };
    expect((await service.settings()).turnHours).toBe(24);
  });
});
