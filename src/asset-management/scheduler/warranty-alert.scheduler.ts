import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Asset } from '../entity/asset.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { UtilityService } from '../../utility/service/utility.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { CacheService } from '../../utility/service/cache.service';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';

@Injectable()
export class WarrantyAlertScheduler {
  private readonly logger = new Logger(WarrantyAlertScheduler.name);
  private static readonly LOCK_KEY = 'lock:asset-warranty-alerts';

  constructor(
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    @InjectRepository(Admin)
    private readonly adminRepo: Repository<Admin>,
    private readonly utilityService: UtilityService,
    private readonly cacheService: CacheService,
    private readonly configService: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: CHURCH_TIMEZONE })
  async dispatchWarrantyAlerts(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(
      WarrantyAlertScheduler.LOCK_KEY,
      300,
    );
    if (!acquired) return;

    try {
      await this.runAlerts();
    } finally {
      this.cacheService.releaseLock(WarrantyAlertScheduler.LOCK_KEY);
    }
  }

  private async runAlerts(): Promise<void> {
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
        await this.processAsset(asset, today, recipients);
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
  ): Promise<void> {
    const expiry = new Date(asset.warrantyExpiry);
    expiry.setHours(0, 0, 0, 0);
    const daysUntilExpiry = Math.round(
      (expiry.getTime() - today.getTime()) / 86_400_000,
    );

    if (daysUntilExpiry < 0) return;

    let updated = false;

    if (daysUntilExpiry === 30 && !asset.warrantyNotified30DaysAt) {
      this.sendAlert(recipients, asset, '30 days');
      asset.warrantyNotified30DaysAt = new Date();
      updated = true;
    } else if (daysUntilExpiry === 14 && !asset.warrantyNotified14DaysAt) {
      this.sendAlert(recipients, asset, '14 days');
      asset.warrantyNotified14DaysAt = new Date();
      updated = true;
    } else if (daysUntilExpiry === 7 && !asset.warrantyNotified7DaysAt) {
      this.sendAlert(recipients, asset, '7 days');
      asset.warrantyNotified7DaysAt = new Date();
      updated = true;
    } else if (daysUntilExpiry === 1 && !asset.warrantyNotified1DayAt) {
      this.sendAlert(recipients, asset, '1 day');
      asset.warrantyNotified1DayAt = new Date();
      updated = true;
    }

    if (updated) {
      await this.assetRepo.save(asset);
    }
  }

  private sendAlert(recipients: string[], asset: Asset, timing: string): void {
    const adminLoginUrl = this.configService.get<string>('ADMIN_LOGIN_URL');
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
          admin_login_url: adminLoginUrl,
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
