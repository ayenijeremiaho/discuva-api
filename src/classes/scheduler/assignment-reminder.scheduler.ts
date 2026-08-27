import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Assignment } from '../entity/assignment.entity';
import { ClassEnrollment } from '../entity/class-enrollment.entity';
import { EnrollmentStatusEnum } from '../enum/enrollment-status.enum';
import { UtilityService } from '../../utility/service/utility.service';
import { CacheService } from '../../utility/service/cache.service';
import { SmsService } from '../../sms/service/sms.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { ReminderSettingsService } from '../../reminder-settings/service/reminder-settings.service';
import { ReminderSettingKey } from '../../reminder-settings/enum/reminder-setting-key.enum';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';

// Mirrors PledgeReminderScheduler's structure — see its own comments for
// why: daily cron, forEachActiveTenant loop, threshold/cache-dedup pattern.
// The one real difference from every other reminder in this app: email
// always sends (member.email or guest.email — both exist for every
// enrollee type), SMS is an additional tenant-configurable opt-in only
// sent when a phone number is on file, per ReminderSettingsService's new
// smsEnabled flag.
@Injectable()
export class AssignmentReminderScheduler {
  private static readonly LOCK_KEY = 'lock:assignment-reminders';
  private readonly logger = new Logger(AssignmentReminderScheduler.name);

  constructor(
    @InjectRepository(Assignment)
    private readonly assignmentRepo: Repository<Assignment>,
    @InjectRepository(ClassEnrollment)
    private readonly enrollmentRepo: Repository<ClassEnrollment>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly utilityService: UtilityService,
    private readonly cacheService: CacheService,
    private readonly smsService: SmsService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly reminderSettingsService: ReminderSettingsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: CHURCH_TIMEZONE })
  async dispatchAssignmentReminders(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(
      AssignmentReminderScheduler.LOCK_KEY,
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
      this.cacheService.releaseLock(AssignmentReminderScheduler.LOCK_KEY);
    }
  }

  private async runReminders(): Promise<void> {
    const { enabled, thresholds, smsEnabled } =
      await this.reminderSettingsService.getConfig(
        ReminderSettingKey.ASSIGNMENT_DUE,
      );
    if (!enabled) return;

    const assignments = await this.assignmentRepo.find({
      where: { isPublished: true },
      relations: ['churchClass'],
    });
    const withDueDate = assignments.filter((a) => a.dueDate);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const assignment of withDueDate) {
      try {
        await this.processAssignment(assignment, today, thresholds, smsEnabled);
      } catch (err) {
        this.logger.error(
          `Failed to process assignment reminder for assignment ${assignment.id}`,
          err,
        );
      }
    }
  }

  private async processAssignment(
    assignment: Assignment,
    today: Date,
    thresholds: number[],
    smsEnabled: boolean,
  ): Promise<void> {
    const dueDate = new Date(assignment.dueDate!);
    dueDate.setHours(0, 0, 0, 0);
    const diffDays = Math.round(
      (dueDate.getTime() - today.getTime()) / 86_400_000,
    );
    if (!thresholds.includes(diffDays)) return;

    // Enrollees of this assignment's class who have not yet submitted.
    const pending = await this.enrollmentRepo
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.member', 'member')
      .leftJoinAndSelect('e.guest', 'guest')
      .leftJoin(
        'assignment_submissions',
        's',
        's.assignment_id = :assignmentId AND (s.member_id = e.member_id OR s.class_enrollment_id = e.id)',
        { assignmentId: assignment.id },
      )
      .where('e.church_class_id = :classId', {
        classId: assignment.churchClass.id,
      })
      .andWhere('e.status = :status', {
        status: EnrollmentStatusEnum.IN_PROGRESS,
      })
      .andWhere('s.id IS NULL')
      .getMany();

    for (const enrollment of pending) {
      await this.remindEnrollment(enrollment, assignment, diffDays, smsEnabled);
    }
  }

  private async remindEnrollment(
    enrollment: ClassEnrollment,
    assignment: Assignment,
    diffDays: number,
    smsEnabled: boolean,
  ): Promise<void> {
    const enrolleeId = enrollment.member?.id ?? enrollment.guest!.id;
    const cacheKey = `assignment-reminder:${assignment.id}:${enrolleeId}:${diffDays}`;
    const alreadySent = await this.cacheService.get(cacheKey);
    if (alreadySent) return;

    const firstName = UtilityService.capitalizeFirstLetter(
      enrollment.member?.firstname ?? enrollment.guest!.firstName,
    );
    const email = enrollment.member?.email ?? enrollment.guest!.email;
    const phone = enrollment.member?.phoneNumber ?? enrollment.guest?.phone;
    const status = AssignmentReminderScheduler.statusForDiffDays(diffDays);
    const portalUrl = await this.utilityService.resolveMemberUrl(
      enrollment.member
        ? `/classes/${assignment.churchClass.id}`
        : `/classes/guest/${enrollment.id}`,
    );

    this.utilityService.sendEmailWithTemplate(
      email,
      `${firstName}, Your Assignment for ${assignment.churchClass.name} Is ${AssignmentReminderScheduler.subjectLabel(diffDays)}`,
      'assignment-due-reminder',
      {
        name: firstName,
        className: assignment.churchClass.name,
        assignmentTitle: assignment.title,
        dueDate: assignment.dueDate!.toISOString().slice(0, 10),
        status,
        portalUrl,
      },
      undefined,
      EmailCategory.ASSIGNMENT_REMINDER,
    );

    if (smsEnabled && phone) {
      this.smsService.send(
        [phone],
        `Reminder: your assignment for ${assignment.churchClass.name} is ${status}. Check your email for the link.`,
      );
    }

    this.cacheService.set(cacheKey, '1', 86_400 * 2);
  }

  private static statusForDiffDays(diffDays: number): string {
    if (diffDays < 0) {
      const days = Math.abs(diffDays);
      return `overdue by ${days} day${days === 1 ? '' : 's'}`;
    }
    if (diffDays === 0) return 'due today';
    return `due in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
  }

  private static subjectLabel(diffDays: number): string {
    if (diffDays < 0) {
      const days = Math.abs(diffDays);
      return `Overdue by ${days} Day${days === 1 ? '' : 's'}`;
    }
    if (diffDays === 0) return 'Due Today';
    return `Due in ${diffDays} Day${diffDays === 1 ? '' : 's'}`;
  }
}
