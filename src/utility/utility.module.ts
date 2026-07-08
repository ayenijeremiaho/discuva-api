import { Module } from '@nestjs/common';
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
import { TypeOrmModule } from '@nestjs/typeorm';
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

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([AuditLog, EmailLog]),
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
