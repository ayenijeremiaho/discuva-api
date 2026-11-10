import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { FirstTimerCardService } from './first-timer-card.service';
import { FirstTimerField } from '../entity/first-timer-field.entity';
import { FirstTimerFieldType } from '../enums/follow-up.enum';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

const field = (over: Partial<FirstTimerField>): FirstTimerField =>
  ({
    id: 'f',
    key: null,
    label: 'Field',
    type: FirstTimerFieldType.TEXT,
    options: [],
    enabled: true,
    required: false,
    inReport: true,
    sortOrder: 0,
    ...over,
  }) as FirstTimerField;

const enabled = [
  field({ id: 'wa', label: 'WhatsApp', type: FirstTimerFieldType.YES_NO }),
  field({
    id: 'sex',
    label: 'Sex',
    type: FirstTimerFieldType.CHOICE,
    options: ['Female', 'Male'],
    required: true,
  }),
  field({
    id: 'langs',
    label: 'Languages',
    type: FirstTimerFieldType.MULTI_CHOICE,
    options: ['English', 'Yoruba'],
  }),
  field({ id: 'bday', label: 'Birthday', type: FirstTimerFieldType.DAY_MONTH }),
  field({ id: 'addr', label: 'Address' }),
];

describe('FirstTimerCardService', () => {
  const repo = {
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn().mockResolvedValue(3),
    create: jest.fn((v: Partial<FirstTimerField>) => v),
    save: jest.fn((v: unknown) => Promise.resolve(v)),
    delete: jest.fn(),
  };
  const cache = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(1),
    flushNamespace: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { log: jest.fn() };
  const service = new FirstTimerCardService(
    repo as unknown as Repository<FirstTimerField>,
    cache as unknown as CacheService,
    audit as unknown as AuditLogService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    repo.find.mockResolvedValue(enabled);
  });

  describe('cleanAnswers', () => {
    it('keeps valid answers to switched-on fields and drops the rest', async () => {
      const answers = await service.cleanAnswers(
        {
          wa: true,
          sex: 'Female',
          langs: ['Yoruba', 'Yoruba'],
          bday: '01-18',
          addr: '  18 Example Street ',
          gone: 'answer to a deleted field',
        },
        { requireAll: true },
      );
      expect(answers).toEqual({
        wa: true,
        sex: 'Female',
        langs: ['Yoruba'],
        bday: '01-18',
        addr: '18 Example Street',
      });
    });

    it('asks for required answers only when the person fills it in themselves', async () => {
      await expect(
        service.cleanAnswers({ wa: false }, { requireAll: true }),
      ).rejects.toThrow('Please answer "Sex".');
      await expect(
        service.cleanAnswers({ wa: false }, { requireAll: false }),
      ).resolves.toEqual({ wa: false });
    });

    it.each([
      ['sex', 'Other'],
      ['wa', 'yes'],
      ['langs', ['French']],
      ['bday', '13-01'],
      ['addr', 42],
    ])('refuses %s = %p', async (id, value) => {
      await expect(
        service.cleanAnswers({ [id]: value }, { requireAll: false }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reads the switched-on fields from cache when it can', async () => {
      cache.get.mockResolvedValueOnce([]);
      await service.cleanAnswers({ wa: true }, { requireAll: false });
      expect(repo.find).not.toHaveBeenCalled();
    });
  });

  it('needs two options for a choice and tidies them', async () => {
    await expect(
      service.create(
        {
          label: 'Colour',
          type: FirstTimerFieldType.CHOICE,
          options: ['Red', ' Red '],
        },
        'admin',
      ),
    ).rejects.toThrow('at least two options');
    const created = await service.create(
      {
        label: ' Colour ',
        type: FirstTimerFieldType.CHOICE,
        options: ['Red', ' Blue ', ''],
      },
      'admin',
    );
    expect(created).toEqual(
      expect.objectContaining({
        label: 'Colour',
        options: ['Red', 'Blue'],
        enabled: true,
        sortOrder: 3,
      }),
    );
    expect(cache.del).toHaveBeenCalledWith('follow-up:card-fields');
  });

  it("won't delete a ready-made field", async () => {
    repo.findOne.mockResolvedValue(field({ id: 'x', key: 'whatsapp' }));
    await expect(service.remove('x', 'admin')).rejects.toThrow('switched off');
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('saves only the fields whose position changed', async () => {
    repo.find.mockResolvedValue([
      field({ id: 'a', sortOrder: 0 }),
      field({ id: 'b', sortOrder: 1 }),
      field({ id: 'c', sortOrder: 2 }),
    ]);
    const ordered = await service.reorder(['b', 'a'], 'admin');
    expect(ordered.map((f) => f.id)).toEqual(['b', 'a', 'c']);
    expect(repo.save).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'b', sortOrder: 0 }),
      expect.objectContaining({ id: 'a', sortOrder: 1 }),
    ]);
  });
});
