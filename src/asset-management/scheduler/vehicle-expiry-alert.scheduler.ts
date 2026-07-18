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

interface ExpiryConfig {
  expiryField: 'insuranceExpiry' | 'roadworthinessExpiry';
  label: string;
  notified30: 'insuranceNotified30DaysAt' | 'roadworthinessNotified30DaysAt';
  notified14: 'insuranceNotified14DaysAt' | 'roadworthinessNotified14DaysAt';
  notified7: 'insuranceNotified7DaysAt' | 'roadworthinessNotified7DaysAt';
  notified1: 'insuranceNotified1DayAt' | 'roadworthinessNotified1DayAt';
}

const EXPIRY_CONFIGS: ExpiryConfig[] = [
  {
    expiryField: 'insuranceExpiry',
    label: 'Insurance',
    notified30: 'insuranceNotified30DaysAt',
    notified14: 'insuranceNotified14DaysAt',
    notified7: 'insuranceNotified7DaysAt',
    notified1: 'insuranceNotified1DayAt',
  },
  {
    expiryField: 'roadworthinessExpiry',
    label: 'Roadworthiness',
    notified30: 'roadworthinessNotified30DaysAt',
    notified14: 'roadworthinessNotified14DaysAt',
    notified7: 'roadworthinessNotified7DaysAt',
    notified1: 'roadworthinessNotified1DayAt',
  },
];

@Injectable()
export class VehicleExpiryAlertScheduler {
  private readonly logger = new Logger(VehicleExpiryAlertScheduler.name);
  private static readonly LOCK_KEY = 'lock:asset-vehicle-expiry-alerts';

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
  async dispatchVehicleExpiryAlerts(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(
      VehicleExpiryAlertScheduler.LOCK_KEY,
      300,
    );
    if (!acquired) return;

    try {
      await this.runAlerts();
    } finally {
      this.cacheService.releaseLock(VehicleExpiryAlertScheduler.LOCK_KEY);
    }
  }

  private async runAlerts(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const assets = await this.assetRepo.find({
      where: [
        { insuranceExpiry: Not(IsNull()) },
        { roadworthinessExpiry: Not(IsNull()) },
      ],
    });

    if (assets.length === 0) return;

    const recipients = await this.fetchRecipients();
    if (recipients.length === 0) return;

    for (const asset of assets) {
      try {
        await this.processAsset(asset, today, recipients);
      } catch (err) {
        this.logger.error(
          `Failed to process vehicle expiry alert for asset ${asset.id}`,
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
    let updated = false;

    for (const cfg of EXPIRY_CONFIGS) {
      const expiryStr = asset[cfg.expiryField];
      if (!expiryStr) continue;

      const expiry = new Date(expiryStr);
      expiry.setHours(0, 0, 0, 0);
      const daysUntil = Math.round(
        (expiry.getTime() - today.getTime()) / 86_400_000,
      );

      if (daysUntil < 0) continue;

      if (daysUntil === 30 && !asset[cfg.notified30]) {
        this.sendAlert(recipients, asset, cfg.label, expiryStr, '30 days');
        asset[cfg.notified30] = new Date();
        updated = true;
      } else if (daysUntil === 14 && !asset[cfg.notified14]) {
        this.sendAlert(recipients, asset, cfg.label, expiryStr, '14 days');
        asset[cfg.notified14] = new Date();
        updated = true;
      } else if (daysUntil === 7 && !asset[cfg.notified7]) {
        this.sendAlert(recipients, asset, cfg.label, expiryStr, '7 days');
        asset[cfg.notified7] = new Date();
        updated = true;
      } else if (daysUntil === 1 && !asset[cfg.notified1]) {
        this.sendAlert(recipients, asset, cfg.label, expiryStr, '1 day');
        asset[cfg.notified1] = new Date();
        updated = true;
      }
    }

    if (updated) {
      await this.assetRepo.save(asset);
    }
  }

  private sendAlert(
    recipients: string[],
    asset: Asset,
    docLabel: string,
    expiryDate: string,
    timing: string,
  ): void {
    const adminLoginUrl = this.configService.get<string>('ADMIN_LOGIN_URL');
    for (const email of recipients) {
      this.utilityService.sendEmailWithTemplate(
        email,
        `${docLabel} Expiring in ${timing}: ${asset.name}`,
        'asset-vehicle-expiry-alert',
        {
          assetName: asset.name,
          tagNumber: asset.tagNumber,
          category: asset.category,
          location: asset.location ?? 'Not specified',
          docLabel,
          expiryDate,
          timing,
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
