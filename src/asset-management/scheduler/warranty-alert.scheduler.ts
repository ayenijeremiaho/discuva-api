import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Asset } from '../entity/asset.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { UtilityService } from '../../utility/service/utility.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { CacheService } from '../../utility/service/cache.service';
import { ReminderSettingsService } from '../../reminder-settings/service/reminder-settings.service';
import { ReminderSettingKey } from '../../reminder-settings/enum/reminder-setting-key.enum';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';

@Injectable()
export class WarrantyAlertScheduler {
  private readonly logger = new Logger(WarrantyAlertScheduler.name);
  private static readonly LOCK_KEY = 'lock:asset-warranty-alerts';

  constructor(
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    @InjectRepository(Admin)
    private readonly adminRepo: Repository<Admin>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly utilityService: UtilityService,
    private readonly cacheService: CacheService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly reminderSettingsService: ReminderSettingsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: CHURCH_TIMEZONE })
  async dispatchWarrantyAlerts(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(
      WarrantyAlertScheduler.LOCK_KEY,
      300,
    );
    if (!acquired) return;

    try {
      await forEachActiveTenant(
        this.tenantRepo,
        this.cls,
        this.txHost,
        this.logger,
        () => this.runAlerts(),
      );
    } finally {
      this.cacheService.releaseLock(WarrantyAlertScheduler.LOCK_KEY);
    }
  }

  private async runAlerts(): Promise<void> {
    const { enabled, thresholds } =
      await this.reminderSettingsService.getConfig(
        ReminderSettingKey.ASSET_WARRANTY,
      );
    if (!enabled) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const assets = await this.assetRepo.find({
      where: { warrantyExpiry: Not(IsNull()) },
    });

    if (assets.length === 0) return;

    const recipients = await this.fetchRecipients();
    if (recipients.length === 0) return;

    for (const asset of assets) {
      try {
        await this.processAsset(asset, today, recipients, thresholds);
      } catch (err) {
        this.logger.error(
          `Failed to process warranty alert for asset ${asset.id}`,
          err,
        );
      }
    }
  }

  private async processAsset(
    asset: Asset,
    today: Date,
    recipients: string[],
    thresholds: number[],
  ): Promise<void> {
    const expiry = new Date(asset.warrantyExpiry);
    expiry.setHours(0, 0, 0, 0);
    const daysUntilExpiry = Math.round(
      (expiry.getTime() - today.getTime()) / 86_400_000,
    );

    if (daysUntilExpiry < 0) return;

    const notified = asset.warrantyNotifiedThresholds ?? [];
    if (
      !thresholds.includes(daysUntilExpiry) ||
      notified.includes(daysUntilExpiry)
    ) {
      return;
    }

    this.sendAlert(
      recipients,
      asset,
      WarrantyAlertScheduler.timingLabel(daysUntilExpiry),
    );
    asset.warrantyNotifiedThresholds = [...notified, daysUntilExpiry];
    await this.assetRepo.save(asset);
  }

  private static timingLabel(daysUntilExpiry: number): string {
    return `${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}`;
  }

  private sendAlert(recipients: string[], asset: Asset, timing: string): void {
    for (const email of recipients) {
      this.utilityService.sendEmailWithTemplate(
        email,
        `Warranty Expiring in ${timing}: ${asset.name}`,
        'asset-warranty-alert',
        {
          assetName: asset.name,
          tagNumber: asset.tagNumber,
          category: asset.category,
          location: asset.location ?? 'Not specified',
          warrantyExpiry: asset.warrantyExpiry,
          timing,
          vendorName: asset.vendorName ?? 'Not specified',
          vendorContact: asset.vendorContact ?? 'Not specified',
        },
        undefined,
        EmailCategory.ASSET_ALERTS,
      );
    }
  }

  private async fetchRecipients(): Promise<string[]> {
    const admins = await this.adminRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.member', 'm')
      .leftJoinAndSelect('a.adminRole', 'role')
      .where('a.isActive = true')
      .getMany();

    return admins
      .filter((a) =>
        a.adminRole?.permissions?.includes(
          AdminPermission.ASSET_MAINTENANCE_ALERT,
        ),
      )
      .map((a) => a.member?.email)
      .filter((e): e is string => !!e);
  }
}
