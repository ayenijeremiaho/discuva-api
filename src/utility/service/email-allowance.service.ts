import { Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { PlatformSettingKey } from '../../platform-admin/enum/platform-setting-key.enum';
import { EmailCategory } from '../email-provider/email-category.enum';
import { CacheService } from './cache.service';
import { EmailCredentialResolverService } from '../../communication-provider/service/email-credential-resolver.service';
import { TenantVerificationService } from './tenant-verification.service';

const TWO_DAYS_SECONDS = 2 * 24 * 60 * 60;
// Sign-in alerts and receipts always go out, as do uncategorised emails such as password resets.
const ALWAYS_SENT = new Set([
  EmailCategory.LOGIN_ALERT,
  EmailCategory.GIVING_RECEIPT,
]);

// Limits what an unverified account can send through Discuva's own email provider each day.
@Injectable()
export class EmailAllowanceService {
  private readonly logger = new Logger(EmailAllowanceService.name);

  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly cacheService: CacheService,
    private readonly verification: TenantVerificationService,
    private readonly settings: PlatformSettingsService,
    private readonly credentials: EmailCredentialResolverService,
  ) {}

  async allows(category: EmailCategory, recipients: number): Promise<boolean> {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId || ALWAYS_SENT.has(category)) return true;
    if (await this.verification.isVerified(tenantId)) return true;
    if (await this.credentials.resolveConfig()) return true;

    const limit = await this.settings.getNumber(
      PlatformSettingKey.UNVERIFIED_DAILY_EMAIL_LIMIT,
    );
    const day = new Date().toISOString().slice(0, 10);
    const key = `email-allowance:${tenantId}:${day}`;
    const used = await this.cacheService.incr(
      key,
      TWO_DAYS_SECONDS,
      recipients,
    );
    if (used > limit) {
      this.logger.warn(`Daily email limit reached for tenant ${tenantId}`);
      return false;
    }
    return true;
  }
}
