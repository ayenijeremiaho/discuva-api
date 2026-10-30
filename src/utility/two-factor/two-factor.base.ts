import {
  BadRequestException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { CacheService } from '../service/cache.service';
import { EncryptionService } from '../service/encryption.service';
import {
  base32Encode,
  generateTotpSecret,
  matchTotpStep,
  totpUri,
} from './totp';

const CHALLENGE_TTL_SECONDS = 300;
const SETUP_TTL_SECONDS = 600;
const ATTEMPT_WINDOW_MS = 15 * 60_000;
const ATTEMPT_LIMIT = 10;
const BACKUP_CODE_COUNT = 10;

export function hashBackupCode(code: string): string {
  const normalised = code.toUpperCase().replace(/[^A-Z2-7]/g, '');
  return createHash('sha256').update(normalised).digest('hex');
}

function generateBackupCode(): string {
  return base32Encode(randomBytes(10)).match(/.{4}/g)!.join('-');
}

// The columns both admin tables carry.
export interface TwoFactorColumns {
  twoFactorSecret: string | null;
  twoFactorEnabledAt: Date | null;
  twoFactorLastStep: number | null;
  twoFactorBackupCodes: string[] | null;
}

export interface TwoFactorAccount {
  rowId: string;
  email: string;
  name: string;
  active: boolean;
  passwordHash: string;
  enabledAt: Date | null;
  secret: string | null;
  backupCodes: string[] | null;
}

export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: Date | null;
  backupCodesRemaining: number;
}

export type TwoFactorEvent = 'ENABLED' | 'DISABLED' | 'BACKUP_CODES' | 'RESET';

export interface TwoFactorKeyStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttl: number): Promise<void>;
  del(key: string): Promise<number>;
}

// Opt-in authenticator-app 2FA, shared by the platform console and the church admin portal.
export abstract class TwoFactorServiceBase {
  protected constructor(
    private readonly repo: Repository<any>,
    private readonly entity: new () => TwoFactorColumns,
    private readonly namespace: string,
    private readonly store: TwoFactorKeyStore,
    private readonly cacheService: CacheService,
    private readonly encryption: EncryptionService,
  ) {}

  protected abstract loadAccount(key: string): Promise<TwoFactorAccount | null>;
  protected abstract issuer(): Promise<string> | string;
  protected abstract onChange(
    account: TwoFactorAccount,
    event: TwoFactorEvent,
  ): void;

  private challengeKey(token: string) {
    return `${this.namespace}-2fa-challenge:${token}`;
  }

  private setupKey(key: string) {
    return `${this.namespace}-2fa-setup:${key}`;
  }

  private attemptsKey(key: string) {
    return `${this.namespace}-2fa-attempts:${key}`;
  }

  // Random and held in Redis, so it can never be mistaken for an access token.
  async createChallenge(key: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.store.set(this.challengeKey(token), key, CHALLENGE_TTL_SECONDS);
    return token;
  }

  async completeChallenge(token: string, code: string): Promise<string> {
    const expired = new UnauthorizedException(
      'Your sign-in has expired. Please enter your password again.',
    );
    const key = await this.store.get(this.challengeKey(token));
    if (!key) throw expired;

    await this.assertAttemptsLeft(key);
    const account = await this.loadAccount(key);
    if (!account?.active || !account.enabledAt) throw expired;
    if (!(await this.consumeCode(account, code))) {
      throw new UnauthorizedException(
        "That code didn't work. Check it and try again.",
      );
    }
    // Only the request that removes the challenge may sign in.
    if (!(await this.store.del(this.challengeKey(token)))) throw expired;
    await this.cacheService.delGlobal(this.attemptsKey(key));
    return key;
  }

  async getStatus(key: string): Promise<TwoFactorStatus> {
    const account = await this.requireAccount(key);
    return {
      enabled: !!account.enabledAt,
      enabledAt: account.enabledAt,
      backupCodesRemaining: account.backupCodes?.length ?? 0,
    };
  }

  async startSetup(
    key: string,
    password: string,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    const account = await this.requireAccount(key);
    if (account.enabledAt) {
      throw new BadRequestException('Two-factor sign-in is already on.');
    }
    await this.assertPassword(account, password);

    const secret = generateTotpSecret();
    await this.store.set(
      this.setupKey(key),
      this.encryption.encrypt(secret),
      SETUP_TTL_SECONDS,
    );
    return {
      secret,
      otpauthUrl: totpUri(await this.issuer(), account.email, secret),
    };
  }

  async enable(key: string, code: string): Promise<{ backupCodes: string[] }> {
    await this.assertAttemptsLeft(key);
    const account = await this.requireAccount(key);
    if (account.enabledAt) {
      throw new BadRequestException('Two-factor sign-in is already on.');
    }
    const pending = await this.store.get(this.setupKey(key));
    if (!pending) {
      throw new BadRequestException('Setup timed out. Please start again.');
    }
    const step = matchTotpStep(this.encryption.decrypt(pending), code.trim());
    if (step === null) {
      throw new BadRequestException(
        "That code didn't work. Check your authenticator app and try again.",
      );
    }

    const backupCodes = this.newBackupCodes();
    await this.repo.update(account.rowId, {
      twoFactorSecret: pending,
      twoFactorEnabledAt: new Date(),
      twoFactorLastStep: step,
      twoFactorBackupCodes: backupCodes.map(hashBackupCode),
    });
    this.store.del(this.setupKey(key));
    this.cacheService.delGlobal(this.attemptsKey(key));
    this.onChange(account, 'ENABLED');
    return { backupCodes };
  }

