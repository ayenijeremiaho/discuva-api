import { ConfigService } from '@nestjs/config';
import { MailgunProvider } from './mailgun.provider';

describe('MailgunProvider', () => {
  let provider: MailgunProvider;
  let mockConfig: ConfigService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true });
    (global as any).fetch = fetchMock;
    mockConfig = {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          MAILGUN_API_KEY: 'platform-key',
          MAILGUN_DOMAIN: 'mg.platform.com',
        };
        return values[key];
      }),
    } as any;
    provider = new MailgunProvider(mockConfig);
  });

  it('sends using the platform default API key/domain when no BYOK credentials are given', async () => {
    await provider.sendMail({
      from: 'platform@example.com',
      to: 'member@example.com',
      subject: 'Hi',
      html: '<p>hi</p>',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.mailgun.net/v3/mg.platform.com/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('api:platform-key').toString('base64')}`,
        }),
      }),
    );
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get('from')).toBe('platform@example.com');
    expect(form.get('subject')).toBe('Hi');
  });

  it('uses tenant BYOK apiKey/domain and honors MAILGUN_BASE_URL for EU region', async () => {
    mockConfig = {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          MAILGUN_BASE_URL: 'https://api.eu.mailgun.net/v3',
        };
        return values[key];
      }),
    } as any;
    provider = new MailgunProvider(mockConfig);

    await provider.sendMail(
      {
        from: 'tenant@example.com',
        to: ['a@example.com', 'b@example.com'],
        subject: 'Hi',
        html: '<p>hi</p>',
      },
      { apiKey: 'tenant-key', domain: 'mg.tenantchurch.org' },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.eu.mailgun.net/v3/mg.tenantchurch.org/messages',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('api:tenant-key').toString('base64')}`,
        }),
      }),
    );
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.getAll('to')).toEqual(['a@example.com', 'b@example.com']);
  });

  it('throws when no API key/domain is configured anywhere', async () => {
    mockConfig = { get: jest.fn().mockReturnValue(undefined) } as any;
    provider = new MailgunProvider(mockConfig);

    await expect(
      provider.sendMail({
        from: 'tenant@example.com',
        to: 'member@example.com',
        subject: 'Hi',
        html: '<p>hi</p>',
      }),
    ).rejects.toThrow('No Mailgun API key/domain configured');
  });

  it('throws when Mailgun responds with a non-ok status', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('unauthorized'),
    });

    await expect(
      provider.sendMail({
        from: 'platform@example.com',
        to: 'member@example.com',
        subject: 'Hi',
        html: '<p>hi</p>',
      }),
    ).rejects.toThrow('Mailgun send failed (401): unauthorized');
  });
});
