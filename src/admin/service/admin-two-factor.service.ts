import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Admin } from '../entity/admin.entity';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { CacheService } from '../../utility/service/cache.service';
import { EncryptionService } from '../../utility/service/encryption.service';
import { UtilityService } from '../../utility/service/utility.service';
import {
  TwoFactorAccount,
  TwoFactorEvent,
  TwoFactorServiceBase,
  twoFactorNotice,
} from '../../utility/two-factor/two-factor.base';

// Keyed by member id; CacheService's scoped keys stop a challenge from one church working at another.
@Injectable()
export class AdminTwoFactorService extends TwoFactorServiceBase {
  constructor(
    @InjectRepository(Admin)
    private readonly adminRepository: Repository<Admin>,
    cacheService: CacheService,
    encryption: EncryptionService,
    private readonly utilityService: UtilityService,
    private readonly auditLogService: AuditLogService,
  ) {
    super(
      adminRepository,
      Admin,
      'admin',
      {
        get: (key) => cacheService.get<string>(key),
        set: (key, value, ttl) => cacheService.set(key, value, ttl),
        del: (key) => cacheService.del(key),
      },
      cacheService,
      encryption,
    );
  }

  async resetByAnotherAdmin(memberId: string, actorId: string): Promise<void> {
    await this.resetAccount(memberId);
    this.auditLogService.log('ADMIN_2FA_RESET', {
      actorId,
      targetId: memberId,
    });
  }

  protected async issuer(): Promise<string> {
    return `${await this.utilityService.resolveChurchName()} Admin`;
  }

  protected async loadAccount(key: string): Promise<TwoFactorAccount | null> {
    const admin = await this.adminRepository
      .createQueryBuilder('admin')
      .innerJoinAndSelect('admin.member', 'member')
      .addSelect([
        'member.password',
        'admin.twoFactorSecret',
        'admin.twoFactorBackupCodes',
      ])
      .where('member.id = :key', { key })
      .getOne();
    if (!admin) return null;
    return {
      rowId: admin.id,
      email: admin.member.email,
      name: UtilityService.capitalizeFirstLetter(
        admin.member.firstname ?? 'Admin',
      ),
      active: admin.isActive && admin.member.status === MemberStatusEnum.ACTIVE,
      passwordHash: admin.member.password,
      enabledAt: admin.twoFactorEnabledAt,
      secret: admin.twoFactorSecret,
      backupCodes: admin.twoFactorBackupCodes,
    };
  }

  // Always sent, so it deliberately has no category a church could switch off.
  protected onChange(account: TwoFactorAccount, event: TwoFactorEvent): void {
    const { heading, message } = twoFactorNotice(event, 'admin portal');
    this.utilityService.sendEmailWithTemplate(
      account.email,
      heading,
      'admin-security-notice',
      { name: account.name, heading, message },
    );
    if (event !== 'RESET') {
      this.auditLogService.log(`ADMIN_2FA_${event}`, {
        targetEmail: account.email,
        targetName: account.name,
      });
    }
  }
}
