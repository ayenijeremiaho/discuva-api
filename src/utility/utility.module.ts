import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UtilityService } from './service/utility.service';
import { DateService } from './service/date.service';
import { CacheService } from './service/cache.service';
import { SanitizationService } from './service/sanitization.service';
import { EmailQueueService } from './service/email-queue.service';
import { NotificationDispatchService } from './service/notification-dispatch.service';
import { AuditLogService } from './service/audit-log.service';
import { EmailLogService } from './service/email-log.service';
import { AuditLog } from './entity/audit-log.entity';
import { EmailLog } from './entity/email-log.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { UtilityController } from './controller/utility.controller';
import { AuditLogController } from './controller/audit-log.controller';
import { EmailLogController } from './controller/email-log.controller';
import { EmailProcessor } from './processor/email.processor';
import { AuditLogProcessor } from './processor/audit-log.processor';
import { CloudinaryService } from './service/cloudinary.service';
import { PdfService } from './service/pdf.service';
import { TenantCurrencyService } from './service/tenant-currency.service';
import { ExcelService } from './service/excel.service';
import { EncryptionService } from './service/encryption.service';
import { EMAIL_PROVIDER_TOKEN } from './email-provider/email-provider.token';
import { GmailProvider } from './email-provider/gmail.provider';
import { ResendProvider } from './email-provider/resend.provider';
import { SmtpProvider } from './email-provider/smtp.provider';
import { SendGridProvider } from './email-provider/sendgrid.provider';
import { MailgunProvider } from './email-provider/mailgun.provider';
import { IEmailProvider } from './email-provider/email-provider.interface';
import { CommunicationProviderModule } from '../communication-provider/communication-provider.module';

// Global — CacheService (and friends) are cross-cutting utilities other
// modules' guards/interceptors need without an explicit import path, the
// same reason AdminModule and BillingModule are Global. Nest resolves a
// guard's constructor dependencies using the *consuming* controller's
// module, not the guard's own declaring module (docs/MULTI_TENANT_MIGRATION.md
// §4.11's PlanGuard is the concrete case that surfaced this).
@Global()
@Module({
  imports: [
    ConfigModule,
    TenantTypeOrmModule.forFeature([AuditLog, EmailLog]),
    // Tenant is a public-schema, control-plane entity (like Plan/Subscription
    // in BillingModule) — plain TypeOrmModule.forFeature, no TenantTypeOrmModule
    // needed. EmailQueueService reads it to resolve per-tenant email branding.
    TypeOrmModule.forFeature([Tenant]),
    BullModule.registerQueue({ name: 'email' }),
    BullModule.registerQueue({ name: 'audit-log' }),
    // EmailProcessor resolves a tenant's own BYOK email provider via
    // EmailCredentialResolverService — see its own module for why this
    // edge is safely one-directional (CommunicationProviderModule doesn't
    // import UtilityModule back).
    CommunicationProviderModule,
  ],
  providers: [
    GmailProvider,
    ResendProvider,
    SmtpProvider,
    SendGridProvider,
    MailgunProvider,
    // The platform-default IEmailProvider, chosen once at boot — reuses the
    // same DI-managed GmailProvider/ResendProvider instances below rather
    // than constructing fresh ones, so there's exactly one live
    // nodemailer transporter / Resend client of each kind at runtime.
    {
      provide: EMAIL_PROVIDER_TOKEN,
      useFactory: (
        config: ConfigService,
        gmailProvider: GmailProvider,
        resendProvider: ResendProvider,
      ): IEmailProvider => {
        const provider = config.get<string>('EMAIL_PROVIDER') ?? 'gmail';
        return provider === 'resend' ? resendProvider : gmailProvider;
      },
      inject: [ConfigService, GmailProvider, ResendProvider],
    },
    UtilityService,
    DateService,
    CacheService,
    SanitizationService,
    EmailQueueService,
    AuditLogService,
    EmailLogService,
    EmailProcessor,
    AuditLogProcessor,
    CloudinaryService,
    PdfService,
    TenantCurrencyService,
    ExcelService,
    EncryptionService,
    NotificationDispatchService,
  ],
  controllers: [UtilityController, AuditLogController, EmailLogController],
  exports: [
    UtilityService,
    DateService,
    CacheService,
    SanitizationService,
    EmailQueueService,
    AuditLogService,
    CloudinaryService,
    PdfService,
    TenantCurrencyService,
    ExcelService,
    EncryptionService,
    NotificationDispatchService,
  ],
})
export class UtilityModule {}
