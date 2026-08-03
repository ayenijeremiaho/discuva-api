import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { ResendProvider } from './resend.provider';

jest.mock('resend');

const mockSend = jest.fn().mockResolvedValue({ error: null });

describe('ResendProvider', () => {
  let provider: ResendProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    (Resend as jest.Mock).mockImplementation(() => ({
      emails: { send: mockSend },
    }));
    const mockConfig = {
      get: jest.fn((key: string) =>
        key === 'RESEND_API_KEY' ? 'platform-key' : undefined,
      ),
    } as unknown as ConfigService;
    provider = new ResendProvider(mockConfig);
  });

  it('sends using the constructor-built default client when no credentials are given', async () => {
    await provider.sendMail({
      from: 'platform@example.com',
      to: 'member@example.com',
      subject: 'Hi',
      html: '<p>hi</p>',
    });

    expect(Resend).toHaveBeenCalledTimes(1);
    expect(Resend).toHaveBeenCalledWith('platform-key');
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'platform@example.com' }),
    );
  });

  it('builds a fresh client with the tenant BYOK api key when given', async () => {
    await provider.sendMail(
      {
        from: 'tenant@example.com',
        to: 'member@example.com',
        subject: 'Hi',
        html: '<p>hi</p>',
      },
      { apiKey: 'tenant-key' },
    );

    expect(Resend).toHaveBeenCalledTimes(2); // constructor + this call
    expect(Resend).toHaveBeenLastCalledWith('tenant-key');
  });

  it('throws when Resend returns an error', async () => {
    mockSend.mockResolvedValueOnce({ error: { message: 'bad request' } });
    await expect(
      provider.sendMail({
        from: 'platform@example.com',
        to: 'member@example.com',
        subject: 'Hi',
        html: '<p>hi</p>',
      }),
    ).rejects.toThrow('bad request');
  });
});
