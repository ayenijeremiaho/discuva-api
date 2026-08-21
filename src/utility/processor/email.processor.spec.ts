import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { EmailProcessor } from './email.processor';
import { EmailLog } from '../entity/email-log.entity';
import { EMAIL_PROVIDER_TOKEN } from '../email-provider/email-provider.token';
import { GmailProvider } from '../email-provider/gmail.provider';
import { ResendProvider } from '../email-provider/resend.provider';
import { SmtpProvider } from '../email-provider/smtp.provider';
import { SendGridProvider } from '../email-provider/sendgrid.provider';
import { MailgunProvider } from '../email-provider/mailgun.provider';
import { EmailCredentialResolverService } from '../../communication-provider/service/email-credential-resolver.service';

const mockEmailLogRepo = { create: jest.fn((v) => v), save: jest.fn() };

const mockDefaultProvider = {
  providerName: 'gmail',
  sendMail: jest.fn().mockResolvedValue(undefined),
};
const mockGmailProvider = {
  providerName: 'gmail',
  sendMail: jest.fn().mockResolvedValue(undefined),
};
const mockResendProvider = {
  providerName: 'resend',
  sendMail: jest.fn().mockResolvedValue(undefined),
};
const mockSmtpProvider = {
  providerName: 'smtp',
  sendMail: jest.fn().mockResolvedValue(undefined),
};
const mockSendGridProvider = {
  providerName: 'sendgrid',
  sendMail: jest.fn().mockResolvedValue(undefined),
};
const mockMailgunProvider = {
  providerName: 'mailgun',
  sendMail: jest.fn().mockResolvedValue(undefined),
};

const mockResolver = { resolveConfig: jest.fn() };

// Real runWith/withTransaction set up AsyncLocalStorage + a DB transaction —
// neither is what this spec is testing; just invoking the callback verifies
// tenant context is entered at all before resolving BYOK config, which is
// the thing that's actually new here (same reasoning as the YouTube live
// detection spec's identical mock).
const mockCls = {
  runWith: jest.fn((_store: unknown, fn: () => unknown) => fn()),
};
const mockTxHost = {
  tx: { query: jest.fn() },
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};

function buildJob(data: any, attemptsMade = 0) {
  const job: any = { id: 'job-1', data, attemptsMade, opts: { attempts: 3 } };
  // Real Bull mutates job.data in place (and persists to Redis) on update —
  // mirrored here so a later onFailed/onCompleted read of job.data sees
  // whatever handleSend resolved, same as production.
  job.update = jest.fn((newData: any) => {
    job.data = newData;
    return Promise.resolve();
  });
  return job;
}

