import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { NetworkSettingsService } from './network-settings.service';

function setup(saved: object | null = null) {
  const repo = {
    findOne: jest.fn().mockResolvedValue(saved && { settings: saved }),
    upsert: jest.fn(),
  };
  const cache = {
    getGlobal: jest.fn().mockResolvedValue(undefined),
    setGlobal: jest.fn(),
    delGlobal: jest.fn(),
  };
  return {
    service: new NetworkSettingsService(repo as never, cache as never),
    repo,
    cache,
  };
}

describe('NetworkSettingsService', () => {
  it('fills anything unset with the default and pulls stored values back inside the range', async () => {
    const values = await setup({ attendanceDropPercent: 90 }).service.get(
      'root',
    );
    expect(values.attendanceDropPercent).toBe(50);
    expect(values.minAdmins).toBe(2);
    expect(values.visitSuggestVisits).toBe(4);
  });

  it('lets owners of the top church change values within the platform range', async () => {
    const t = setup();
    const view = await t.service.update('root', true, { noServiceWeeks: 4 });
    expect(view.values.noServiceWeeks).toBe(4);
    expect(t.repo.upsert).toHaveBeenCalled();
    expect(t.cache.delGlobal).toHaveBeenCalledWith('network-settings:root');
    await expect(
      t.service.update('root', true, { noServiceWeeks: 30 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      t.service.update('root', false, { noServiceWeeks: 4 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
