import { Global, Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { NotificationTemplateOverride } from './entity/notification-template-override.entity';
import { NotificationTemplateService } from './service/notification-template.service';
import { NotificationTemplateController } from './controller/notification-template.controller';

// Global so PushNotificationService can resolve church wording without an import cycle.
@Global()
@Module({
  imports: [TenantTypeOrmModule.forFeature([NotificationTemplateOverride])],
  providers: [NotificationTemplateService],
  controllers: [NotificationTemplateController],
  exports: [NotificationTemplateService],
})
export class NotificationCatalogueModule {}