  async disable(key: string, password: string, code: string): Promise<void> {
    const account = await this.confirmedAccount(key, password, code);
    await this.clear(account.rowId);
    this.onChange(account, 'DISABLED');
  }

  async regenerateBackupCodes(
    key: string,
    password: string,
    code: string,
  ): Promise<{ backupCodes: string[] }> {
    const account = await this.confirmedAccount(key, password, code);
    const backupCodes = this.newBackupCodes();
    await this.repo.update(account.rowId, {
      twoFactorBackupCodes: backupCodes.map(hashBackupCode),
    });
    this.onChange(account, 'BACKUP_CODES');
    return { backupCodes };
  }

  // For someone who has lost both their app and their backup codes.
  protected async resetAccount(key: string): Promise<void> {
    const account = await this.requireAccount(key);
    await this.clear(account.rowId);
    this.onChange(account, 'RESET');
  }

  private async requireAccount(key: string): Promise<TwoFactorAccount> {
    const account = await this.loadAccount(key);
    if (!account) throw new UnauthorizedException();
    return account;
  }

  private async confirmedAccount(
    key: string,
    password: string,
    code: string,
  ): Promise<TwoFactorAccount> {
    await this.assertAttemptsLeft(key);
    const account = await this.requireAccount(key);
    if (!account.enabledAt) {
      throw new BadRequestException('Two-factor sign-in is not on.');
    }
    await this.assertPassword(account, password);
    if (!(await this.consumeCode(account, code))) {
      throw new BadRequestException(
        "That code didn't work. Check it and try again.",
      );
    }
    await this.cacheService.delGlobal(this.attemptsKey(key));
    return account;
  }

  private async consumeCode(
    account: TwoFactorAccount,
    code: string,
  ): Promise<boolean> {
    const trimmed = code.trim();
    if (/^\d{6}$/.test(trimmed)) {
      const step = matchTotpStep(
        this.encryption.decrypt(account.secret!),
        trimmed,
      );
      return step !== null && this.consumeStep(account.rowId, step);
    }
    return this.consumeBackupCode(account.rowId, trimmed);
  }

  // Conditional updates, so a code can't be used twice, even by two requests at once.
  private async consumeStep(rowId: string, step: number): Promise<boolean> {
    const result = await this.repo
      .createQueryBuilder()
      .update(this.entity)
      .set({ twoFactorLastStep: step })
      .where(
        'id = :rowId AND (two_factor_last_step IS NULL OR two_factor_last_step < :step)',
        { rowId, step },
      )
      .execute();
    return !!result.affected;
  }

  private async consumeBackupCode(
    rowId: string,
    code: string,
  ): Promise<boolean> {
    const result = await this.repo
      .createQueryBuilder()
      .update(this.entity)
      .set({
        twoFactorBackupCodes: () =>
          'array_remove(two_factor_backup_codes, :hash)',
      })
      .where('id = :rowId AND :hash = ANY(two_factor_backup_codes)', {
        rowId,
        hash: hashBackupCode(code),
      })
      .execute();
    return !!result.affected;
  }

  private async assertAttemptsLeft(key: string): Promise<void> {
    const { blockMsLeft } = await this.cacheService.hitWindow(
      this.attemptsKey(key),
      ATTEMPT_WINDOW_MS,
      ATTEMPT_LIMIT,
      ATTEMPT_WINDOW_MS,
    );
    if (blockMsLeft > 0) {
      throw new HttpException(
        'Too many attempts. Please wait 15 minutes and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async assertPassword(
    account: TwoFactorAccount,
    password: string,
  ): Promise<void> {
    if (!(await argon2.verify(account.passwordHash, password))) {
      throw new BadRequestException('That password is not correct.');
    }
  }

  private newBackupCodes(): string[] {
    return Array.from({ length: BACKUP_CODE_COUNT }, generateBackupCode);
  }

  private async clear(rowId: string): Promise<void> {
    await this.repo.update(rowId, {
      twoFactorSecret: null,
      twoFactorEnabledAt: null,
      twoFactorLastStep: null,
      twoFactorBackupCodes: null,
    });
  }
}

export function twoFactorNotice(
  event: TwoFactorEvent,
  place: string,
): { heading: string; message: string } {
  const notices: Record<TwoFactorEvent, { heading: string; message: string }> =
    {
      ENABLED: {
        heading: 'Two-factor sign-in is on',
        message: `You turned on two-factor sign-in for your ${place} account. You will now be asked for a code from your authenticator app each time you sign in.`,
      },
      DISABLED: {
        heading: 'Two-factor sign-in is off',
        message: `You turned off two-factor sign-in for your ${place} account. We recommend turning it back on.`,
      },
      BACKUP_CODES: {
        heading: 'New backup codes created',
        message: `New backup codes were created for your ${place} account. Your old backup codes no longer work.`,
      },
      RESET: {
        heading: 'Two-factor sign-in was reset',
        message: `Another admin reset two-factor sign-in on your ${place} account, so it is now off. If you did not ask for this, contact your team straight away. We recommend turning it back on.`,
      },
    };
  return notices[event];
}
