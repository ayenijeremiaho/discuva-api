import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { GmailProvider } from './gmail.provider';

jest.mock('nodemailer');

const mockSendMail = jest.fn().mockResolvedValue(undefined);

describe('GmailProvider', () => {
  let provider: GmailProvider;
  let mockConfig: ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: mockSendMail,
    });
    mockConfig = {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          EMAIL_HOST: 'smtp.gmail.com',
          EMAIL_PORT: 465,
          EMAIL_SECURE: true,
          EMAIL_SERVICE: 'gmail',
          EMAIL_USER: 'platform@example.com',
          EMAIL_PASSWORD: 'platform-pass',
        };
        return values[key];
      }),
    } as any;
    provider = new GmailProvider(mockConfig);
  });

  it('sends using the constructor-built default transporter when no credentials are given', async () => {
    await provider.sendMail({
      from: 'platform@example.com',
      to: 'member@example.com',
      subject: 'Hi',
      html: '<p>hi</p>',
    });

    // One createTransport call at construction time; sendMail reuses it.
    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'platform@example.com' }),
    );
  });

  it('builds a fresh transporter with the tenant BYOK credentials when given', async () => {
    await provider.sendMail(
      {
        from: 'tenant@example.com',
        to: 'member@example.com',
        subject: 'Hi',
        html: '<p>hi</p>',
      },
      { user: 'tenant@example.com', password: 'tenant-pass' },
    );

    expect(nodemailer.createTransport).toHaveBeenCalledTimes(2); // constructor + this call
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        auth: { user: 'tenant@example.com', pass: 'tenant-pass' },
      }),
    );
  });

  it('falls back to the platform host/port/secure when BYOK credentials omit them', async () => {
    await provider.sendMail(
      {
        from: 'tenant@example.com',
        to: 'member@example.com',
        subject: 'Hi',
        html: '<p>hi</p>',
      },
      { user: 'tenant@example.com', password: 'tenant-pass' },
    );

    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        service: 'gmail',
      }),
    );
  });

  it('routes to a tenant-supplied custom host and drops the gmail service preset', async () => {
    await provider.sendMail(
      {
        from: 'tenant@example.com',
        to: 'member@example.com',
        subject: 'Hi',
        html: '<p>hi</p>',
      },
      {
        host: 'smtp.office365.com',
        port: '587',
        secure: 'false',
        user: 'tenant@office365.com',
        password: 'tenant-pass',
      },
    );

    expect(nodemailer.createTransport).toHaveBeenLastCalledWith({
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
      service: undefined,
      auth: { user: 'tenant@office365.com', pass: 'tenant-pass' },
    });
  });
});
