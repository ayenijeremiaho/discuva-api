import { PlatformDisabledPublisher } from './platform-disabled-publisher';
import { SocialAccount } from '../entity/social-account.entity';
import { SocialPlatform } from '../enum/social-media.enum';

describe('PlatformDisabledPublisher', () => {
  it('always reports failure, distinct wording from NotConnectedPublisher', async () => {
    const publisher = new PlatformDisabledPublisher();

    const result = await publisher.publish({
      platform: SocialPlatform.YOUTUBE,
    } as SocialAccount);

    expect(result.success).toBe(false);
    expect(result.error).toContain('YOUTUBE');
    expect(result.error).not.toContain("hasn't completed");
  });
});
