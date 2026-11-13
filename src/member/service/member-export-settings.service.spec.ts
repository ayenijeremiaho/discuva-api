import { MemberExportSettingsService } from './member-export-settings.service';
import { ChurchSetting } from '../../church-settings/entity/church-setting.entity';
import { Repository } from 'typeorm';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

const repo = {
  findOne: jest.fn(),
  upsert: jest.fn().mockResolvedValue(undefined),
};
const cache = {
  get: jest.fn(),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
};
const audit = { log: jest.fn() };
const service = new MemberExportSettingsService(
  repo as unknown as Repository<ChurchSetting>,
  cache as unknown as CacheService,
  audit as unknown as AuditLogService,
);

beforeEach(() => {
  jest.clearAllMocks();
  cache.get.mockResolvedValue(undefined);
  repo.findOne.mockResolvedValue(null);
});

it('defaults to core fields without writing settings', async () => {
  expect(await service.get()).toEqual({ fields: [] });
  expect(repo.upsert).not.toHaveBeenCalled();
});

it('reads only the selected fields from a cached setting', async () => {
  cache.get.mockResolvedValue({
    fields: ['profession', 'password', 'firstname'],
  });
  expect(await service.get()).toEqual({ fields: ['profession'] });
  expect(repo.findOne).not.toHaveBeenCalled();
});

it('keeps members and workers in separate keys', async () => {
  repo.findOne.mockImplementation(({ where }) =>
    Promise.resolve({
      value: {
        fields: where.key.endsWith('workers') ? ['profession'] : ['address'],
      },
    }),
  );
  expect(await service.get()).toEqual({ fields: ['address'] });
  expect(await service.get(true)).toEqual({ fields: ['profession'] });
  expect(cache.get).toHaveBeenCalledWith('member-export:members');
  expect(cache.get).toHaveBeenCalledWith('member-export:workers');
});

it('saves canonical optional fields and invalidates only that export configuration', async () => {
  expect(
    await service.save(
      ['profession', 'department', 'firstname', 'profession'],
      true,
      'admin-1',
    ),
  ).toEqual({ fields: ['profession'] });
  expect(repo.upsert).toHaveBeenCalledWith(
    {
      key: 'member-export:workers',
      moduleName: 'Member Exports',
      value: { fields: ['profession'] },
    },
    ['key'],
  );
  expect(cache.del).toHaveBeenCalledWith('member-export:workers');
  expect(cache.del).not.toHaveBeenCalledWith('member-export:members');
  expect(audit.log).toHaveBeenCalledWith(
    'CHURCH_SETTING_UPDATED',
    expect.objectContaining({ actorId: 'admin-1' }),
  );
});

it('can save an empty selection as the core-only configuration', async () => {
  expect(await service.save([])).toEqual({ fields: [] });
  expect(repo.upsert).toHaveBeenCalled();
});

it('does not invalidate settings or audit a failed save', async () => {
  repo.upsert.mockRejectedValueOnce(new Error('DB down'));
  await expect(service.save(['address'])).rejects.toThrow('DB down');
  expect(cache.del).not.toHaveBeenCalled();
  expect(audit.log).not.toHaveBeenCalled();
});
