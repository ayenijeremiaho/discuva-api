import { Injectable } from '@nestjs/common';
import {
  PublishResult,
  SocialPlatformPublisher,
} from './social-platform-publisher.interface';
import { SocialAccount } from '../entity/social-account.entity';
import { SocialPost } from '../entity/social-post.entity';

// Distinct from NotConnectedPublisher's "this church never set this up"
// message — this one only applies when a platform-admin has explicitly
// flipped SocialPlatformApp.isActive to false for the platform, e.g. an
// upstream API change or policy issue on Discuva's side, not anything the
// tenant did or needs to fix.
@Injectable()
export class PlatformDisabledPublisher implements SocialPlatformPublisher {
  async publish(account: SocialAccount): Promise<PublishResult> {
    return {
      success: false,
      error: `${account.platform} publishing is temporarily disabled by Discuva — this isn't something you need to fix on your end.`,
    };
  }
}
