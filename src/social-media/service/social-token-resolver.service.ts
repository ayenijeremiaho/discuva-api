import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SocialAccount } from '../entity/social-account.entity';
import { EncryptionService } from '../../utility/service/encryption.service';
import { SocialTokenRefresherRegistry } from '../token/social-token-refresher-registry.service';

// Renew 60s before actual expiry — avoids a race where a token that's
// technically still valid at the moment of this check expires mid-flight
// during the publish call that follows.
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

// Every publisher calls this instead of touching SocialAccount's encrypted
// columns directly. Takes an accountId, not a SocialAccount object — the
// token columns are select:false, so an account loaded via a normal
// relation (e.g. SocialPost.targets[].account) never carries them; this is
// the one place that explicitly opts back in to fetch and decrypt them.
@Injectable()
export class SocialTokenResolverService {
  constructor(
    @InjectRepository(SocialAccount)
    private readonly accountRepo: Repository<SocialAccount>,
    private readonly encryptionService: EncryptionService,
    private readonly refresherRegistry: SocialTokenRefresherRegistry,
  ) {}

  async getValidAccessToken(accountId: string): Promise<string> {
    const account = await this.accountRepo.findOne({
      where: { id: accountId },
      select: [
        'id',
        'platform',
        'accessTokenEncrypted',
        'refreshTokenEncrypted',
        'tokenExpiresAt',
      ],
    });
    if (!account) {
      throw new NotFoundException(`Social account "${accountId}" not found.`);
    }
    if (!account.accessTokenEncrypted) {
      throw new Error(
        `${account.platform} account is not connected — no access token stored.`,
      );
    }

    const isExpired =
      account.tokenExpiresAt !== null &&
      account.tokenExpiresAt.getTime() - EXPIRY_SAFETY_MARGIN_MS <= Date.now();

    if (!isExpired) {
      return this.encryptionService.decrypt(account.accessTokenEncrypted);
    }

    if (!account.refreshTokenEncrypted) {
      throw new Error(
        `${account.platform} access token has expired and no refresh token is available — reconnect the account.`,
      );
    }

    const refresher = this.refresherRegistry.resolve(account.platform);
    const refreshToken = this.encryptionService.decrypt(
      account.refreshTokenEncrypted,
    );
    const result = await refresher.refresh(refreshToken);

    account.accessTokenEncrypted = this.encryptionService.encrypt(
      result.accessToken,
    );
    if (result.refreshToken) {
      account.refreshTokenEncrypted = this.encryptionService.encrypt(
        result.refreshToken,
      );
    }
    account.tokenExpiresAt = new Date(
      Date.now() + result.expiresInSeconds * 1000,
    );
    await this.accountRepo.save(account);

    return result.accessToken;
  }
}
