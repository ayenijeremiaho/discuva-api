import { ConfigService } from '@nestjs/config';
import { SendGridProvider } from './sendgrid.provider';

describe('SendGridProvider', () => {
  let provider: SendGridProvider;
  let mockConfig: ConfigService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true });
    (global as any).fetch = fetchMock;
    mockConfig = {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          SENDGRID_API_KEY: 'platform-key',
        };
        return values[key];
      }),
    } as any;
    provider = new SendGridProvider(mockConfig);
  });

  it('sends using the platform default API key when no BYOK credentials are given', async () => {
    await provider.sendMail({
      from: 'platform@example.com',
      to: 'member@example.com',
      subject: 'Hi',
      html: '<p>hi</p>',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.sendgrid.com/v3/mail/send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer platform-key',
        }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.personalizations[0].to).toEqual([
      { email: 'member@example.com' },
    ]);
    expect(body.from).toEqual({ email: 'platform@example.com' });
  });

  it('sends against SENDGRID_BASE_URL when configured, instead of the hardcoded default', async () => {
    mockConfig = {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          SENDGRID_API_KEY: 'platform-key',
          SENDGRID_BASE_URL: 'https://sendgrid.example-region.net',
        };
        return values[key];
      }),
    } as any;
    provider = new SendGridProvider(mockConfig);

    await provider.sendMail({
      from: 'platform@example.com',
      to: 'member@example.com',
      subject: 'Hi',
      html: '<p>hi</p>',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sendgrid.example-region.net/v3/mail/send',
      expect.anything(),
    );
  });

  it('uses the tenant BYOK API key when given', async () => {
    await provider.sendMail(
      {
        from: 'tenant@example.com',
        to: ['a@example.com', 'b@example.com'],
        cc: 'c@example.com',
        subject: 'Hi',
        html: '<p>hi</p>',
      },
      { apiKey: 'tenant-key' },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer tenant-key',
        }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.personalizations[0].to).toEqual([
      { email: 'a@example.com' },
      { email: 'b@example.com' },
    ]);
    expect(body.personalizations[0].cc).toEqual([{ email: 'c@example.com' }]);
  });

  it('throws when no API key is configured anywhere', async () => {
    mockConfig = { get: jest.fn().mockReturnValue(undefined) } as any;
    provider = new SendGridProvider(mockConfig);

    await expect(
      provider.sendMail({
        from: 'tenant@example.com',
        to: 'member@example.com',
        subject: 'Hi',
        html: '<p>hi</p>',
      }),
    ).rejects.toThrow('No SendGrid API key configured');
  });

  it('throws when SendGrid responds with a non-ok status', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('bad request'),
    });

    await expect(
      provider.sendMail({
        from: 'platform@example.com',
        to: 'member@example.com',
        subject: 'Hi',
        html: '<p>hi</p>',
      }),
    ).rejects.toThrow('SendGrid send failed (400): bad request');
  });
});
