import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';
import { CacheService } from '../../utility/service/cache.service';
import { ChurchSettingsService } from '../../church-settings/service/church-settings.service';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';
import { SundaySchoolClass } from '../entity/sunday-school-class.entity';
import { SundaySchoolReportService } from '../service/sunday-school-report.service';
import { todayInChurchTz } from '../util/church-date';

export const ABSENTEE_MISSES = 3;

// Monday morning: tell each class's teacher and assistants how many members have missed several sessions in a row.
@Injectable()
export class SundaySchoolAbsenteeScheduler {
  private static readonly LOCK_KEY = 'lock:sunday-school-absentees';
  private readonly logger = new Logger(SundaySchoolAbsenteeScheduler.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(SundaySchoolClass)
    private readonly classRepo: Repository<SundaySchoolClass>,
    private readonly reports: SundaySchoolReportService,
    private readonly churchSettings: ChurchSettingsService,
    private readonly notifications: NotificationDispatchService,
    private readonly cacheService: CacheService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  @Cron('0 8 * * 1', { timeZone: CHURCH_TIMEZONE })
  async weeklyAbsenteeNudge(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(
      SundaySchoolAbsenteeScheduler.LOCK_KEY,
      600,
    );
    if (!acquired) return;
    try {
      await forEachActiveTenant(
        this.tenantRepo,
        this.cls,
        this.txHost,
        this.logger,
        async () => {
          await this.nudgeTeachers();
        },
      );
    } finally {
      this.cacheService.releaseLock(SundaySchoolAbsenteeScheduler.LOCK_KEY);
    }
  }

  async nudgeTeachers(): Promise<number> {
    if (!(await this.churchSettings.isEnabled('sunday_school'))) return 0;
    const absentees = await this.reports.absentees(undefined, ABSENTEE_MISSES);
    if (!absentees.length) return 0;
    const perClass = new Map<string, number>();
    for (const a of absentees)
      perClass.set(a.classId, (perClass.get(a.classId) ?? 0) + 1);
    const classes = await this.classRepo.find({
      where: [...perClass.keys()].map((id) => ({ id })),
      relations: ['teacher', 'assistants'],
    });
    const week = todayInChurchTz();
    let sent = 0;
    for (const cls of classes) {
      const memberIds = [
        ...new Set(
          [cls.teacher?.id, ...(cls.assistants ?? []).map((a) => a.id)].filter(
            (id): id is string => !!id,
          ),
        ),
      ];
      if (!memberIds.length) continue;
      await this.notifications.notifyMember({
        category: EmailCategory.SUNDAY_SCHOOL_ATTENDANCE,
        push: {
          memberIds,
          key: PushNotificationKey.SUNDAY_SCHOOL_ABSENTEES,
          vars: {
            class_name: cls.name,
            count: String(perClass.get(cls.id)),
            misses: String(ABSENTEE_MISSES),
          },
          idempotencyKey: `sunday-school-absentees:${cls.id}:${week}`,
        },
      });
      sent++;
    }
    this.logger.log(`Absentee nudges sent for ${sent} class(es)`);
    return sent;
  }
}
