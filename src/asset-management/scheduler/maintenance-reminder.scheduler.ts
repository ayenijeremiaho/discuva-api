import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { MaintenanceSchedule } from '../entity/maintenance-schedule.entity';
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
export class MaintenanceReminderScheduler {
  private readonly logger = new Logger(MaintenanceReminderScheduler.name);
  private static readonly LOCK_KEY = 'lock:asset-maintenance-reminders';

  constructor(
    @InjectRepository(MaintenanceSchedule)
    private readonly scheduleRepo: Repository<MaintenanceSchedule>,
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
  async dispatchMaintenanceReminders(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(
      MaintenanceReminderScheduler.LOCK_KEY,
      300,
    );
    if (!acquired) return;

    try {
      await forEachActiveTenant(
        this.tenantRepo,
        this.cls,
        this.txHost,
        this.logger,
        () => this.runReminders(),
      );
    } finally {
      this.cacheService.releaseLock(MaintenanceReminderScheduler.LOCK_KEY);
    }
  }

  private async runReminders(): Promise<void> {
    const { enabled, thresholds } =
      await this.reminderSettingsService.getConfig(
        ReminderSettingKey.ASSET_MAINTENANCE,
      );
    if (!enabled) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const schedules = await this.scheduleRepo
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.asset', 'a')
      .where('a.maintenanceEnabled = true')
      .getMany();

    if (schedules.length === 0) return;

    const recipients = await this.fetchRecipients();
    if (recipients.length === 0) return;

    for (const schedule of schedules) {
      try {
        await this.processSchedule(schedule, today, recipients, thresholds);
      } catch (err) {
        this.logger.error(
          `Failed to process reminders for schedule ${schedule.id}`,
          err,
        );
      }
    }
  }

  private async processSchedule(
    schedule: MaintenanceSchedule,
    today: Date,
    recipients: string[],
    thresholds: number[],
  ): Promise<void> {
    const nextDue = new Date(schedule.nextDueAt);
    nextDue.setHours(0, 0, 0, 0);
    const daysUntilDue = Math.round(
      (nextDue.getTime() - today.getTime()) / 86_400_000,
    );

    let updated = false;
    const notifiedThresholds = schedule.notifiedThresholds ?? [];

    if (
      daysUntilDue >= 0 &&
      thresholds.includes(daysUntilDue) &&
      !notifiedThresholds.includes(daysUntilDue)
    ) {
      this.sendReminder(
        recipients,
        schedule,
        MaintenanceReminderScheduler.timingLabel(daysUntilDue),
      );
      schedule.notifiedThresholds = [...notifiedThresholds, daysUntilDue];
      updated = true;
    } else if (daysUntilDue < 0) {
      const overdueNotifiedToday =
        schedule.lastOverdueNotifiedAt?.toISOString().split('T')[0] ===
        today.toISOString().split('T')[0];

      if (!overdueNotifiedToday) {
        this.sendOverdueReminder(recipients, schedule, Math.abs(daysUntilDue));
        schedule.lastOverdueNotifiedAt = new Date();
        updated = true;
      }
    }

    if (updated) {
      await this.scheduleRepo.save(schedule);
    }
  }

  private sendReminder(
    recipients: string[],
    schedule: MaintenanceSchedule,
    timing: string,
  ): void {
    for (const email of recipients) {
      this.utilityService.sendEmailWithTemplate(
        email,
        `Asset Maintenance Due in ${timing}: ${schedule.asset.name}`,
        'asset-maintenance-reminder',
        {
          assetName: schedule.asset.name,
          tagNumber: schedule.asset.tagNumber,
          category: schedule.asset.category,
          location: schedule.asset.location ?? 'Not specified',
          nextDueAt: schedule.nextDueAt,
          timing,
          isOverdue: false,
        },
        undefined,
        EmailCategory.ASSET_ALERTS,
      );
    }
  }

  private sendOverdueReminder(
    recipients: string[],
    schedule: MaintenanceSchedule,
    daysOverdue: number,
  ): void {
    for (const email of recipients) {
      this.utilityService.sendEmailWithTemplate(
        email,
        `Overdue: Asset Maintenance for ${schedule.asset.name} (${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue)`,
        'asset-maintenance-reminder',
        {
          assetName: schedule.asset.name,
          tagNumber: schedule.asset.tagNumber,
          category: schedule.asset.category,
          location: schedule.asset.location ?? 'Not specified',
          nextDueAt: schedule.nextDueAt,
          timing: `${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue`,
          isOverdue: true,
          daysOverdue,
        },
        undefined,
        EmailCategory.ASSET_ALERTS,
      );
    }
  }

  private static timingLabel(daysUntilDue: number): string {
    if (daysUntilDue === 0) return 'due today';
    return `${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`;
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
