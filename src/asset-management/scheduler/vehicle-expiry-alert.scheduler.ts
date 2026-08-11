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

interface ExpiryConfig {
  expiryField: 'insuranceExpiry' | 'roadworthinessExpiry';
  label: string;
  notifiedField:
    | 'insuranceNotifiedThresholds'
    | 'roadworthinessNotifiedThresholds';
}

const EXPIRY_CONFIGS: ExpiryConfig[] = [
  {
    expiryField: 'insuranceExpiry',
    label: 'Insurance',
    notifiedField: 'insuranceNotifiedThresholds',
  },
  {
    expiryField: 'roadworthinessExpiry',
    label: 'Roadworthiness',
    notifiedField: 'roadworthinessNotifiedThresholds',
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
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly utilityService: UtilityService,
    private readonly cacheService: CacheService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly reminderSettingsService: ReminderSettingsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: CHURCH_TIMEZONE })
  async dispatchVehicleExpiryAlerts(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(
      VehicleExpiryAlertScheduler.LOCK_KEY,
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
      this.cacheService.releaseLock(VehicleExpiryAlertScheduler.LOCK_KEY);
    }
  }

  private async runAlerts(): Promise<void> {
    const { enabled, thresholds } =
      await this.reminderSettingsService.getConfig(
        ReminderSettingKey.VEHICLE_EXPIRY,
      );
    if (!enabled) return;

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
        await this.processAsset(asset, today, recipients, thresholds);
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
    thresholds: number[],
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

      const notified = asset[cfg.notifiedField] ?? [];
      if (!thresholds.includes(daysUntil) || notified.includes(daysUntil)) {
        continue;
      }

      const timing = `${daysUntil} day${daysUntil === 1 ? '' : 's'}`;
      this.sendAlert(recipients, asset, cfg.label, expiryStr, timing);
      asset[cfg.notifiedField] = [...notified, daysUntil];
      updated = true;
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
