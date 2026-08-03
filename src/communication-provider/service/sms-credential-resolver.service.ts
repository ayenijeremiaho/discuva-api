import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TenantCommunicationProviderConfig } from '../../platform-admin/entity/tenant-communication-provider-config.entity';
import { CommunicationProvider } from '../../platform-admin/entity/communication-provider.entity';
import { SmsWallet } from '../../platform-admin/entity/sms-wallet.entity';
import {
  SmsWalletTransaction,
  SmsWalletTransactionType,
} from '../../platform-admin/entity/sms-wallet-transaction.entity';
import { EncryptionService } from '../../utility/service/encryption.service';
import { CacheService } from '../../utility/service/cache.service';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';

// Used by SmsService to decide, per send, whose Termii account (or whatever
// SMS provider a tenant has BYOK-configured) actually gets charged:
// - Tenant has an active BYOK config for the 'sms' channel -> use their own
//   decrypted credentials, no wallet involved (they pay their own vendor).
// - No BYOK config -> caller uses the platform's own constructor-injected
//   default credentials (TermiiSmsProvider's ConfigService fallback) and
//   this service debits the tenant's prepaid SmsWallet instead.
@Injectable()
export class SmsCredentialResolverService {
  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly encryptionService: EncryptionService,
    private readonly cacheService: CacheService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(TenantCommunicationProviderConfig)
    private readonly configRepo: Repository<TenantCommunicationProviderConfig>,
  ) {}

  private currentTenantId(): string | undefined {
    return this.cls.get('tenantId');
  }

  private cacheKey(tenantId: string): string {
    return `communication-provider-config:${tenantId}:sms`;
  }

  // Returns undefined when the tenant should fall back to the platform
  // default — either no tenant context at all (a script/job with no
  // envelope, matching how the rest of this app treats that case), or no
  // active BYOK config for SMS specifically.
  async resolveCredentials(): Promise<Record<string, string> | undefined> {
    const tenantId = this.currentTenantId();
    if (!tenantId) return undefined;

    return this.cacheService
      .getOrSet(
        this.cacheKey(tenantId),
        async () => {
          const config = await this.configRepo
            .createQueryBuilder('config')
            .innerJoin(
              CommunicationProvider,
              'provider',
              'provider.id = config.providerId',
            )
            .addSelect('config.credentialsEncrypted')
            .where('config.tenantId = :tenantId', { tenantId })
            .andWhere('config.isActive = true')
            .andWhere('provider.channel = :channel', { channel: 'sms' })
            .getOne();

          // Cast to a sentinel rather than returning undefined here — see the
          // getOrSet-unwrap comment below for why.
          if (!config) return null;
          return this.encryptionService.decryptFields(
            config.credentialsEncrypted as Record<string, string>,
          );
        },
        300,
      )
      .then((cached) => cached ?? undefined);
    // CacheService.getOrSet only skips re-fetching when the cached value
    // isn't `undefined` — caching `undefined` itself for "no BYOK
    // configured" would defeat the cache (every call would re-query), so
    // the fetcher above caches `null` instead and this unwraps it back to
    // undefined for callers.
  }

  // Atomic: locks the wallet row for the duration of the transaction, so
  // two concurrent sends can't both read the same starting balance and
  // both succeed past a check that should have blocked the second one.
  async debitForSend(credits: number, reference?: string): Promise<void> {
    const tenantId = this.currentTenantId();
    if (!tenantId || credits <= 0) return;

    await this.dataSource.transaction(async (manager) => {
      const wallet = await manager.findOne(SmsWallet, {
        where: { tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      const balance = wallet?.balanceCredits ?? 0;
      if (balance < credits) {
        throw new ForbiddenException({
          message:
            'Insufficient SMS wallet balance. Configure your own SMS provider or contact support to top up.',
          code: 'INSUFFICIENT_SMS_BALANCE',
        });
      }

      const balanceAfter = balance - credits;
      await manager.save(SmsWallet, { tenantId, balanceCredits: balanceAfter });
      await manager.save(
        SmsWalletTransaction,
        manager.create(SmsWalletTransaction, {
          tenantId,
          type: SmsWalletTransactionType.DEBIT,
          credits,
          balanceAfter,
          reference,
        }),
      );
    });
  }
}
