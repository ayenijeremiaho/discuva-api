import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Department } from '../../department/entity/department.entity';
import { DepartmentLead } from '../../department/entity/department-lead.entity';
import { DepartmentLeadTypeEnum } from '../../department/enums/department-lead-type.enum';
import { PastorFeedback } from '../entity/pastor-feedback.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';

@Injectable()
export class PastorFeedbackReminderScheduler {
  private readonly logger = new Logger(PastorFeedbackReminderScheduler.name);

  constructor(
    @InjectRepository(Department)
    private readonly departmentRepo: Repository<Department>,
    @InjectRepository(DepartmentLead)
    private readonly leadRepo: Repository<DepartmentLead>,
    @InjectRepository(PastorFeedback)
    private readonly feedbackRepo: Repository<PastorFeedback>,
    private readonly utilityService: UtilityService,
    private readonly pushService: PushNotificationService,
  ) {}

  // Monday 9am — the "has last week's feedback been submitted" condition is
  // row-absence, so no reminderSent flag is needed (unlike PrayerReminderScheduler,
  // whose rows pre-exist and just get a boolean flipped).
  @Cron('0 9 * * 1', { timeZone: CHURCH_TIMEZONE })
  async sendReminders(): Promise<void> {
    const weekOf = this.toDateStr(this.previousWeekMonday(new Date()));

    const departments = await this.departmentRepo.find();
    if (!departments.length) return;

    const submitted = await this.feedbackRepo.find({
      where: { weekOf },
      relations: ['department'],
    });
    const submittedDeptIds = new Set(submitted.map((f) => f.department.id));
    const pending = departments.filter((d) => !submittedDeptIds.has(d.id));

    for (const department of pending) {
      try {
        await this.remindDepartment(department, weekOf);
      } catch (err) {
        this.logger.error(
          `Failed to send feedback reminder for department ${department.id}: ${err}`,
        );
      }
    }
  }

  private async remindDepartment(
    department: Department,
    weekOf: string,
  ): Promise<void> {
    const leads = await this.leadRepo.find({
      where: { department: { id: department.id } },
      relations: ['workerProfile', 'workerProfile.member'],
    });
    // Prefer HOD, fall back to the Assistant (D_HOD) — remind whichever lead exists.
    const target =
      leads.find((l) => l.leadType === DepartmentLeadTypeEnum.HOD) ?? leads[0];
    if (!target) return; // no HOD/D_HOD assigned — nobody to remind

    const member = target.workerProfile.member;
    this.utilityService.sendEmailWithTemplate(
      member.email,
      `Weekly Feedback Reminder — ${department.name}`,
      'pastor-feedback-reminder',
      { name: member.firstname, departmentName: department.name, weekOf },
      undefined,
      EmailCategory.PASTOR_FEEDBACK,
    );
    this.pushService.dispatchToMemberIds([member.id], {
      idempotencyKey: `pastor-feedback-reminder:${department.id}:${weekOf}`,
      title: 'Weekly Feedback Reminder',
      body: `Don't forget to submit ${department.name}'s feedback for the week of ${weekOf}.`,
      url: '/pastor-feedback',
    });
  }

  private previousWeekMonday(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diffToMonday = (day + 6) % 7;
    d.setDate(d.getDate() - diffToMonday - 7);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private toDateStr(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
}
