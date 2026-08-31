import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SocialDataDeletionRequest } from '../entity/social-data-deletion-request.entity';
import { SocialPlatform } from '../enum/social-media.enum';
import { PlatformSocialAppService } from '../../platform-admin/service/platform-social-app.service';

interface SignedRequestPayload {
  algorithm: string;
  issued_at: number;
  user_id: string;
}

// Facebook and Instagram are the only platforms with Meta's
// signed_request-based deletion callback — both typically share the same
// Meta App (and therefore the same client secret), but are tried
// independently in case they were ever registered with different
// credentials.
const META_PLATFORMS: SocialPlatform[] = [
  SocialPlatform.FACEBOOK,
  SocialPlatform.INSTAGRAM,
];

@Injectable()
export class MetaDataDeletionService {
  constructor(
    @InjectRepository(SocialDataDeletionRequest)
    private readonly requestRepo: Repository<SocialDataDeletionRequest>,
    private readonly platformSocialAppService: PlatformSocialAppService,
    private readonly configService: ConfigService,
  ) {}

  // Verifies against every registered Meta-platform app's secret rather
  // than assuming Facebook's — see META_PLATFORMS' own comment. Throws
  // BadRequestException on any failure (malformed input, bad signature,
  // wrong algorithm, no Meta app registered at all) — a data-deletion
  // callback is exactly the kind of request that must never be trusted
  // just because it arrived; a forged POST here must not appear to
  // succeed.
  async verifySignedRequest(
    signedRequest: string,
  ): Promise<{ userId: string; platform: SocialPlatform }> {
    const parts = signedRequest?.split('.') ?? [];
    if (parts.length !== 2) {
      throw new BadRequestException('Malformed signed_request.');
    }
    const [encodedSig, encodedPayload] = parts;

    let providedSig: Buffer;
    try {
      providedSig = Buffer.from(encodedSig, 'base64url');
    } catch {
      throw new BadRequestException('Malformed signed_request signature.');
    }

    for (const platform of META_PLATFORMS) {
      const resolved =
        await this.platformSocialAppService.getDecryptedApp(platform);
      if (!resolved) continue;

      const expectedSig = createHmac('sha256', resolved.clientSecret)
        .update(encodedPayload)
        .digest();

      if (
        expectedSig.length !== providedSig.length ||
        !timingSafeEqual(expectedSig, providedSig)
      ) {
        continue;
      }

      const payload = this.parsePayload(encodedPayload);
      if (payload.algorithm !== 'HMAC-SHA256' || !payload.user_id) {
        throw new BadRequestException('Unsupported signed_request algorithm.');
      }
      return { userId: payload.user_id, platform };
    }

    throw new BadRequestException(
      'signed_request signature did not verify against any registered Meta app.',
    );
  }

  private parsePayload(encodedPayload: string): SignedRequestPayload {
    try {
      return JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as SignedRequestPayload;
    } catch {
      throw new BadRequestException('Malformed signed_request payload.');
    }
  }

  // Discuva never stores a Facebook-scoped personal user id anywhere
  // (SocialAccount.externalAccountId is the connected Page's id, not the
  // authorizing person's — see that entity's own comment), so there is no
  // actual data tied to this user_id to go delete. This just records that
  // the request was received, so the status URL Meta requires isn't a dead
  // link, and returns immediately — no async job needed.
  async recordRequest(
    userId: string,
    platform: SocialPlatform,
    requestHost: string,
  ): Promise<{ confirmationCode: string; statusUrl: string }> {
    const confirmationCode = randomUUID();
    await this.requestRepo.save(
      this.requestRepo.create({
        platform,
        platformUserId: userId,
        confirmationCode,
      }),
    );

    const base =
      this.configService.get<string>('META_DATA_DELETION_STATUS_BASE_URL') ||
      requestHost;
    return {
      confirmationCode,
      statusUrl: `${base}/v1/integrations/social/meta/data-deletion/status/${confirmationCode}`,
    };
  }

  async getStatus(
    confirmationCode: string,
  ): Promise<SocialDataDeletionRequest | null> {
    return this.requestRepo.findOne({ where: { confirmationCode } });
  }
}
