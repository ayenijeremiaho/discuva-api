import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SharedSpaceService } from './shared-space.service';
import { SharedSpaceAudienceEnum } from '../entity/shared-space.entity';

const dto = (over = {}) => ({
  name: 'Easter Outreach',
  audience: SharedSpaceAudienceEnum.CUSTOM,
  leadersOnly: false,
  departmentIds: ['d1'],
  groupIds: [],
  memberIds: ['m2'],
  leaderIds: ['m1'],
  ...over,
});

describe('SharedSpaceService', () => {
  const sharedRepo = {
    find: jest.fn(),
    findOneBy: jest.fn(),
    save: jest.fn(),
    create: jest.fn((v) => v),
    update: jest.fn(),
    query: jest.fn().mockResolvedValue([]),
  };
  const spaceRepo = { update: jest.fn(), find: jest.fn() };
  const access = { ensureSpace: jest.fn() };
  const audit = { log: jest.fn() };
  const service = new SharedSpaceService(
    sharedRepo as never,
    spaceRepo as never,
    access as never,
    audit as never,
  );
  const sql = () => sharedRepo.query.mock.calls.map((c) => c[0] as string);

  beforeEach(() => {
    jest.clearAllMocks();
    sharedRepo.query.mockResolvedValue([]);
    sharedRepo.save.mockResolvedValue({ id: 's1', name: 'Easter Outreach' });
    access.ensureSpace.mockResolvedValue({ id: 'room1' });
  });

  it('needs a leader', async () => {
    await expect(
      service.create(dto({ leaderIds: [] }) as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('needs someone to be in a custom space', async () => {
    await expect(
      service.create(dto({ departmentIds: [], memberIds: [] }) as never),
    ).rejects.toThrow('Choose who');
  });

  it('saves teams, people and the leaders-only choice', async () => {
    await service.create(dto({ leadersOnly: true }) as never, 'actor');
    expect(
      sql().some((q) => q.includes('INSERT INTO shared_space_sources')),
    ).toBe(true);
    const insert = sharedRepo.query.mock.calls.find((c) =>
      (c[0] as string).includes('INSERT INTO shared_space_people'),
    );
    expect(insert?.[1]).toEqual(['s1', ['m1', 'm2'], ['m1']]);
    expect(spaceRepo.update).toHaveBeenCalledWith('room1', {
      leadersOnly: true,
    });
    expect(audit.log).toHaveBeenCalledWith(
      'SHARED_SPACE_CREATED',
      expect.objectContaining({ actorId: 'actor' }),
    );
  });

  it('keeps only leaders by name for an automatic audience', async () => {
    await service.create(
      dto({ audience: SharedSpaceAudienceEnum.ALL_WORKERS }) as never,
    );
    expect(
      sql().some((q) => q.includes('INSERT INTO shared_space_sources')),
    ).toBe(false);
    const insert = sharedRepo.query.mock.calls.find((c) =>
      (c[0] as string).includes('INSERT INTO shared_space_people'),
    );
    expect(insert?.[1]).toEqual(['s1', ['m1'], ['m1']]);
  });

  it('archives without deleting the conversation', async () => {
    sharedRepo.findOneBy.mockResolvedValue({ id: 's1' });
    await service.setArchived('s1', true);
    expect(sharedRepo.update.mock.calls[0][1].archivedAt).toBeInstanceOf(Date);
    expect(sql().some((q) => q.includes('DELETE'))).toBe(false);
  });

  it('reports a missing space', async () => {
    sharedRepo.findOneBy.mockResolvedValue(null);
    await expect(service.setArchived('x', true)).rejects.toThrow(
      NotFoundException,
    );
  });
});
