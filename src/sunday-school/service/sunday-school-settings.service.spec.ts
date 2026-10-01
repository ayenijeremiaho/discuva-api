import { ForbiddenException } from '@nestjs/common';
import { SundaySchoolSettingsService } from './sunday-school-settings.service';

describe('SundaySchoolSettingsService', () => {
  const settingRepo = {
    findOne: jest.fn(),
    create: jest.fn((v) => v),
    save: jest.fn((v) => Promise.resolve(v)),
  };
  const severalQb = {
    select: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    having: jest.fn().mockReturnThis(),
    getRawMany: jest
      .fn()
      .mockResolvedValue([{ member_id: 'm1' }, { member_id: 'm2' }]),
  };
  const assignRepo = { createQueryBuilder: jest.fn(() => severalQb) };
  const cache = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn(),
    del: jest.fn(),
  };
  const audit = { log: jest.fn() };
  const service = new SundaySchoolSettingsService(
    settingRepo as any,
    assignRepo as any,
    cache as any,
    audit as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    cache.get.mockResolvedValue(undefined);
  });

  it('defaults to several classes allowed and teachers able to add members and check in first-timers', async () => {
    settingRepo.findOne.mockResolvedValue(null);
    await expect(service.getSettings()).resolves.toEqual({
      oneClassPerMember: false,
      teachersCanAddMembers: true,
      teachersCanCheckInFirstTimers: true,
      membersInSeveralClasses: 2,
    });
  });

  it('reads a stored "off" as off, not the default', async () => {
    settingRepo.findOne.mockResolvedValue({ value: { enabled: false } });
    await expect(service.teacherPermissions()).resolves.toEqual({
      teachersCanAddMembers: false,
      teachersCanCheckInFirstTimers: false,
    });
  });

  it('saves only the switches sent, clears their cache and audits them', async () => {
    settingRepo.findOne.mockResolvedValue(null);
    await service.update(
      { oneClassPerMember: true, teachersCanAddMembers: false },
      'admin-member',
    );

    expect(settingRepo.save).toHaveBeenCalledTimes(2);
    expect(settingRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'sunday_school:one_class_per_member',
        value: { enabled: true },
      }),
    );
    expect(settingRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'sunday_school:teachers_can_add_members',
        value: { enabled: false },
      }),
    );
    expect(cache.del).toHaveBeenCalledWith(
      'sunday-school-settings:one-class-per-member',
    );
    expect(cache.del).toHaveBeenCalledWith(
      'sunday-school-settings:teachers-can-add-members',
    );
    expect(audit.log).toHaveBeenCalledWith(
      'SUNDAY_SCHOOL_SETTINGS_UPDATED',
      expect.objectContaining({
        metadata: { oneClassPerMember: true, teachersCanAddMembers: false },
      }),
    );
  });

  it('updates an existing row in place', async () => {
    const row = {
      key: 'sunday_school:teachers_can_check_in_first_timers',
      value: { enabled: true },
    };
    settingRepo.findOne.mockResolvedValue(row);
    await service.update({ teachersCanCheckInFirstTimers: false });
    expect(settingRepo.save).toHaveBeenCalledWith({
      ...row,
      value: { enabled: false },
    });
  });

  it('uses the cached value when present', async () => {
    cache.get.mockResolvedValue(true);
    await expect(service.isOneClassPerMember()).resolves.toBe(true);
    expect(settingRepo.findOne).not.toHaveBeenCalled();
  });

  it('blocks teachers only when the switch is off', async () => {
    cache.get.mockResolvedValue(true);
    await expect(
      service.assertTeachersCanAddMembers(),
    ).resolves.toBeUndefined();
    cache.get.mockResolvedValue(false);
    await expect(service.assertTeachersCanAddMembers()).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.assertTeachersCanCheckInFirstTimers()).rejects.toThrow(
      ForbiddenException,
    );
  });
});
