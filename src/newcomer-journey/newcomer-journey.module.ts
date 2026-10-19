import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { ChurchSetting } from '../church-settings/entity/church-setting.entity';
import { JourneyService } from './service/journey.service';
import {
  JourneyAdminController,
  JourneyController,
} from './controller/journey.controller';

@Module({
  imports: [TenantTypeOrmModule.forFeature([ChurchSetting])],
  providers: [JourneyService],
  controllers: [JourneyController, JourneyAdminController],
})
export class NewcomerJourneyModule {}
