import { NotConnectedPublisher } from './not-connected-publisher';
import { SocialAccount } from '../entity/social-account.entity';
import { SocialPlatform } from '../enum/social-media.enum';

describe('NotConnectedPublisher', () => {
  it('always reports failure with a platform-specific explanation, never a false success', async () => {
    const publisher = new NotConnectedPublisher();

    const result = await publisher.publish({
      platform: SocialPlatform.FACEBOOK,
    } as SocialAccount);

    expect(result.success).toBe(false);
    expect(result.error).toContain('FACEBOOK');
  });
});
