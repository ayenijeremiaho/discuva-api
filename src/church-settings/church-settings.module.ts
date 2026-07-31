import { Global, Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { ChurchSetting } from './entity/church-setting.entity';
import { ChurchSettingsService } from './service/church-settings.service';
import {
  ChurchSettingsController,
  ModuleStateController,
} from './controller/church-settings.controller';
import { ModuleEnabledGuard } from './guard/module-enabled.guard';
import { UtilityModule } from '../utility/utility.module';

@Global()
@Module({
  imports: [TenantTypeOrmModule.forFeature([ChurchSetting]), UtilityModule],
  providers: [ChurchSettingsService, ModuleEnabledGuard],
  controllers: [ChurchSettingsController, ModuleStateController],
  exports: [ChurchSettingsService, ModuleEnabledGuard],
})
export class ChurchSettingsModule {}
