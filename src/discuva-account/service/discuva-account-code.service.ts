import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import {
  DiscuvaAccountCode,
  DiscuvaAccountCodePurpose,
} from '../entity/discuva-account-code.entity';
import { CacheService } from '../../utility/service/cache.service';
import { UtilityService } from '../../utility/service/utility.service';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { PlatformSettingKey } from '../../platform-admin/enum/platform-setting-key.enum';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { normaliseEmail } from '../util/normalise-email';

type LinkPurpose =
  | DiscuvaAccountCodePurpose.FREEZE
  | DiscuvaAccountCodePurpose.EMAIL_UNDO
  | DiscuvaAccountCodePurpose.DELETE_CANCEL;

const tooMany = (message: string) =>
  new HttpException(
    {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      error: 'TOO_MANY_REQUESTS',
      message,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );

// Emailed 6-digit codes (join, link, recover) and the long one-use links in security emails (freeze, undo).
@Injectable()
export class DiscuvaAccountCodeService {
  constructor(
    @InjectRepository(DiscuvaAccountCode)
    private readonly codeRepo: Repository<DiscuvaAccountCode>,
    private readonly cacheService: CacheService,
    private readonly utilityService: UtilityService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  // Only this device's earlier code is replaced, so someone else asking never cancels the owner's code.
  async sendCode(
    email: string,
    purpose: DiscuvaAccountCodePurpose,
    deviceId: string,
    message: { firstName: string | null; action: string },
  ): Promise<void> {
    const limit = await this.platformSettings.getNumber(
      PlatformSettingKey.ACCOUNT_CODE_REQUESTS_PER_HOUR,
    );
    const asked = await this.cacheService.incrGlobal(
      this.counterKey('account_code_req', email, purpose, deviceId),
      3600,
    );
    if (asked > limit) {
      throw tooMany('Too many codes asked for. Please try again in an hour.');
    }
    const normalised = normaliseEmail(email);
    await this.codeRepo.delete({
      email: normalised,
      purpose,
      deviceId,
      usedAt: IsNull(),
    });
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const minutes = await this.codeTtlMinutes();
    await this.codeRepo.save(
      this.codeRepo.create({
        email: normalised,
        purpose,
        deviceId,
        tenantId: this.cls.get('tenantId') ?? null,
        codeHash: await UtilityService.hashValue(code),
        expiresAt: new Date(Date.now() + minutes * 60_000),
        usedAt: null,
      }),
    );
    this.utilityService.sendEmailWithTemplate(
      normalised,
      'Your Discuva code',
      'discuva-account-code',
      {
        name: message.firstName
          ? UtilityService.capitalizeFirstLetter(message.firstName)
          : 'there',
        otp: code,
        expiresMinutes: String(minutes),
        action: message.action,
      },
    );
  }

  // Wrong guesses count per email, purpose and device, so someone else can't use up the owner's tries.
  async verifyCode(
    email: string,
    purpose: DiscuvaAccountCodePurpose,
    deviceId: string,
    code: string,
  ): Promise<void> {
    const key = this.counterKey('account_code_fail', email, purpose, deviceId);
    const max = await this.platformSettings.getNumber(
      PlatformSettingKey.ACCOUNT_CODE_MAX_ATTEMPTS,
    );
    if (((await this.cacheService.getGlobal<number>(key)) ?? 0) >= max) {
      throw tooMany(
        'Too many incorrect attempts. Please ask for a new code and try again.',
      );
    }
    const record = await this.codeRepo.findOne({
      where: {
        email: normaliseEmail(email),
        purpose,
        deviceId,
        usedAt: IsNull(),
      },
      order: { createdAt: 'DESC' },
    });
    const valid =
      !!record &&
      record.expiresAt > new Date() &&
      (await UtilityService.verifyHashedValue(code, record.codeHash));
    if (!valid) {
      await this.cacheService.incrGlobal(
        key,
        (await this.codeTtlMinutes()) * 60,
      );
      throw new BadRequestException(
        'This code is invalid or has expired. Please ask for a new one.',
      );
    }
    await this.markUsed(record.id);
    this.cacheService.delGlobal(key);
  }

  // Only a hash of the link token is kept.
  async issueLinkToken(
    accountId: string,
    purpose: LinkPurpose,
    email: string,
    validDays?: number,
  ): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const days =
      validDays ??
      (await this.platformSettings.getNumber(
        PlatformSettingKey.ACCOUNT_LINK_VALID_DAYS,
      ));
    await this.codeRepo.save(
      this.codeRepo.create({
        email: normaliseEmail(email),
        purpose,
        accountId,
        deviceId: null,
        tenantId: this.cls.get('tenantId') ?? null,
        codeHash: this.tokenHash(token),
        expiresAt: new Date(Date.now() + days * 86_400_000),
        usedAt: null,
      }),
    );
    return token;
  }

  // Not marked used here: the caller does that once its change has worked, so a refused change keeps the link.
  async findLinkToken(
    accountId: string,
    purpose: LinkPurpose,
    token: string,
  ): Promise<DiscuvaAccountCode> {
    const record = await this.codeRepo.findOne({
      where: {
        codeHash: this.tokenHash(token),
        purpose,
        accountId,
        usedAt: IsNull(),
      },
    });
    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException(
        'This link has expired or was already used. Contact your church if you need help.',
      );
    }
    return record;
  }

  async markUsed(id: string): Promise<void> {
    await this.codeRepo.update(id, { usedAt: new Date() });
  }

  async purge(): Promise<void> {
    await this.codeRepo
      .createQueryBuilder()
      .delete()
      .where('used_at IS NOT NULL OR expires_at < :now', { now: new Date() })
      .execute();
  }

  private codeTtlMinutes(): Promise<number> {
    return this.platformSettings.getNumber(
      PlatformSettingKey.ACCOUNT_CODE_TTL_MINUTES,
    );
  }

  private counterKey(
    ns: string,
    email: string,
    purpose: string,
    deviceId: string,
  ): string {
    return `${ns}:${normaliseEmail(email)}:${purpose}:${deviceId}`;
  }

  private tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
