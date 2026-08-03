import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantYoutubeIntegration } from './entity/tenant-youtube-integration.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { YoutubeSubscriptionService } from './service/youtube-subscription.service';
import { YoutubeLiveDetectionService } from './service/youtube-live-detection.service';
import { TenantYoutubeIntegrationService } from './service/tenant-youtube-integration.service';
import { YoutubeSubscriptionScheduler } from './scheduler/youtube-subscription.scheduler';
import { YoutubeWebhookController } from './controller/youtube-webhook.controller';
import { YoutubeIntegrationController } from './controller/youtube-integration.controller';
import { AnnouncementModule } from '../../announcement/announcement.module';
import { UtilityModule } from '../../utility/utility.module';

// TenantYoutubeIntegration is control-plane (public, never a search_path
// target — see the entity's own doc comment for why), so plain
// TypeOrmModule.forFeature is correct here, not TenantTypeOrmModule. Tenant
// is re-imported here (not re-exported by TenantModule) for the same
// reason TenantMiddleware needs its own Repository<Tenant> — NestJS
// resolves a provider's constructor dependencies using the module that
// declares the provider, not wherever the entity itself "lives".
@Module({
  imports: [
    TypeOrmModule.forFeature([TenantYoutubeIntegration, Tenant]),
    AnnouncementModule,
    UtilityModule,
  ],
  providers: [
    YoutubeSubscriptionService,
    YoutubeLiveDetectionService,
    TenantYoutubeIntegrationService,
    YoutubeSubscriptionScheduler,
  ],
  controllers: [YoutubeWebhookController, YoutubeIntegrationController],
})
export class YoutubeModule {}
