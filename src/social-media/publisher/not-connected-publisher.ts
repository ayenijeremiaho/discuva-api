import { Injectable } from '@nestjs/common';
import {
  PublishResult,
  SocialPlatformPublisher,
} from './social-platform-publisher.interface';
import { SocialAccount } from '../entity/social-account.entity';
import { SocialPost } from '../entity/social-post.entity';

// The default publisher for every platform until a real one is registered.
// Never silently pretends to succeed — every target's outcome must be
// honest, since an admin acting on a false "published" status could think
// their announcement actually reached the church's audience when it didn't.
@Injectable()
export class NotConnectedPublisher implements SocialPlatformPublisher {
  async publish(account: SocialAccount): Promise<PublishResult> {
    return {
      success: false,
      error: `${account.platform} isn't connected yet — this church hasn't completed that platform's setup.`,
    };
  }
}
