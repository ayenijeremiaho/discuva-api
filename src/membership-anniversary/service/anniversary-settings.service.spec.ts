import {
  AnniversarySettingsService,
  DEFAULT_ANNIVERSARY_SETTINGS,
  renderAnniversaryText,
} from './anniversary-settings.service';
import { ChurchSetting } from '../../church-settings/entity/church-setting.entity';
import { Repository } from 'typeorm';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

describe('AnniversarySettingsService', () => {
  const repo = {
    findOne: jest.fn(),
    create: jest.fn((v: Partial<ChurchSetting>) => ({ ...v })),
    save: jest.fn((v: ChurchSetting) => Promise.resolve(v)),
  };
  const cache = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(1),
  };
  const audit = { log: jest.fn() };
  const service = new AnniversarySettingsService(
    repo as unknown as Repository<ChurchSetting>,
    cache as unknown as CacheService,
    audit as unknown as AuditLogService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('falls back to the defaults when nothing is saved', async () => {
    repo.findOne.mockResolvedValue(null);
    expect(await service.get()).toEqual(DEFAULT_ANNIVERSARY_SETTINGS);
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { key: 'anniversary:post' },
    });
  });

  it('keeps what is not sent, ignores blank wording and clears the cache', async () => {
    repo.findOne.mockResolvedValue(null);
    const saved = await service.update(
      {
        postEnabled: false,
        title: '  ',
        message: 'Thank God for {first_name}',
      },
      'admin-1',
    );
    expect(saved).toEqual({
      postEnabled: false,
      title: DEFAULT_ANNIVERSARY_SETTINGS.title,
      message: 'Thank God for {first_name}',
    });
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'anniversary:post', value: saved }),
    );
    expect(cache.del).toHaveBeenCalledWith('anniversary-settings');
  });

  it('fills in the placeholders', () => {
    const member = { firstname: 'Ada', lastname: 'Obi' };
    expect(
      renderAnniversaryText(
        '{years} with {full_name}, {first_name}',
        member,
        1,
      ),
    ).toBe('1 year with Ada Obi, Ada');
    expect(renderAnniversaryText('{years}', member, 4)).toBe('4 years');
  });
});
