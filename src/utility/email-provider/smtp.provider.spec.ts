import * as nodemailer from 'nodemailer';
import { SmtpProvider } from './smtp.provider';

jest.mock('nodemailer');

const mockSendMail = jest.fn().mockResolvedValue(undefined);

describe('SmtpProvider', () => {
  let provider: SmtpProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: mockSendMail,
    });
    provider = new SmtpProvider();
  });

  it('throws when called without credentials', async () => {
    await expect(
      provider.sendMail({
        from: 'tenant@example.com',
        to: 'member@example.com',
        subject: 'Hi',
        html: '<p>hi</p>',
      }),
    ).rejects.toThrow(
      'The smtp provider requires host, user, and password credentials',
    );
  });

  it('throws when credentials are missing host/user/password', async () => {
    await expect(
      provider.sendMail(
        {
          from: 'tenant@example.com',
          to: 'member@example.com',
          subject: 'Hi',
          html: '<p>hi</p>',
        },
        { user: 'tenant@example.com' },
      ),
    ).rejects.toThrow(
      'The smtp provider requires host, user, and password credentials',
    );
  });

  it('builds a transporter from full BYOK credentials and sends', async () => {
    await provider.sendMail(
      {
        from: 'tenant@example.com',
        to: 'member@example.com',
        subject: 'Hi',
        html: '<p>hi</p>',
      },
      {
        host: 'mail.tenantchurch.org',
        port: '2525',
        secure: 'true',
        user: 'tenant@example.com',
        password: 'tenant-pass',
      },
    );

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'mail.tenantchurch.org',
      port: 2525,
      secure: true,
      auth: { user: 'tenant@example.com', pass: 'tenant-pass' },
    });
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'tenant@example.com' }),
    );
  });

  it('defaults port to 587 and secure to false when not supplied', async () => {
    await provider.sendMail(
      {
        from: 'tenant@example.com',
        to: 'member@example.com',
        subject: 'Hi',
        html: '<p>hi</p>',
      },
      {
        host: 'mail.tenantchurch.org',
        user: 'tenant@example.com',
        password: 'tenant-pass',
      },
    );

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: false }),
    );
  });
});
