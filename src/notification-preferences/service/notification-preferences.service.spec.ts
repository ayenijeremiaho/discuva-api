import { NotFoundException } from '@nestjs/common';
import { NotificationPreferencesService } from './notification-preferences.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';

describe('NotificationPreferencesService', () => {
  const updateQb: Record<string, jest.Mock> = {};
  for (const m of ['update', 'set', 'where', 'setParameter'])
    updateQb[m] = jest.fn().mockReturnValue(updateQb);
  updateQb.execute = jest.fn().mockResolvedValue({ affected: 1 });
  const memberRepo = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(() => updateQb),
  };
  const churchSettings = { isEnabled: jest.fn() };
  const categorySettings = { isEnabled: jest.fn(), isPushEnabled: jest.fn() };
  const planFeatures = { gateReason: jest.fn() };
  const cls = { get: jest.fn().mockReturnValue('tenant-1') };
  const service = new NotificationPreferencesService(
    memberRepo as never,
    churchSettings as never,
    categorySettings as never,
    planFeatures as never,
    cls as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    memberRepo.findOne.mockResolvedValue({
      id: 'm1',
      mutedNotifications: [EmailCategory.BIRTHDAY],
    });
    churchSettings.isEnabled.mockResolvedValue(true);
    categorySettings.isEnabled.mockResolvedValue(true);
    categorySettings.isPushEnabled.mockResolvedValue(true);
    planFeatures.gateReason.mockResolvedValue(null);
  });

  it('lists each kind with whether the member still gets it', async () => {
    const list = await service.list('m1');
    const byCategory = Object.fromEntries(
      list.map((p) => [p.category, p.enabled]),
    );
    expect(byCategory[EmailCategory.BIRTHDAY]).toBe(false);
    expect(byCategory[EmailCategory.EVENT_REMINDER]).toBe(true);
    expect(byCategory[EmailCategory.GIVING_RECEIPT]).toBeUndefined();
  });

  it('hides kinds whose module is off or not on the plan', async () => {
    churchSettings.isEnabled.mockImplementation((key: string) =>
      Promise.resolve(key !== 'notes'),
    );
    planFeatures.gateReason.mockImplementation((_: string, key: string) =>
      Promise.resolve(key === 'bible_games' ? 'NOT_ON_PLAN' : null),
    );
    const categories = (await service.list('m1')).map((p) => p.category);
    expect(categories).not.toContain(EmailCategory.NOTES);
    expect(categories).not.toContain(EmailCategory.BIBLE_GAMES);
    expect(categories).toContain(EmailCategory.FELLOWSHIPS);
  });

  it('hides kinds the church sends neither by email nor by app', async () => {
    categorySettings.isEnabled.mockImplementation((c: string) =>
      Promise.resolve(c !== EmailCategory.BIRTHDAY),
    );
    categorySettings.isPushEnabled.mockImplementation((c: string) =>
      Promise.resolve(c !== EmailCategory.BIRTHDAY),
    );
    const categories = (await service.list('m1')).map((p) => p.category);
    expect(categories).not.toContain(EmailCategory.BIRTHDAY);
  });

  it('turns a kind off and on in one statement', async () => {
    await service.update('m1', {
      category: EmailCategory.EVENT_REMINDER,
      enabled: false,
    });
    expect(updateQb.set.mock.calls[0][0].mutedNotifications()).toBe(
      'array_append(array_remove(muted_notifications, :category), :category)',
    );
    expect(updateQb.setParameter).toHaveBeenCalledWith(
      'category',
      EmailCategory.EVENT_REMINDER,
    );

    await service.update('m1', {
      category: EmailCategory.EVENT_REMINDER,
      enabled: true,
    });
    expect(updateQb.set.mock.calls[1][0].mutedNotifications()).toBe(
      'array_remove(muted_notifications, :category)',
    );
  });

  it('rejects an unknown member', async () => {
    memberRepo.findOne.mockResolvedValue(null);
    await expect(service.list('x')).rejects.toBeInstanceOf(NotFoundException);
  });
});
