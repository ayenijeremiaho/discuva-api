import { BadRequestException } from '@nestjs/common';
import { VolunteerChatSettingsService } from './volunteer-chat-settings.service';

describe('VolunteerChatSettingsService', () => {
  const spaceRepo = { query: jest.fn() };
  const cache = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(1),
    key: jest.fn().mockReturnValue('cache-key'),
  };
  const audit = { log: jest.fn() };
  const service = new VolunteerChatSettingsService(
    spaceRepo as never,
    cache as never,
    audit as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('defaults to 3 days open and 14 listed, and caches the result', async () => {
    spaceRepo.query.mockResolvedValueOnce([]);
    expect(await service.get()).toEqual({ openDays: 3, listedDays: 14 });
    expect(cache.set).toHaveBeenCalledWith(
      'volunteering:chat',
      { openDays: 3, listedDays: 14 },
      600,
    );
  });

  it("reads the church's saved values, and uses the cache when it can", async () => {
    spaceRepo.query.mockResolvedValueOnce([
      { value: { openDays: 0, listedDays: 7 } },
    ]);
    expect(await service.get()).toEqual({ openDays: 0, listedDays: 7 });
    cache.get.mockResolvedValueOnce({ openDays: 5, listedDays: 20 });
    expect(await service.get()).toEqual({ openDays: 5, listedDays: 20 });
    expect(spaceRepo.query).toHaveBeenCalledTimes(1);
  });

  it('saves, clears the cache and records who changed it', async () => {
    spaceRepo.query.mockResolvedValueOnce([]);
    await service.save({ openDays: 7, listedDays: 30 }, 'm1');
    expect(spaceRepo.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (key)'),
      ['volunteering:chat', JSON.stringify({ openDays: 7, listedDays: 30 })],
    );
    expect(cache.del).toHaveBeenCalledWith('volunteering:chat');
    expect(audit.log).toHaveBeenCalledWith(
      'VOLUNTEER_CHAT_SETTINGS_UPDATED',
      expect.objectContaining({
        actorId: 'm1',
        metadata: { openDays: 7, listedDays: 30 },
      }),
    );
  });

  it('refuses to hide a chat while it is still open', async () => {
    await expect(service.save({ openDays: 10, listedDays: 5 })).rejects.toThrow(
      BadRequestException,
    );
    expect(spaceRepo.query).not.toHaveBeenCalled();
  });
});
