import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { UtilityService } from './service/utility.service';
import { DateService } from './service/date.service';
import { CacheService } from './service/cache.service';
import { SanitizationService } from './service/sanitization.service';
import { EmailQueueService } from './service/email-queue.service';
import { AuditLogService } from './service/audit-log.service';
import { EmailLogService } from './service/email-log.service';
import { AuditLog } from './entity/audit-log.entity';
import { EmailLog } from './entity/email-log.entity';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { UtilityController } from './controller/utility.controller';
import { AuditLogController } from './controller/audit-log.controller';
import { EmailLogController } from './controller/email-log.controller';
import { EmailProcessor } from './processor/email.processor';
import { AuditLogProcessor } from './processor/audit-log.processor';
import { CloudinaryService } from './service/cloudinary.service';
import { PdfService } from './service/pdf.service';
import { ExcelService } from './service/excel.service';
import { EMAIL_PROVIDER_TOKEN } from './email-provider/email-provider.token';
import { GmailProvider } from './email-provider/gmail.provider';
import { ResendProvider } from './email-provider/resend.provider';
import { IEmailProvider } from './email-provider/email-provider.interface';

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
    BullModule.registerQueue({ name: 'email' }),
    BullModule.registerQueue({ name: 'audit-log' }),
  ],
  providers: [
    {
      provide: EMAIL_PROVIDER_TOKEN,
      useFactory: (config: ConfigService): IEmailProvider => {
        const provider = config.get<string>('EMAIL_PROVIDER') ?? 'gmail';
        if (provider === 'resend') return new ResendProvider(config);
        return new GmailProvider(config);
      },
      inject: [ConfigService],
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
    ExcelService,
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
    ExcelService,
  ],
})
export class UtilityModule {}
