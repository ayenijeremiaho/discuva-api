import { NotificationCentreService } from './notification-centre.service';
import { EmailCategory } from '../utility/email-provider/email-category.enum';
import { NOTIFICATION_GROUPS } from './notification-centre.constant';
import { queryTenant } from '../tenant/utility/query-tenant';

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
  const usage = { forMonth: jest.fn() };
  const allowance = { status: jest.fn() };
  const credentials = { resolveConfig: jest.fn() };
  const sms = { getBalance: jest.fn() };
  const cache = { getOrSet: jest.fn() };
  const admin = (...permissions: string[]) =>
    ({ adminRole: { permissions } }) as any;
  const service = new NotificationCentreService(
    categories as any,
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
    cache.getOrSet.mockImplementation((key: string, fetch: () => unknown) =>
      Promise.resolve().then(() =>
        key.endsWith('opt-outs') ? { BIRTHDAY: 2 } : fetch(),
      ),
    );
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
    const result = await service.overview(admin());
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

  it('reports text messages stopped by a missing provider', async () => {
    usage.forMonth.mockResolvedValueOnce({
      'sms:ASSIGNMENT_REMINDER:no_provider': 4,
    });
    const { blocks, types } = await service.overview(admin());
    expect(
      types.find((t) => t.category === 'ASSIGNMENT_REMINDER')?.smsReminderKey,
    ).toBe('assignment_due');
    expect(blocks.sms).toEqual({
      providerConfigured: false,
      balance: null,
      stoppedThisMonth: 4,
    });
  });

  it('reports the daily email limit', async () => {
    allowance.status.mockResolvedValue({ limit: 20, usedToday: 21 });
    usage.forMonth.mockResolvedValueOnce({ 'email:BIRTHDAY:limited': 1 });
    const { blocks } = await service.overview(admin());
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
    const { blocks } = await service.overview(admin('sms:read'));
    expect(blocks.sms.providerConfigured).toBe(true);
    expect(blocks.sms.balance).toBeNull();
  });

  it('shows the SMS balance only to admins who may read it', async () => {
    credentials.resolveConfig.mockResolvedValue({ providerId: 'termii' });
    sms.getBalance.mockResolvedValue({ balance: 10, currency: 'NGN' });

    const denied = await service.overview(admin());
    expect(denied.blocks.sms.balance).toBeNull();
    expect(sms.getBalance).not.toHaveBeenCalled();

    const allowed = await service.overview(admin('sms:read'));
    expect(allowed.blocks.sms.balance).toEqual({
      balance: 10,
      currency: 'NGN',
    });
  });

  it('counts opt-outs from active members through the partial index', async () => {
    await service.overview(admin());
    const fetchOptOuts = cache.getOrSet.mock.calls.find(([key]) =>
      key.endsWith('opt-outs'),
    )[1];
    (queryTenant as jest.Mock).mockClear();
    await fetchOptOuts();
    const sql = (queryTenant as jest.Mock).mock.calls[0][2]('s');
    expect(sql).toContain('cardinality(muted_notifications) > 0');
    expect(sql).toContain("status = 'ACTIVE'");
  });
});
