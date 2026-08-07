import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { SocialAccount } from './entity/social-account.entity';
import { SocialPost } from './entity/social-post.entity';
import { SocialPostTarget } from './entity/social-post-target.entity';
import { SocialAccountService } from './service/social-account.service';
import { SocialPostService } from './service/social-post.service';
import { SocialMediaController } from './controller/social-media.controller';
import { NotConnectedPublisher } from './publisher/not-connected-publisher';
import { SocialPublisherRegistry } from './publisher/social-publisher-registry.service';
import { UtilityModule } from '../utility/utility.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      SocialAccount,
      SocialPost,
      SocialPostTarget,
    ]),
    UtilityModule,
  ],
  providers: [
    SocialAccountService,
    SocialPostService,
    NotConnectedPublisher,
    SocialPublisherRegistry,
  ],
  controllers: [SocialMediaController],
  exports: [TenantTypeOrmModule],
})
export class SocialMediaModule {}
