import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { ServiceProgrammeSlot } from '../entity/service-programme-slot.entity';
import { ServiceProgrammeStatusEnum } from '../enum/service-programme-status.enum';
import { ServiceSlotTypeLabels } from '../enum/service-slot-type.enum';
import {
  NotificationDispatchService,
  NotifyMemberEmail,
} from '../../utility/service/notification-dispatch.service';
import { DepartmentAccessService } from '../../department/service/department-access.service';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { CacheService } from '../../utility/service/cache.service';
import { buildIcsEvent } from '../../utility/util/ics-builder';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';

const REMINDER_LOCK = 'lock:service-programme-reminder';
const REMINDER_WINDOW_START_HOURS = 24;
const REMINDER_WINDOW_END_HOURS = 48;

@Injectable()
export class ServiceProgrammeReminderScheduler {
  private readonly logger = new Logger(ServiceProgrammeReminderScheduler.name);

  constructor(
    @InjectRepository(ServiceProgrammeSlot)
    private readonly slotRepo: Repository<ServiceProgrammeSlot>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly notificationDispatchService: NotificationDispatchService,
    private readonly departmentAccessService: DepartmentAccessService,
    private readonly cacheService: CacheService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  @Cron('0 9 * * *', { timeZone: CHURCH_TIMEZONE })
  async sendUpcomingSlotReminders(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(REMINDER_LOCK, 270);
    if (!acquired) {
      this.logger.debug(
        'Service programme reminder run skipped — another instance holds the lock',
      );
      return;
    }
    try {
      await forEachActiveTenant(
        this.tenantRepo,
        this.cls,
        this.txHost,
        this.logger,
        () => this.runReminders(),
      );
    } finally {
      this.cacheService.releaseLock(REMINDER_LOCK);
    }
  }

  private async runReminders(): Promise<void> {
    const now = new Date();
    const windowStart = new Date(
      now.getTime() + REMINDER_WINDOW_START_HOURS * 60 * 60 * 1000,
    );
    const windowEnd = new Date(
      now.getTime() + REMINDER_WINDOW_END_HOURS * 60 * 60 * 1000,
    );

    const slots = await this.slotRepo
      .createQueryBuilder('slot')
      .innerJoinAndSelect('slot.programme', 'programme')
      .innerJoinAndSelect('programme.serviceSlot', 'serviceSlot')
      .leftJoinAndSelect('serviceSlot.event', 'event')
      .leftJoinAndSelect('slot.member', 'member')
      .leftJoinAndSelect('slot.department', 'department')
      .where('programme.status = :status', {
        status: ServiceProgrammeStatusEnum.DRAFT,
      })
      .andWhere('slot.reminder_sent_at IS NULL')
      .andWhere(
        '(slot.member_id IS NOT NULL OR slot.department_id IS NOT NULL)',
      )
      .andWhere('serviceSlot.start_time BETWEEN :windowStart AND :windowEnd', {
        windowStart,
        windowEnd,
      })
      .getMany();

    if (!slots.length) {
      this.logger.log('No upcoming service-programme slots need a reminder');
      return;
    }

    this.logger.log(`Sending ${slots.length} service-programme reminder(s)`);

    for (const slot of slots) {
      try {
        if (slot.member) await this.remindMember(slot);
        else if (slot.department) await this.remindDepartment(slot);
      } catch (err) {
        this.logger.warn(
          `Reminder for slot ${slot.id} failed: ${(err as Error).message}`,
        );
        continue;
      }
      await this.slotRepo.update(slot.id, { reminderSentAt: now });
    }
  }

  private describe(slot: ServiceProgrammeSlot) {
    const serviceSlotName = [
      slot.programme.serviceSlot?.event?.name,
      slot.programme.serviceSlot?.name,
    ]
      .filter(Boolean)
      .join(' — ');
    return {
      serviceSlotName,
      slotType: ServiceSlotTypeLabels[slot.type] ?? slot.type,
    };
  }

  private reminderEmail(
    slot: ServiceProgrammeSlot,
    to: { id: string; firstname: string; email: string },
    teamName?: string,
  ): NotifyMemberEmail {
    const { serviceSlotName, slotType } = this.describe(slot);
    const label = teamName ? `${slotType} (${teamName})` : slotType;
    const email: NotifyMemberEmail = {
      to: to.email,
      recipientMemberId: to.id,
      subject: `Reminder: ${teamName ?? "You're"} on the Programme Tomorrow — ${serviceSlotName}`,
      template: 'service-slot-reminder',
      data: {
        memberName: to.firstname,
        serviceSlotName,
        slotType: label,
        topic: slot.topic ?? '',
        allocatedMinutes: slot.allocatedMinutes,
      },
    };
    const serviceSlot = slot.programme.serviceSlot;
    if (serviceSlot?.startTime && serviceSlot?.endTime) {
      const topicSuffix = slot.topic ? `: ${slot.topic}` : '';
      email.attachments = [
        {
          filename: 'service-slot.ics',
          content: buildIcsEvent({
            uid: `${slot.id}@service-programme`,
            startTime: serviceSlot.startTime,
            endTime: serviceSlot.endTime,
            summary: `${label}${topicSuffix} — ${serviceSlotName}`,
            description: `${teamName ?? "You're"} assigned to ${slotType} for ${serviceSlotName}.`,
          }),
        },
      ];
    }
    return email;
  }

  private async remindMember(slot: ServiceProgrammeSlot): Promise<void> {
    const member = slot.member!;
    const { serviceSlotName, slotType } = this.describe(slot);
    await this.notificationDispatchService.notifyMember({
      category: EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
      email: member.email ? this.reminderEmail(slot, member) : undefined,
      push: {
        memberIds: [member.id],
        key: PushNotificationKey.SERVICE_SLOT_REMINDER,
        vars: {
          slot_type: slotType,
          service_name: serviceSlotName,
          team_suffix: '',
        },
        idempotencyKey: `service-slot-reminder:${slot.id}:${member.id}`,
      },
    });
  }

  // Every member of the department gets the push; the HOD also gets the email with the calendar invite.
  private async remindDepartment(slot: ServiceProgrammeSlot): Promise<void> {
    const department = slot.department!;
    const [memberIds, hod] = await Promise.all([
      this.departmentAccessService.findMemberIdsInDepartment(department.id),
      this.departmentAccessService.findHeadOfDepartment(department.id),
    ]);
    const recipients = new Set(memberIds);
    if (hod) recipients.add(hod.id);
    if (!recipients.size) return;

    const { serviceSlotName, slotType } = this.describe(slot);
    await this.notificationDispatchService.notifyMember({
      category: EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
      email: hod?.email
        ? this.reminderEmail(
            slot,
            { id: hod.id, firstname: hod.firstname, email: hod.email },
            department.name,
          )
        : undefined,
      push: {
        memberIds: [...recipients],
        key: PushNotificationKey.SERVICE_SLOT_REMINDER,
        vars: {
          slot_type: slotType,
          service_name: serviceSlotName,
          team_suffix: ` with ${department.name}`,
        },
        idempotencyKey: `service-slot-reminder:${slot.id}:${department.id}`,
      },
    });
  }
}
