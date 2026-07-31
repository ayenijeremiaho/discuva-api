import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../../tenant/utility/tenant-typeorm.module';
import { YoutubeIntegrationState } from './entity/youtube-integration-state.entity';
import { YoutubeSubscriptionService } from './service/youtube-subscription.service';
import { YoutubeLiveDetectionService } from './service/youtube-live-detection.service';
import { YoutubeSubscriptionScheduler } from './scheduler/youtube-subscription.scheduler';
import { YoutubeWebhookController } from './controller/youtube-webhook.controller';
import { AnnouncementModule } from '../../announcement/announcement.module';
import { UtilityModule } from '../../utility/utility.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([YoutubeIntegrationState]),
    AnnouncementModule,
    UtilityModule,
  ],
  providers: [
    YoutubeSubscriptionService,
    YoutubeLiveDetectionService,
    YoutubeSubscriptionScheduler,
  ],
  controllers: [YoutubeWebhookController],
})
export class YoutubeModule {}