describe('EmailProcessor', () => {
  let processor: EmailProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCls.runWith.mockImplementation((_store: unknown, fn: () => unknown) =>
      fn(),
    );
    mockTxHost.withTransaction.mockImplementation((fn: () => unknown) => fn());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailProcessor,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'EMAIL_FROM' ? 'platform@example.com' : undefined,
            ),
          },
        },
        { provide: getRepositoryToken(EmailLog), useValue: mockEmailLogRepo },
        { provide: EMAIL_PROVIDER_TOKEN, useValue: mockDefaultProvider },
        { provide: GmailProvider, useValue: mockGmailProvider },
        { provide: ResendProvider, useValue: mockResendProvider },
        { provide: SmtpProvider, useValue: mockSmtpProvider },
        { provide: SendGridProvider, useValue: mockSendGridProvider },
        { provide: MailgunProvider, useValue: mockMailgunProvider },
        { provide: EmailCredentialResolverService, useValue: mockResolver },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
      ],
    }).compile();
    processor = module.get(EmailProcessor);
  });

  describe('handleSend', () => {
    it('uses the platform default provider and from-address when the tenant has no BYOK config', async () => {
      mockResolver.resolveConfig.mockResolvedValue(undefined);
      const job = buildJob({
        to: 'member@example.com',
        subject: 'Hi',
        html: '<p>hi</p>',
        tenantId: 'tenant-1',
        schemaName: 'church_test',
      });

      const result = await processor.handleSend(job);

      expect(mockDefaultProvider.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'platform@example.com' }),
        undefined,
      );
      expect(result).toEqual({
        providerName: 'gmail',
        source: 'platform_default',
      });
      expect(job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          resolvedProviderName: 'gmail',
          resolvedSource: 'platform_default',
        }),
      );
    });

    it('routes to GmailProvider with the tenant BYOK credentials and senderIdentity as from', async () => {
      mockResolver.resolveConfig.mockResolvedValue({
        providerId: 'gmail',
        credentials: { user: 'tenant@example.com', password: 'pass' },
        senderIdentity: 'tenant@example.com',
      });
      const job = buildJob({
        to: 'member@example.com',
        subject: 'Hi',
        html: '<p>hi</p>',
      });

      const result = await processor.handleSend(job);

      expect(mockGmailProvider.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'tenant@example.com' }),
        { user: 'tenant@example.com', password: 'pass' },
      );
      expect(mockDefaultProvider.sendMail).not.toHaveBeenCalled();
      expect(result).toEqual({ providerName: 'gmail', source: 'tenant' });
    });

    it('routes to ResendProvider when the tenant BYOK provider is resend', async () => {
      mockResolver.resolveConfig.mockResolvedValue({
        providerId: 'resend',
        credentials: { apiKey: 'tenant-key' },
        senderIdentity: null,
      });
      const job = buildJob({
        to: 'member@example.com',
        subject: 'Hi',
        html: '<p>hi</p>',
      });

      const result = await processor.handleSend(job);

      expect(mockResendProvider.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'platform@example.com' }), // no senderIdentity -> falls back
        { apiKey: 'tenant-key' },
      );
      expect(result).toEqual({ providerName: 'resend', source: 'tenant' });
    });

    it('routes to SmtpProvider when the tenant BYOK provider is smtp', async () => {
      mockResolver.resolveConfig.mockResolvedValue({
        providerId: 'smtp',
        credentials: {
          host: 'mail.tenantchurch.org',
          user: 'a',
          password: 'b',
        },
        senderIdentity: 'tenant@example.com',
      });
      const job = buildJob({
        to: 'member@example.com',
        subject: 'Hi',
        html: '<p>hi</p>',
      });

      const result = await processor.handleSend(job);

      expect(mockSmtpProvider.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'tenant@example.com' }),
        { host: 'mail.tenantchurch.org', user: 'a', password: 'b' },
      );
      expect(result).toEqual({ providerName: 'smtp', source: 'tenant' });
    });

    it('routes to SendGridProvider when the tenant BYOK provider is sendgrid', async () => {
      mockResolver.resolveConfig.mockResolvedValue({
        providerId: 'sendgrid',
        credentials: { apiKey: 'tenant-key' },
        senderIdentity: 'tenant@example.com',
      });
      const job = buildJob({
        to: 'member@example.com',
        subject: 'Hi',
        html: '<p>hi</p>',
      });

      const result = await processor.handleSend(job);

      expect(mockSendGridProvider.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'tenant@example.com' }),
        { apiKey: 'tenant-key' },
      );
      expect(result).toEqual({ providerName: 'sendgrid', source: 'tenant' });
    });

    it('routes to MailgunProvider when the tenant BYOK provider is mailgun', async () => {
      mockResolver.resolveConfig.mockResolvedValue({
        providerId: 'mailgun',
        credentials: { apiKey: 'tenant-key', domain: 'mg.tenantchurch.org' },
        senderIdentity: 'tenant@example.com',
      });
      const job = buildJob({
        to: 'member@example.com',
        subject: 'Hi',
        html: '<p>hi</p>',
      });

      const result = await processor.handleSend(job);

      expect(mockMailgunProvider.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'tenant@example.com' }),
        { apiKey: 'tenant-key', domain: 'mg.tenantchurch.org' },
      );
      expect(result).toEqual({ providerName: 'mailgun', source: 'tenant' });
    });
  });

  describe('onCompleted', () => {
    it('logs using the provider and source actually used for this send, not the platform default', async () => {
      const job = buildJob({ to: 'member@example.com', subject: 'Hi' });
      await processor.onCompleted(job, {
        providerName: 'resend',
        source: 'tenant',
      });

      expect(mockEmailLogRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'sent',
          provider: 'resend',
          source: 'tenant',
        }),
      );
    });

    it('falls back to job.data.resolvedProviderName/resolvedSource when no return value is present', async () => {
      const job = buildJob({
        to: 'member@example.com',
        subject: 'Hi',
        resolvedProviderName: 'smtp',
        resolvedSource: 'tenant',
      });
      await processor.onCompleted(job, undefined);

      expect(mockEmailLogRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'smtp', source: 'tenant' }),
      );
    });

    it('falls back to the platform default when neither a return value nor job.data has resolution info', async () => {
      const job = buildJob({ to: 'member@example.com', subject: 'Hi' });
      await processor.onCompleted(job, undefined);

      expect(mockEmailLogRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gmail',
          source: 'platform_default',
        }),
      );
    });
  });

  describe('onFailed', () => {
    it('logs a failure only once max attempts are exhausted', async () => {
      const job = buildJob(
        { to: 'member@example.com', subject: 'Hi' },
        1, // attemptsMade < opts.attempts (3) -> Bull will retry
      );
      await processor.onFailed(job, new Error('smtp down'));
      expect(mockEmailLogRepo.save).not.toHaveBeenCalled();
    });

    it('logs a permanent failure once attemptsMade reaches the max', async () => {
      const job = buildJob({ to: 'member@example.com', subject: 'Hi' }, 3);
      await processor.onFailed(job, new Error('smtp down'));
      expect(mockEmailLogRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          errorMessage: 'smtp down',
        }),
      );
    });

    // Regression test for the real bug this fixes: a failure on the
    // tenant's own BYOK provider used to be logged with the platform
    // default's name instead, since onFailed had no way to know which
    // provider handleSend had actually resolved.
    it('logs the tenant BYOK provider that actually failed, not the platform default', async () => {
      const job = buildJob(
        {
          to: 'member@example.com',
          subject: 'Hi',
          resolvedProviderName: 'sendgrid',
          resolvedSource: 'tenant',
        },
        3,
      );
      await processor.onFailed(job, new Error('sendgrid rejected'));

      expect(mockEmailLogRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          provider: 'sendgrid',
          source: 'tenant',
        }),
      );
    });

    it('falls back to the platform default label only when job.data has no resolution info at all', async () => {
      const job = buildJob({ to: 'member@example.com', subject: 'Hi' }, 3);
      await processor.onFailed(job, new Error('boom'));

      expect(mockEmailLogRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gmail',
          source: 'platform_default',
        }),
      );
    });

    it('end-to-end: handleSend resolving a tenant BYOK provider, then failing, logs that provider — not the platform default', async () => {
      mockResolver.resolveConfig.mockResolvedValue({
        providerId: 'resend',
        credentials: { apiKey: 'tenant-key' },
        senderIdentity: 'tenant@example.com',
      });
      mockResendProvider.sendMail.mockRejectedValueOnce(
        new Error('resend down'),
      );
      const job = buildJob(
        { to: 'member@example.com', subject: 'Hi', html: '<p>hi</p>' },
        3,
      );

      await expect(processor.handleSend(job)).rejects.toThrow('resend down');
      await processor.onFailed(job, new Error('resend down'));

      expect(mockEmailLogRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          provider: 'resend',
          source: 'tenant',
        }),
      );
    });
  });
});
