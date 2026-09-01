import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { EventReminder } from '../entity/event-reminder.entity';
import { ServiceSlot } from '../entity/service-slot.entity';
import { Member } from '../../member/entity/member.entity';
import { Announcement } from '../../announcement/entity/announcement.entity';
import { Department } from '../../department/entity/department.entity';
import {
  CreateEventReminderDto,
  UpdateEventReminderDto,
} from '../dto/event-reminder.dto';
import { AnnouncementAudienceEnum } from '../../announcement/enum/announcement-audience.enum';
import { PRESET_MINUTES } from '../enum/reminder-interval-preset.enum';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { CacheService } from '../../utility/service/cache.service';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { WorkerStatusEnum } from '../../member/enums/worker-status.enum';
import {
  NotificationDispatchService,
  NotifyMemberEmail,
  NotifyMemberPush,
} from '../../utility/service/notification-dispatch.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';

@Injectable()
export class EventReminderService {
  private static readonly LOCK_KEY = 'lock:dispatch-reminders';
  private readonly logger = new Logger(EventReminderService.name);
  private readonly currencyLocale: string;

  constructor(
    @InjectRepository(EventReminder)
    private readonly reminderRepo: Repository<EventReminder>,
    @InjectRepository(ServiceSlot)
    private readonly slotRepo: Repository<ServiceSlot>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    @InjectRepository(Announcement)
    private readonly announcementRepo: Repository<Announcement>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly notificationDispatchService: NotificationDispatchService,
    private readonly cacheService: CacheService,
    private readonly config: ConfigService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {
    this.currencyLocale = this.config.get<string>('CURRENCY_LOCALE');
  }

  async create(
    slotId: string,
    dto: CreateEventReminderDto,
  ): Promise<EventReminder> {
    const slot = await this.slotRepo.findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException('Service slot not found');

    const audience = dto.audience ?? AnnouncementAudienceEnum.ALL;
    if (audience === AnnouncementAudienceEnum.DEPARTMENT && !dto.departmentId) {
      throw new BadRequestException(
        'departmentId is required for DEPARTMENT audience',
      );
    }
    if (audience === AnnouncementAudienceEnum.INDIVIDUAL) {
      throw new BadRequestException(
        'INDIVIDUAL audience is not supported for slot reminders',
      );
    }

    const fireAt = new Date(
      slot.startTime.getTime() - PRESET_MINUTES[dto.intervalPreset] * 60_000,
    );

    const reminder = this.reminderRepo.create({
      serviceSlot: slot,
      audience,
      department: dto.departmentId ? { id: dto.departmentId } : null,
      intervalPreset: dto.intervalPreset,
      enabled: true,
      lastSentAt: null,
      fireAt,
    });

    const saved = await this.reminderRepo.save(reminder);
    this.logger.log(
      `Reminder created for slot ${slotId}: ${dto.intervalPreset} before, audience: ${audience}`,
    );
    return saved;
  }

  async update(
    reminderId: string,
    dto: UpdateEventReminderDto,
  ): Promise<EventReminder> {
    const reminder = await this.getOrThrow(reminderId);

    const audience = dto.audience ?? reminder.audience;
    if (
      audience === AnnouncementAudienceEnum.DEPARTMENT &&
      dto.departmentId === undefined &&
      !reminder.department
    ) {
      throw new BadRequestException(
        'departmentId is required for DEPARTMENT audience',
      );
    }

    if (dto.intervalPreset !== undefined) {
      reminder.intervalPreset = dto.intervalPreset;
      reminder.fireAt = new Date(
        reminder.serviceSlot.startTime.getTime() -
          PRESET_MINUTES[dto.intervalPreset] * 60_000,
      );
    }
    if (dto.audience !== undefined) reminder.audience = dto.audience;
    if (dto.departmentId !== undefined) {
      reminder.department = dto.departmentId
        ? ({ id: dto.departmentId } as Department)
        : null;
    }
    if (dto.enabled !== undefined) reminder.enabled = dto.enabled;

    return this.reminderRepo.save(reminder);
  }

  async remove(reminderId: string): Promise<void> {
    const reminder = await this.getOrThrow(reminderId);
    await this.reminderRepo.remove(reminder);
  }

  async findForSlot(slotId: string): Promise<EventReminder[]> {
    return this.reminderRepo.find({
      where: { serviceSlot: { id: slotId } },
      relations: ['department'],
      order: { createdAt: 'ASC' },
    });
  }

  @Cron('*/15 * * * *')
  async dispatchDueReminders(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(
      EventReminderService.LOCK_KEY,
      270,
    );
    if (!acquired) {
      this.logger.debug(
        'Reminder dispatch skipped — another instance holds the lock',
      );
      return;
    }

    try {
      await forEachActiveTenant(
        this.tenantRepo,
        this.cls,
        this.txHost,
        this.logger,
        () => this.runReminderDispatch(),
      );
    } finally {
      this.cacheService.releaseLock(EventReminderService.LOCK_KEY);
    }
  }

  private async runReminderDispatch(): Promise<void> {
    const now = new Date();

    const toFire = await this.reminderRepo
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.serviceSlot', 'slot')
      .leftJoinAndSelect('r.department', 'dept')
      .where('r.enabled = true')
      .andWhere('r.lastSentAt IS NULL')
      .andWhere('r.fireAt <= :now', { now })
      .andWhere('slot.startTime > :now', { now })
      .getMany();

    for (const reminder of toFire) {
      await this.fireReminder(reminder, now);
    }
  }

  private async fireReminder(
    reminder: EventReminder,
    now: Date,
  ): Promise<void> {
    const slot = reminder.serviceSlot;
    const minutesBefore = PRESET_MINUTES[reminder.intervalPreset];
    const hours = minutesBefore / 60;
    const hourSuffix = hours === 1 ? '' : 's';
    const label =
      minutesBefore >= 60
        ? `${hours} hour${hourSuffix}`
        : `${minutesBefore} minutes`;

    const title = `Service Reminder: ${slot.name}`;
    const body = `This is a reminder that <strong>${slot.name}</strong> begins in ${label}. Please make your way and check in on time. God bless you!`;

    const announcement = this.announcementRepo.create({
      title,
      body,
      audience: reminder.audience,
      author: null,
      department: reminder.department,
      targetMember: null,
      publishedAt: now,
      expiresAt: slot.startTime,
    });
    await this.announcementRepo.save(announcement);

    const [recipients, recipientIds] = await Promise.all([
      this.getRecipientEmails(reminder),
      this.getRecipientMemberIds(reminder),
    ]);

    const email: NotifyMemberEmail | undefined =
      recipients.length > 0
        ? {
            to: recipients,
            subject: title,
            template: 'service-reminder',
            data: {
              slot_name: slot.name,
              time_label: label,
              start_time: slot.startTime.toLocaleTimeString(
                this.currencyLocale,
                { hour: '2-digit', minute: '2-digit' },
              ),
            },
          }
        : undefined;

    const push: NotifyMemberPush | undefined =
      recipientIds.length > 0
        ? {
            memberIds: recipientIds,
            title,
            body: `${slot.name} begins in ${label}. Please make your way and check in on time.`,
            url: '/events',
            idempotencyKey: `event-reminder:${reminder.id}`,
          }
        : undefined;

    if (email || push) {
      this.notificationDispatchService.notifyMember({
        category: EmailCategory.EVENT_REMINDER,
        email,
        push,
      });
    }

    reminder.lastSentAt = now;
    await this.reminderRepo.save(reminder);
    this.logger.log(
      `Reminder fired for slot "${slot.name}" (${reminder.intervalPreset}), ${recipients.length} recipients`,
    );
  }

  private async getRecipientEmails(reminder: EventReminder): Promise<string[]> {
    const qb = this.memberRepo
      .createQueryBuilder('m')
      .select('m.email')
      .where('m.status = :status', { status: MemberStatusEnum.ACTIVE });

    if (reminder.audience === AnnouncementAudienceEnum.WORKERS_ONLY) {
      qb.innerJoin('m.workerProfile', 'wp')
        .andWhere('wp.status = :wpStatus', {
          wpStatus: WorkerStatusEnum.ACTIVE,
        })
        .andWhere('m.role = :role', { role: MemberRoleEnum.WORKER });
    } else if (
      reminder.audience === AnnouncementAudienceEnum.DEPARTMENT &&
      reminder.department
    ) {
      qb.innerJoin('m.workerProfile', 'wp')
        .andWhere('wp.status = :wpStatus', {
          wpStatus: WorkerStatusEnum.ACTIVE,
        })
        .andWhere('wp.departmentId = :deptId', {
          deptId: reminder.department.id,
        });
    }

    const members = await qb.getMany();
    return members.map((m) => m.email);
  }

  private async getRecipientMemberIds(
    reminder: EventReminder,
  ): Promise<string[]> {
    const qb = this.memberRepo
      .createQueryBuilder('m')
      .select('m.id')
      .where('m.status = :status', { status: MemberStatusEnum.ACTIVE });

    if (reminder.audience === AnnouncementAudienceEnum.WORKERS_ONLY) {
      qb.innerJoin('m.workerProfile', 'wp')
        .andWhere('wp.status = :wpStatus', {
          wpStatus: WorkerStatusEnum.ACTIVE,
        })
        .andWhere('m.role = :role', { role: MemberRoleEnum.WORKER });
    } else if (
      reminder.audience === AnnouncementAudienceEnum.DEPARTMENT &&
      reminder.department
    ) {
      qb.innerJoin('m.workerProfile', 'wp')
        .andWhere('wp.status = :wpStatus', {
          wpStatus: WorkerStatusEnum.ACTIVE,
        })
        .andWhere('wp.departmentId = :deptId', {
          deptId: reminder.department.id,
        });
    }

    const members = await qb.getMany();
    return members.map((m) => m.id);
  }

  private async getOrThrow(id: string): Promise<EventReminder> {
    const reminder = await this.reminderRepo.findOne({
      where: { id },
      relations: ['serviceSlot', 'department'],
    });
    if (!reminder) throw new NotFoundException('Reminder not found');
    return reminder;
  }
}
