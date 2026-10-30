import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformAdmin } from '../entity/platform-admin.entity';
import { PlatformAdminSecurityEvent } from '../entity/platform-admin-security-event.entity';
import { CacheService } from '../../utility/service/cache.service';
import { EncryptionService } from '../../utility/service/encryption.service';
import { UtilityService } from '../../utility/service/utility.service';
import {
  TwoFactorAccount,
  TwoFactorEvent,
  TwoFactorServiceBase,
  twoFactorNotice,
} from '../../utility/two-factor/two-factor.base';

const SECURITY_EVENTS_SHOWN = 20;

@Injectable()
export class PlatformAdminTwoFactorService extends TwoFactorServiceBase {
  private readonly logger = new Logger(PlatformAdminTwoFactorService.name);

  constructor(
    @InjectRepository(PlatformAdmin)
    private readonly platformAdminRepo: Repository<PlatformAdmin>,
    cacheService: CacheService,
    encryption: EncryptionService,
    private readonly utilityService: UtilityService,
    private readonly configService: ConfigService,
    @InjectRepository(PlatformAdminSecurityEvent)
    private readonly securityEventRepo: Repository<PlatformAdminSecurityEvent>,
  ) {
    super(
      platformAdminRepo,
      PlatformAdmin,
      'platform',
      {
        get: (key) => cacheService.getGlobal<string>(key),
        set: (key, value, ttl) => cacheService.setGlobal(key, value, ttl),
        del: (key) => cacheService.delGlobal(key),
      },
      cacheService,
      encryption,
    );
  }

  async resetByAnotherAdmin(adminId: string, actorId: string): Promise<void> {
    await this.resetAccount(adminId);
    this.record(adminId, 'RESET', actorId);
  }

  getSecurityEvents(adminId: string): Promise<PlatformAdminSecurityEvent[]> {
    return this.securityEventRepo.find({
      where: { platformAdminId: adminId },
      order: { createdAt: 'DESC' },
      take: SECURITY_EVENTS_SHOWN,
    });
  }

  protected async endSessions(account: TwoFactorAccount): Promise<void> {
    await this.platformAdminRepo.update(account.rowId, {
      sessionsValidFrom: new Date(),
    });
  }

  private record(adminId: string, action: string, actorId: string): void {
    this.securityEventRepo
      .insert({ platformAdminId: adminId, action, actorId })
      .catch((err: Error) =>
        this.logger.error(
          `Could not record security event ${action} for ${adminId}: ${err.message}`,
        ),
      );
  }

  protected issuer(): string {
    return `${this.configService.get<string>('PRODUCT_NAME')} Platform`;
  }

  protected async loadAccount(key: string): Promise<TwoFactorAccount | null> {
    const admin = await this.platformAdminRepo
      .createQueryBuilder('admin')
      .addSelect([
        'admin.passwordHash',
        'admin.twoFactorSecret',
        'admin.twoFactorBackupCodes',
        'admin.twoFactorDevicesValidFrom',
      ])
      .where('admin.id = :key', { key })
      .getOne();
    if (!admin) return null;
    return {
      rowId: admin.id,
      email: admin.email,
      name: admin.email.split('@')[0],
      active: admin.isActive,
      passwordHash: admin.passwordHash,
      enabledAt: admin.twoFactorEnabledAt,
      secret: admin.twoFactorSecret,
      backupCodes: admin.twoFactorBackupCodes,
      devicesValidFrom: admin.twoFactorDevicesValidFrom,
    };
  }

  protected onChange(account: TwoFactorAccount, event: TwoFactorEvent): void {
    if (event !== 'RESET') this.record(account.rowId, event, account.rowId);
    const { heading, message } = twoFactorNotice(event, 'platform console');
    const product = this.configService.get<string>('PRODUCT_NAME');
    this.utilityService.sendEmailWithTemplate(
      account.email,
      `${heading} on your ${product} platform account`,
      'platform-admin-security-notice',
      { name: account.name, heading, message },
    );
  }
}
