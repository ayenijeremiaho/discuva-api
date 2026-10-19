import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Member } from '../member/entity/member.entity';
import { NotificationPreferencesService } from './service/notification-preferences.service';
import { NotificationPreferencesController } from './controller/notification-preferences.controller';

@Module({
  imports: [TenantTypeOrmModule.forFeature([Member])],
  providers: [NotificationPreferencesService],
  controllers: [NotificationPreferencesController],
})
export class NotificationPreferencesModule {}
