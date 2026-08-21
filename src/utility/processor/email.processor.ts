import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  OnQueueCompleted,
  OnQueueFailed,
  Process,
  Processor,
} from '@nestjs/bull';
import { Job } from 'bull';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { EmailLog, EmailLogSource } from '../entity/email-log.entity';
import { IEmailProvider } from '../email-provider/email-provider.interface';
import { EMAIL_PROVIDER_TOKEN } from '../email-provider/email-provider.token';
import { GmailProvider } from '../email-provider/gmail.provider';
import { ResendProvider } from '../email-provider/resend.provider';
import { SmtpProvider } from '../email-provider/smtp.provider';
import { SendGridProvider } from '../email-provider/sendgrid.provider';
import { MailgunProvider } from '../email-provider/mailgun.provider';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { TenantJobEnvelope } from '../../tenant/utility/job-envelope';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';
import { EmailCredentialResolverService } from '../../communication-provider/service/email-credential-resolver.service';

export interface EmailAttachment {
  filename: string;
  content: string;
  encoding: 'base64';
}

export interface EmailJobData extends TenantJobEnvelope {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
  // Set via job.update() inside handleSend, *before* the send is attempted —
  // not just returned on success. onFailed has no return value to read (the
  // function throws before reaching its `return` statement), so this is the
  // only way it can know which provider/source was actually being attempted
  // when a send fails, rather than guessing.
  resolvedProviderName?: string;
  resolvedSource?: EmailLogSource;
}

// Bull's return-value convention: handleSend's return becomes job.returnvalue,
// readable in onCompleted — the only way to tell onCompleted/onFailed which
// concrete provider actually handled this specific send, since that can vary
// per tenant now (BYOK) and isn't knowable from the processor's own fixed
// EMAIL_PROVIDER_TOKEN default alone.
interface SendResult {
  providerName: string;
  source: EmailLogSource;
}

@Injectable()
@Processor('email')
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);
  private readonly defaultFromAddress: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(EmailLog)
    private readonly emailLogRepository: Repository<EmailLog>,
    @Inject(EMAIL_PROVIDER_TOKEN)
    private readonly defaultEmailProvider: IEmailProvider,
    private readonly gmailProvider: GmailProvider,
    private readonly resendProvider: ResendProvider,
    private readonly smtpProvider: SmtpProvider,
    private readonly sendGridProvider: SendGridProvider,
    private readonly mailgunProvider: MailgunProvider,
    private readonly emailCredentialResolverService: EmailCredentialResolverService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {
    this.defaultFromAddress =
      this.configService.get<string>('EMAIL_FROM') ??
      this.configService.get<string>('EMAIL_USER');
  }

  // Tenant context has to be entered here (not just in onCompleted/onFailed,
  // the pre-BYOK behavior) because resolving a tenant's own BYOK config now
  // has to happen before the send itself, not just before logging it
  // afterward — the genuinely more involved wiring
  // docs/MULTI_TENANT_MIGRATION.md §9 Phase 3 flagged email BYOK as needing,
  // versus SMS which resolves synchronously within the original request.
  @Process('send')
  async handleSend(job: Job<EmailJobData>): Promise<SendResult> {
    return runInTenantContext(this.cls, this.txHost, job.data, async () => {
      const { to, cc, subject, html, attachments } = job.data;
      const config = await this.emailCredentialResolverService.resolveConfig();

      const provider = config
        ? this.resolveProvider(config.providerId)
        : this.defaultEmailProvider;
      const from = config?.senderIdentity || this.defaultFromAddress;
      const source: EmailLogSource = config ? 'tenant' : 'platform_default';

      // Persist before attempting the send — if sendMail throws below, this
      // function never reaches its return statement, so onFailed can only
      // learn which provider/source was being attempted by reading it back
      // off the job itself.
      await job.update({
        ...job.data,
        resolvedProviderName: provider.providerName,
        resolvedSource: source,
      });

      await provider.sendMail(
        { from, to, cc, subject, html, attachments },
        config?.credentials,
      );
      this.logger.debug(
        `Email sent via ${provider.providerName}: "${subject}" to ${Array.isArray(to) ? to.join(', ') : to} (attempt ${job.attemptsMade + 1})`,
      );

      return { providerName: provider.providerName, source };
    });
  }

  // `gmail` is the fallback for any BYOK config whose providerId isn't one
  // of the dedicated REST providers below — this covers `gmail` itself and
  // any legacy/unrecognized providerId, matching the pre-expansion default.
  private resolveProvider(providerId: string): IEmailProvider {
    switch (providerId) {
      case 'resend':
        return this.resendProvider;
      case 'smtp':
        return this.smtpProvider;
      case 'sendgrid':
        return this.sendGridProvider;
      case 'mailgun':
        return this.mailgunProvider;
      default:
        return this.gmailProvider;
    }
  }

  @OnQueueCompleted()
  async onCompleted(
    job: Job<EmailJobData>,
    result: SendResult | undefined,
  ): Promise<void> {
    return runInTenantContext(this.cls, this.txHost, job.data, async () => {
      const { to, subject } = job.data;
      const recipient = Array.isArray(to) ? to.join(', ') : to;
      await this.emailLogRepository.save(
        this.emailLogRepository.create({
          recipient,
          subject,
          status: 'sent',
          jobId: String(job.id),
          provider:
            result?.providerName ??
            job.data.resolvedProviderName ??
            this.defaultEmailProvider.providerName,
          source:
            result?.source ?? job.data.resolvedSource ?? 'platform_default',
          attemptsMade: job.attemptsMade,
        }),
      );
    });
  }

  @OnQueueFailed()
  async onFailed(job: Job<EmailJobData>, error: Error): Promise<void> {
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return; // transient failure — Bull will retry

    return runInTenantContext(this.cls, this.txHost, job.data, async () => {
      const { to, subject } = job.data;
      const recipient = Array.isArray(to) ? to.join(', ') : to;
      this.logger.error(
        `Email permanently failed after ${job.attemptsMade} attempts: "${subject}" to ${recipient} — ${error.message}`,
      );
      // Was previously hardcoded to the platform default's name — wrong
      // whenever the failure happened on the tenant's own BYOK provider.
      // job.data.resolvedProviderName/resolvedSource (set by handleSend via
      // job.update() before it ever attempted the send) is the actual
      // provider that failed; only fall back to the platform default label
      // for the near-never-happens case where resolution itself threw
      // before handleSend reached that update call.
      await this.emailLogRepository.save(
        this.emailLogRepository.create({
          recipient,
          subject,
          status: 'failed',
          jobId: String(job.id),
          provider:
            job.data.resolvedProviderName ??
            this.defaultEmailProvider.providerName,
          source: job.data.resolvedSource ?? 'platform_default',
          errorMessage: error.message,
          attemptsMade: job.attemptsMade,
        }),
      );
    });
  }
}
