import { Injectable } from '@nestjs/common';
import {
  RefreshResult,
  SocialTokenRefresher,
} from './social-token-refresher.interface';

// The default for every platform until a real refresher is registered
// alongside its SocialPlatformPublisher. Throws rather than returning a
// result — SocialTokenResolverService has no valid token to fall back to
// once refresh itself is unimplemented, so the caller (a publisher) must
// see this as a real failure, not silently keep using an expired token.
@Injectable()
export class NoRefresherAvailable implements SocialTokenRefresher {
  async refresh(): Promise<RefreshResult> {
    throw new Error(
      'Token refresh is not yet implemented for this platform — reconnect the account.',
    );
  }
}
