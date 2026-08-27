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
import { EmailQueueService } from '../../utility/service/email-queue.service';
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
    private readonly emailQueueService: EmailQueueService,
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
      .innerJoinAndSelect('slot.member', 'member')
      .where('programme.status = :status', {
        status: ServiceProgrammeStatusEnum.DRAFT,
      })
      .andWhere('slot.reminder_sent_at IS NULL')
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
      if (!slot.member?.email) continue;

      const serviceSlotName = [
        slot.programme.serviceSlot?.event?.name,
        slot.programme.serviceSlot?.name,
      ]
        .filter(Boolean)
        .join(' — ');
      const slotType = ServiceSlotTypeLabels[slot.type] ?? slot.type;
      const templateData = {
        memberName: slot.member.firstname,
        serviceSlotName,
        slotType,
        topic: slot.topic ?? '',
        allocatedMinutes: slot.allocatedMinutes,
      };

      if (
        slot.programme.serviceSlot?.startTime &&
        slot.programme.serviceSlot?.endTime
      ) {
        const topicSuffix = slot.topic ? `: ${slot.topic}` : '';
        const ics = buildIcsEvent({
          uid: `${slot.id}@service-programme`,
          startTime: slot.programme.serviceSlot.startTime,
          endTime: slot.programme.serviceSlot.endTime,
          summary: `${slotType}${topicSuffix} — ${serviceSlotName}`,
          description: `You're assigned to ${slotType} for ${serviceSlotName}.`,
        });
        this.emailQueueService.queueEmailWithTemplateAndAttachments(
          slot.member.email,
          `Reminder: You're on the Programme Tomorrow — ${serviceSlotName}`,
          'service-slot-reminder',
          templateData,
          [{ filename: 'service-slot.ics', content: ics }],
          undefined,
          EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
        );
      } else {
        this.emailQueueService.queueEmailWithTemplate(
          slot.member.email,
          `Reminder: You're on the Programme Tomorrow — ${serviceSlotName}`,
          'service-slot-reminder',
          templateData,
          undefined,
          EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
        );
      }

      await this.slotRepo.update(slot.id, { reminderSentAt: now });
    }
  }
}
