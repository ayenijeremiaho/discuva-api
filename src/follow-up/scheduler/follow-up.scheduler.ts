import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { FollowUpTask } from '../entity/follow-up-task.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { FollowUpTaskStatusEnum } from '../enums/follow-up.enum';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { EmailQueueService } from '../../utility/service/email-queue.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { CacheService } from '../../utility/service/cache.service';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';

const OPEN_STATUSES = [
  FollowUpTaskStatusEnum.PENDING,
  FollowUpTaskStatusEnum.IN_PROGRESS,
];
const ESCALATION_LOCK = 'lock:follow-up-escalation';
const STALE_LOCK = 'lock:follow-up-stale';

@Injectable()
export class FollowUpScheduler {
  private readonly logger = new Logger(FollowUpScheduler.name);
  private readonly churchName: string;
  private readonly staleDays: number;

  constructor(
    @InjectRepository(FollowUpTask)
    private readonly taskRepo: Repository<FollowUpTask>,
    @InjectRepository(Admin)
    private readonly adminRepo: Repository<Admin>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly emailQueueService: EmailQueueService,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {
    this.churchName = this.configService.get<string>('CHURCH_NAME');
    this.staleDays = this.configService.get<number>('FOLLOW_UP_STALE_DAYS', 7);
  }

  @Cron('0 8 * * *', { timeZone: CHURCH_TIMEZONE })
  async escalateOverdueTasks(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(ESCALATION_LOCK, 270);
    if (!acquired) {
      this.logger.debug(
        'Follow-up escalation skipped — another instance holds the lock',
      );
      return;
    }
    try {
      await forEachActiveTenant(
        this.tenantRepo,
        this.cls,
        this.txHost,
        this.logger,
        () => this.runEscalation(),
      );
    } finally {
      this.cacheService.releaseLock(ESCALATION_LOCK);
    }
  }

  private async runEscalation(): Promise<void> {
    const overdueTasks = await this.taskRepo
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.firstTimer', 'ft')
      .leftJoinAndSelect('task.assignedTo', 'wp')
      .leftJoinAndSelect('wp.member', 'm')
      .where('task.status IN (:...statuses)', { statuses: OPEN_STATUSES })
      .andWhere('task.dueDate < :now', { now: new Date() })
      .andWhere('task.dueDate IS NOT NULL')
      .getMany();

    if (!overdueTasks.length) {
      this.logger.log('No overdue follow-up tasks found');
      return;
    }

    this.logger.log(`Found ${overdueTasks.length} overdue follow-up task(s)`);

    const tasksByWorker = new Map<
      string,
      {
        workerName: string;
        workerEmail: string;
        tasks: { name: string; phone: string; dueDate: string }[];
      }
    >();

    for (const task of overdueTasks) {
      const member = task.assignedTo?.member;
      if (!member?.email) continue;

      if (!tasksByWorker.has(member.id)) {
        tasksByWorker.set(member.id, {
          workerName: member.firstname,
          workerEmail: member.email,
          tasks: [],
        });
      }

      tasksByWorker.get(member.id)!.tasks.push({
        name: task.firstTimer
          ? `${task.firstTimer.firstname} ${task.firstTimer.lastname}`
          : 'Online non-responder',
        phone: task.firstTimer?.phone ?? 'N/A',
        dueDate: task.dueDate ? new Date(task.dueDate).toDateString() : 'N/A',
      });
    }

    for (const [, data] of tasksByWorker) {
      this.emailQueueService.queueEmailWithTemplate(
        data.workerEmail,
        `Action Required: ${data.tasks.length} Overdue Follow-Up Task(s)`,
        'follow-up-overdue-worker',
        {
          workerName: data.workerName,
          count: data.tasks.length,
          multiple: data.tasks.length > 1,
          tasks: data.tasks,
          churchName: this.churchName,
        },
        undefined,
        EmailCategory.FOLLOW_UP,
      );
    }

    const followUpAdmins = await this.adminRepo
      .createQueryBuilder('a')
      .innerJoinAndSelect('a.member', 'm')
      .innerJoinAndSelect('a.adminRole', 'r')
      .where('a.isActive = true')
      .andWhere(':perm = ANY(r.permissions)', {
        perm: AdminPermission.FOLLOW_UP_WRITE,
      })
      .getMany();

    for (const admin of followUpAdmins) {
      if (!admin.member?.email) continue;
      this.emailQueueService.queueEmailWithTemplate(
        admin.member.email,
        `Follow-Up Alert: ${overdueTasks.length} Overdue Task(s) Need Attention`,
        'follow-up-overdue-admin',
        {
          adminName: admin.member.firstname,
          count: overdueTasks.length,
          multiple: overdueTasks.length > 1,
          churchName: this.churchName,
        },
        undefined,
        EmailCategory.FOLLOW_UP,
      );
    }

    this.logger.log(
      `Overdue escalation: ${tasksByWorker.size} worker email(s), ${followUpAdmins.length} admin email(s)`,
    );
  }

  @Cron('0 9 * * *', { timeZone: CHURCH_TIMEZONE })
  async notifyInactiveTasks(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(STALE_LOCK, 270);
    if (!acquired) {
      this.logger.debug(
        'Stale task check skipped — another instance holds the lock',
      );
      return;
    }
    try {
      await forEachActiveTenant(
        this.tenantRepo,
        this.cls,
        this.txHost,
        this.logger,
        () => this.runStaleCheck(),
      );
    } finally {
      this.cacheService.releaseLock(STALE_LOCK);
    }
  }

  private async runStaleCheck(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.staleDays);

    const count = await this.taskRepo
      .createQueryBuilder('task')
      .where('task.status IN (:...statuses)', { statuses: OPEN_STATUSES })
      .andWhere('task.lastActivityAt < :cutoff', { cutoff })
      .getCount();

    if (!count) {
      this.logger.log('No inactive follow-up tasks found');
      return;
    }

    this.logger.log(
      `Found ${count} follow-up task(s) inactive for ${this.staleDays}+ day(s)`,
    );

    const admins = await this.adminRepo
      .createQueryBuilder('a')
      .innerJoinAndSelect('a.member', 'm')
      .innerJoinAndSelect('a.adminRole', 'r')
      .where('a.isActive = true')
      .andWhere(':perm = ANY(r.permissions)', {
        perm: AdminPermission.FOLLOW_UP_WRITE,
      })
      .getMany();

    for (const admin of admins) {
      if (!admin.member?.email) continue;
      this.emailQueueService.queueEmailWithTemplate(
        admin.member.email,
        `Follow-Up Alert: ${count} Task(s) With No Activity for ${this.staleDays}+ Day(s)`,
        'follow-up-stale-admin',
        {
          adminName: admin.member.firstname,
          count,
          staleDays: this.staleDays,
          churchName: this.churchName,
        },
        undefined,
        EmailCategory.FOLLOW_UP,
      );
    }

    this.logger.log(`Stale task alert sent to ${admins.length} admin(s)`);
  }
}
