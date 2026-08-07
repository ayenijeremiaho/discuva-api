import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { AssetCheckout } from '../entity/asset-checkout.entity';
import {
  AssetCheckoutNotification,
  CheckoutNotificationType,
} from '../entity/asset-checkout-notification.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { Member } from '../../member/entity/member.entity';
import { DepartmentLead } from '../../department/entity/department-lead.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { CacheService } from '../../utility/service/cache.service';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';

@Injectable()
export class OverdueCheckoutScheduler {
  private readonly logger = new Logger(OverdueCheckoutScheduler.name);
  private static readonly LOCK_KEY = 'lock:asset-overdue-checkouts';

  constructor(
    @InjectRepository(AssetCheckout)
    private readonly checkoutRepo: Repository<AssetCheckout>,
    @InjectRepository(AssetCheckoutNotification)
    private readonly notificationRepo: Repository<AssetCheckoutNotification>,
    @InjectRepository(Admin)
    private readonly adminRepo: Repository<Admin>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    @InjectRepository(DepartmentLead)
    private readonly departmentLeadRepo: Repository<DepartmentLead>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly utilityService: UtilityService,
    private readonly cacheService: CacheService,
    private readonly configService: ConfigService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: CHURCH_TIMEZONE })
  async dispatchOverdueReminders(): Promise<void> {
    const thresholds = this.parseThresholds();
    if (thresholds.length === 0) return;

    const acquired = await this.cacheService.acquireLock(
      OverdueCheckoutScheduler.LOCK_KEY,
      300,
    );
    if (!acquired) return;

    try {
      await forEachActiveTenant(
        this.tenantRepo,
        this.cls,
        this.txHost,
        this.logger,
        () => this.runReminders(thresholds),
      );
    } finally {
      this.cacheService.releaseLock(OverdueCheckoutScheduler.LOCK_KEY);
    }
  }

  private parseThresholds(): number[] {
    const raw = this.configService.get<string>(
      'ASSET_OVERDUE_NOTIFICATION_DAYS',
      '1,3,7',
    );
    if (!raw.trim()) return [];
    return raw
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0)
      .sort((a, b) => a - b);
  }

  private async runReminders(thresholds: number[]): Promise<void> {
    const now = new Date();

    const overdueCheckouts = await this.checkoutRepo.find({
      where: {
        returnedAt: IsNull(),
        expectedReturnAt: LessThan(now),
      },
      relations: ['asset', 'checkedOutToMember', 'checkedOutToDepartment'],
    });

    if (overdueCheckouts.length === 0) return;

    const adminEmails = await this.fetchAdminEmails();

    for (const checkout of overdueCheckouts) {
      try {
        await this.processCheckout(checkout, thresholds, now, adminEmails);
      } catch (err) {
        this.logger.error(
          `Failed to process overdue reminder for checkout ${checkout.id}`,
          err,
        );
      }
    }
  }

  private async fetchAdminEmails(): Promise<string[]> {
    const admins = await this.adminRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.member', 'm')
      .leftJoinAndSelect('a.adminRole', 'role')
      .where('a.isActive = true')
      .getMany();

    return admins
      .filter((a) =>
        a.adminRole?.permissions?.includes(
          AdminPermission.ASSET_MANAGEMENT_READ,
        ),
      )
      .map((a) => a.member?.email)
      .filter((e): e is string => !!e);
  }

  private async processCheckout(
    checkout: AssetCheckout,
    thresholds: number[],
    now: Date,
    adminEmails: string[],
  ): Promise<void> {
    const daysOverdue = Math.floor(
      (now.getTime() -
        (checkout.expectedReturnAt?.getTime() ?? now.getTime())) /
        86_400_000,
    );

    const alreadySent = await this.notificationRepo.find({
      where: {
        checkout: { id: checkout.id },
        type: CheckoutNotificationType.OVERDUE_REMINDER,
      },
      select: ['daysOverdue'],
    });
    const sentDays = new Set(alreadySent.map((n) => n.daysOverdue));

    for (const threshold of thresholds) {
      if (daysOverdue >= threshold && !sentDays.has(threshold)) {
        await this.sendOverdueNotification(checkout, threshold, adminEmails);
        await this.notificationRepo.save({
          checkout: { id: checkout.id } as any,
          type: CheckoutNotificationType.OVERDUE_REMINDER,
          daysOverdue: threshold,
        });
      }
    }
  }

  private async sendOverdueNotification(
    checkout: AssetCheckout,
    daysOverdue: number,
    adminEmails: string[],
  ): Promise<void> {
    const asset = checkout.asset;
    if (!asset) return;

    const subject = `Overdue Asset Reminder: ${asset.name} (${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue)`;
    const templateData = {
      assetName: asset.name,
      tagNumber: asset.tagNumber,
      category: asset.category,
      location: asset.location ?? 'Not specified',
      checkedOutAt: checkout.checkedOutAt.toDateString(),
      expectedReturnAt:
        checkout.expectedReturnAt?.toDateString() ?? 'Not specified',
      daysOverdue,
      purpose: checkout.purpose ?? null,
    };

    if (checkout.checkedOutToMember?.id) {
      const member = await this.memberRepo.findOne({
        where: { id: checkout.checkedOutToMember.id },
      });
      if (member?.email) {
        this.utilityService.sendEmailWithTemplate(
          member.email,
          subject,
          'asset-overdue-reminder',
          {
            ...templateData,
            recipientName: `${member.firstname} ${member.lastname}`,
          },
          undefined,
          EmailCategory.ASSET_ALERTS,
        );
      }
    }

    if (checkout.checkedOutToDepartment?.id) {
      const leads = await this.departmentLeadRepo.find({
        where: { department: { id: checkout.checkedOutToDepartment.id } },
        relations: ['workerProfile', 'workerProfile.member', 'department'],
      });

      for (const lead of leads) {
        const email = lead.workerProfile?.member?.email;
        const name = lead.workerProfile?.member
          ? `${lead.workerProfile.member.firstname} ${lead.workerProfile.member.lastname}`
          : 'Department Lead';

        if (email) {
          this.utilityService.sendEmailWithTemplate(
            email,
            subject,
            'asset-overdue-reminder',
            {
              ...templateData,
              recipientName: name,
            },
            undefined,
            EmailCategory.ASSET_ALERTS,
          );
        }
      }
    }

    for (const email of adminEmails) {
      this.utilityService.sendEmailWithTemplate(
        email,
        `[Admin] ${subject}`,
        'asset-overdue-reminder',
        {
          ...templateData,
          recipientName: 'Admin',
        },
        undefined,
        EmailCategory.ASSET_ALERTS,
      );
    }
  }
}
