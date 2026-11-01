import { NotificationCentreService } from './notification-centre.service';
import { EmailCategory } from '../utility/email-provider/email-category.enum';
import { NOTIFICATION_GROUPS } from './notification-centre.constant';

jest.mock('../tenant/utility/query-tenant', () => ({
  queryTenant: jest.fn().mockResolvedValue([]),
}));

describe('NotificationCentreService', () => {
  const setting = (category: string) => ({
    category,
    label: category,
    description: '',
    enabled: true,
    essential: false,
    hasPush: false,
    pushEnabled: false,
    pushFirst: false,
    mode: 'EMAIL_ONLY',
  });
  const categories = { findAll: jest.fn() };
  const reminders = { findAll: jest.fn() };
  const usage = { forMonth: jest.fn() };
  const allowance = { status: jest.fn() };
  const credentials = { resolveConfig: jest.fn() };
  const sms = { getBalance: jest.fn() };
  const cache = {
    getOrSet: jest.fn().mockResolvedValue({ BIRTHDAY: 2 }),
  };
  const service = new NotificationCentreService(
    categories as any,
    reminders as any,
    usage as any,
    allowance as any,
    credentials as any,
    sms as any,
    cache as any,
    {} as any,
    { get: () => 'schema' } as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    categories.findAll.mockResolvedValue([
      setting('BIRTHDAY'),
      setting('ASSIGNMENT_REMINDER'),
    ]);
    reminders.findAll.mockResolvedValue([
      { key: 'assignment_due', smsEnabled: true },
    ]);
    usage.forMonth.mockResolvedValue({});
    allowance.status.mockResolvedValue(null);
    credentials.resolveConfig.mockResolvedValue(null);
  });

  it('gives every category a group', () => {
    for (const c of Object.values(EmailCategory)) {
      expect(NOTIFICATION_GROUPS[c]).toBeTruthy();
    }
  });

  it('combines switches, usage and opt-outs per type', async () => {
    usage.forMonth.mockResolvedValueOnce({
      'email:BIRTHDAY:sent': 5,
      'email:BIRTHDAY:off': 2,
      'sms:ANNOUNCEMENTS:sent': 3,
    });
    const result = await service.overview();
    const birthday = result.types.find((t) => t.category === 'BIRTHDAY');
    expect(birthday).toMatchObject({
      group: 'People and care',
      optedOut: 2,
      usage: { email: { sent: 5, off: 2 } },
    });
    expect(result.totals).toEqual({ email: 5, push: 0, sms: 3 });
    expect(
      result.fixedTypes.find((t) => t.category === 'ANNOUNCEMENTS')?.usage.sms,
    ).toEqual({ sent: 3 });
  });

  it('warns when text reminders are on with no provider', async () => {
    usage.forMonth.mockResolvedValueOnce({
      'sms:ASSIGNMENT_REMINDER:no_provider': 4,
    });
    const { blocks, types } = await service.overview();
    expect(
      types.find((t) => t.category === 'ASSIGNMENT_REMINDER')?.smsReminderKey,
    ).toBe('assignment_due');
    expect(blocks.sms).toEqual({
      providerConfigured: false,
      balance: null,
      textRemindersOn: true,
      stoppedThisMonth: 4,
    });
  });

  it('reports the daily email limit', async () => {
    allowance.status.mockResolvedValue({ limit: 20, usedToday: 21 });
    usage.forMonth.mockResolvedValueOnce({ 'email:BIRTHDAY:limited': 1 });
    const { blocks } = await service.overview();
    expect(blocks.emailLimit).toEqual({
      limit: 20,
      usedToday: 21,
      reachedToday: true,
      stoppedThisMonth: 1,
    });
  });

  it('still loads when the SMS balance fails', async () => {
    credentials.resolveConfig.mockResolvedValue({ providerId: 'termii' });
    sms.getBalance.mockRejectedValue(new Error('down'));
    const { blocks } = await service.overview();
    expect(blocks.sms.providerConfigured).toBe(true);
    expect(blocks.sms.balance).toBeNull();
  });
});
