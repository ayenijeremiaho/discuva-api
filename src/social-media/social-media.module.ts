import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { SocialAccount } from './entity/social-account.entity';
import { SocialPost } from './entity/social-post.entity';
import { SocialPostTarget } from './entity/social-post-target.entity';
import { SocialPostMedia } from './entity/social-post-media.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { SocialAccountService } from './service/social-account.service';
import { SocialPostService } from './service/social-post.service';
import { SocialOAuthConnectService } from './service/social-oauth-connect.service';
import { SocialPostMediaService } from './service/social-post-media.service';
import { SocialMediaValidationService } from './service/social-media-validation.service';
import { SocialMediaController } from './controller/social-media.controller';
import { SocialOAuthCallbackController } from './controller/social-oauth-callback.controller';
import { NotConnectedPublisher } from './publisher/not-connected-publisher';
import { PlatformDisabledPublisher } from './publisher/platform-disabled-publisher';
import { SocialPublisherRegistry } from './publisher/social-publisher-registry.service';
import { SocialTokenResolverService } from './service/social-token-resolver.service';
import { NoRefresherAvailable } from './token/no-refresher-available';
import { SocialTokenRefresherRegistry } from './token/social-token-refresher-registry.service';
import { OAuthStateService } from './oauth/oauth-state.service';
import { NoExchangerAvailable } from './oauth/no-exchanger-available';
import { SocialOAuthExchangerRegistry } from './oauth/social-oauth-exchanger-registry.service';
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
    TypeOrmModule.forFeature([Tenant]),
    BullModule.registerQueue({ name: 'social-post-publish' }),
    UtilityModule,
  ],
  providers: [
    SocialAccountService,
    SocialPostService,
    SocialOAuthConnectService,
    SocialPostMediaService,
    SocialMediaValidationService,
    NotConnectedPublisher,
    PlatformDisabledPublisher,
    SocialPublisherRegistry,
    SocialTokenResolverService,
    NoRefresherAvailable,
    SocialTokenRefresherRegistry,
    OAuthStateService,
    NoExchangerAvailable,
    SocialOAuthExchangerRegistry,
    SocialPostPublishProcessor,
    SocialMediaRetentionScheduler,
  ],
  controllers: [SocialMediaController, SocialOAuthCallbackController],
  exports: [TenantTypeOrmModule],
})
export class SocialMediaModule {}
