import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { SocialAccount } from './entity/social-account.entity';
import { SocialPost } from './entity/social-post.entity';
import { SocialPostTarget } from './entity/social-post-target.entity';
import { SocialPostMedia } from './entity/social-post-media.entity';
import { SocialDataDeletionRequest } from './entity/social-data-deletion-request.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { SocialAccountService } from './service/social-account.service';
import { SocialPostService } from './service/social-post.service';
import { SocialOAuthConnectService } from './service/social-oauth-connect.service';
import { SocialPostMediaService } from './service/social-post-media.service';
import { SocialMediaValidationService } from './service/social-media-validation.service';
import { SocialMediaCropService } from './service/social-media-crop.service';
import { SocialMediaController } from './controller/social-media.controller';
import { SocialOAuthCallbackController } from './controller/social-oauth-callback.controller';
import { MetaDataDeletionController } from './controller/meta-data-deletion.controller';
import { MetaDataDeletionService } from './service/meta-data-deletion.service';
import { NotConnectedPublisher } from './publisher/not-connected-publisher';
import { PlatformDisabledPublisher } from './publisher/platform-disabled-publisher';
import { FacebookGraphPublisher } from './publisher/facebook-graph-publisher';
import { InstagramGraphPublisher } from './publisher/instagram-graph-publisher';
import { YouTubePublisher } from './publisher/youtube-publisher';
import { SocialPublisherRegistry } from './publisher/social-publisher-registry.service';
import { NoStatsAvailable } from './stats/no-stats-available';
import { YouTubeStatsFetcher } from './stats/youtube-stats-fetcher';
import { SocialStatsFetcherRegistry } from './stats/social-stats-fetcher-registry.service';
import { SocialTokenResolverService } from './service/social-token-resolver.service';
import { NoRefresherAvailable } from './token/no-refresher-available';
import { YouTubeTokenRefresher } from './token/youtube-token-refresher';
import { SocialTokenRefresherRegistry } from './token/social-token-refresher-registry.service';
import { OAuthStateService } from './oauth/oauth-state.service';
import { NoExchangerAvailable } from './oauth/no-exchanger-available';
import { FacebookOAuthExchanger } from './oauth/facebook-oauth-exchanger';
import { InstagramOAuthExchanger } from './oauth/instagram-oauth-exchanger';
import { YouTubeOAuthExchanger } from './oauth/youtube-oauth-exchanger';
import { SocialOAuthExchangerRegistry } from './oauth/social-oauth-exchanger-registry.service';
import { MetaGraphApiService } from './platform/meta/meta-graph-api.service';
import { YouTubeApiService } from './platform/youtube/youtube-api.service';
import { SocialPostPublishProcessor } from './processor/social-post-publish.processor';
import { SocialMediaRetentionScheduler } from './scheduler/social-media-retention.scheduler';
import { UtilityModule } from '../utility/utility.module';

// Tenant.id/schemaName lookup has to happen via a plain TypeOrmModule
// (public schema) alongside the tenant-scoped entities — the OAuth callback
// route has no tenant context until SocialOAuthConnectService resolves one
// itself from `state` and enters it via runInTenantContext, same reasoning
// GivingCheckoutModule documents for its own webhook + Tenant registration.
@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      SocialAccount,
      SocialPost,
      SocialPostTarget,
      SocialPostMedia,
    ]),
    TypeOrmModule.forFeature([Tenant, SocialDataDeletionRequest]),
    BullModule.registerQueue({ name: 'social-post-publish' }),
    UtilityModule,
  ],
  providers: [
    SocialAccountService,
    SocialPostService,
    SocialOAuthConnectService,
    SocialPostMediaService,
    SocialMediaValidationService,
    SocialMediaCropService,
    NotConnectedPublisher,
    PlatformDisabledPublisher,
    FacebookGraphPublisher,
    InstagramGraphPublisher,
    YouTubePublisher,
    SocialPublisherRegistry,
    NoStatsAvailable,
    YouTubeStatsFetcher,
    SocialStatsFetcherRegistry,
    SocialTokenResolverService,
    NoRefresherAvailable,
    YouTubeTokenRefresher,
    SocialTokenRefresherRegistry,
    OAuthStateService,
    NoExchangerAvailable,
    FacebookOAuthExchanger,
    InstagramOAuthExchanger,
    YouTubeOAuthExchanger,
    SocialOAuthExchangerRegistry,
    MetaGraphApiService,
    YouTubeApiService,
    SocialPostPublishProcessor,
    SocialMediaRetentionScheduler,
    MetaDataDeletionService,
  ],
  controllers: [
    SocialMediaController,
    SocialOAuthCallbackController,
    MetaDataDeletionController,
  ],
  exports: [TenantTypeOrmModule],
})
export class SocialMediaModule {}
