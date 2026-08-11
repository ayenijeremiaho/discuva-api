import { Global, Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { ChurchSetting } from '../church-settings/entity/church-setting.entity';
import { ReminderSettingsService } from './service/reminder-settings.service';
import { ReminderSettingsController } from './controller/reminder-settings.controller';
import { UtilityModule } from '../utility/utility.module';

@Global()
@Module({
  imports: [TenantTypeOrmModule.forFeature([ChurchSetting]), UtilityModule],
  providers: [ReminderSettingsService],
  controllers: [ReminderSettingsController],
  exports: [ReminderSettingsService],
})
export class ReminderSettingsModule {}
