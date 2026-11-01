import { Module } from '@nestjs/common';
import { CommunicationProviderModule } from '../communication-provider/communication-provider.module';
import { SmsModule } from '../sms/sms.module';
import { NotificationCentreController } from './notification-centre.controller';
import { NotificationCentreService } from './notification-centre.service';

@Module({
  imports: [SmsModule, CommunicationProviderModule],
  controllers: [NotificationCentreController],
  providers: [NotificationCentreService],
})
export class NotificationCentreModule {}
