import { Global, Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { ChurchSetting } from '../church-settings/entity/church-setting.entity';
import { EmailCategorySettingsService } from './service/email-category-settings.service';
import { EmailCategorySettingsController } from './controller/email-category-settings.controller';

// Global, and deliberately does NOT import UtilityModule (also Global) —
// EmailQueueService lives inside UtilityModule and needs to inject
// EmailCategorySettingsService, so an explicit cross-import here would be
// circular. CacheService/AuditLogService still resolve into this module's
// own providers regardless, since UtilityModule's exports are global too.
@Global()
@Module({
  imports: [TenantTypeOrmModule.forFeature([ChurchSetting])],
  providers: [EmailCategorySettingsService],
  controllers: [EmailCategorySettingsController],
  exports: [EmailCategorySettingsService],
})
export class EmailCategorySettingsModule {}
