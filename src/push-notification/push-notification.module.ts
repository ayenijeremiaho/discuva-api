import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { PushSubscription } from './entity/push-subscription.entity';
import { WorkerProfile } from '../member/entity/worker-profile.entity';
import { PushNotificationService } from './service/push-notification.service';
import { PushNotificationProcessor } from './processor/push-notification.processor';
import { PushNotificationController } from './controller/push-notification.controller';
import { UtilityModule } from '../utility/utility.module';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([PushSubscription, WorkerProfile]),
    BullModule.registerQueue({ name: 'push-notifications' }),
    UtilityModule,
  ],
  providers: [PushNotificationService, PushNotificationProcessor],
  controllers: [PushNotificationController],
  exports: [PushNotificationService],
})
export class PushNotificationModule {}
