import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { ProtectedNameService } from './protected-name.service';

const repo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  create: jest.fn(() => ({})),
  save: jest.fn((e) => Promise.resolve(e)),
  delete: jest.fn(),
};
const tenantRepo = { find: jest.fn() };
const cache = {
  getGlobal: jest.fn().mockResolvedValue(undefined),
  setGlobal: jest.fn(),
  delGlobal: jest.fn(),
};

describe('ProtectedNameService', () => {
  let service: ProtectedNameService;

  beforeEach(() => {
    jest.clearAllMocks();
    cache.getGlobal.mockResolvedValue(undefined);
    repo.find.mockResolvedValue([
      {
        name: 'Covenant Grace Church of Nations',
        shortForms: ['cgcn'],
        addresses: ['cgcn'],
      },
    ]);
    tenantRepo.find.mockResolvedValue([
      { id: 't-grace', name: 'Grace Chapel Lekki' },
    ]);
    service = new ProtectedNameService(
      repo as never,
      tenantRepo as never,
      cache as never,
    );
  });

  it('names the protected organisation a sign-up looks like', async () => {
    expect(await service.findNameMatch('Covenant Graces of Nations')).toBe(
      'Covenant Grace Church of Nations',
    );
    expect(await service.findNameMatch('Hope Prayer Circle')).toBeNull();
  });

  it('protects verified churches, but never from themselves', async () => {
    expect(await service.findNameMatch('Grace Chapel, Lekki')).toBe(
      'Grace Chapel Lekki',
    );
    expect(
      await service.findNameMatch('Grace Chapel, Lekki', 't-grace'),
    ).toBeNull();
  });

  it('reads the database once, then uses the cache', async () => {
    await service.findNameMatch('Anything');
    expect(cache.setGlobal).toHaveBeenCalledTimes(1);
    cache.getGlobal.mockResolvedValue(cache.setGlobal.mock.calls[0][1]);
    repo.find.mockClear();

    expect(await service.isReservedAddress('cgcn-lekki')).toBe(true);
    expect(repo.find).not.toHaveBeenCalled();
  });

  it('only reserves addresses from the protected list', async () => {
    expect(await service.isReservedAddress('gracechapellekki')).toBe(false);
  });

  it('tidies short forms and addresses and clears the cache on save', async () => {
    const saved = await service.create(
      {
        name: '  Harvest Light Bible Church ',
        shortForms: ['HLBC', 'hlbc', ' '],
        addresses: ['HLBC'],
      },
      'admin-1',
    );
    expect(saved).toMatchObject({
      name: 'Harvest Light Bible Church',
      shortForms: ['hlbc'],
      addresses: ['hlbc'],
      note: null,
      updatedById: 'admin-1',
    });
    expect(cache.delGlobal).toHaveBeenCalledWith('protected-names:v1');
  });

  it('says so when a name is already protected', async () => {
    repo.save.mockRejectedValueOnce(
      new QueryFailedError('', [], new Error('UQ_protected_names_name')),
    );
    await expect(
      service.create({ name: 'Harvest Light Bible Church' }, 'admin-1'),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses to edit or remove a name that is gone', async () => {
    repo.findOneBy.mockResolvedValueOnce(null);
    await expect(service.update('x', { name: 'A' }, 'admin-1')).rejects.toThrow(
      NotFoundException,
    );
    repo.delete.mockResolvedValueOnce({ affected: 0 });
    await expect(service.remove('x')).rejects.toThrow(NotFoundException);
  });
});
