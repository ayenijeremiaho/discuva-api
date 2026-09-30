import { Global, Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { NotificationTemplateOverride } from './entity/notification-template-override.entity';
import { NotificationTemplateVersion } from './entity/notification-template-version.entity';
import { NotificationTemplateService } from './service/notification-template.service';
import { NotificationRecipientService } from './service/notification-recipient.service';
import { NotificationTemplateController } from './controller/notification-template.controller';

// Global so PushNotificationService can resolve church wording without an import cycle.
@Global()
@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      NotificationTemplateOverride,
      NotificationTemplateVersion,
    ]),
  ],
  providers: [NotificationTemplateService, NotificationRecipientService],
  controllers: [NotificationTemplateController],
  exports: [NotificationTemplateService, NotificationRecipientService],
})
export class NotificationCatalogueModule {}
