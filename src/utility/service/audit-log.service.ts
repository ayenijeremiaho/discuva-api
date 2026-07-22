import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { AuditLog } from '../entity/audit-log.entity';
import { PaginationResponseDto } from '../dto/pagination-response.dto';
import { UtilityService } from './utility.service';
import {
  AUDIT_LOG_QUEUE,
  AUDIT_LOG_WRITE_JOB,
} from '../processor/audit-log.processor';

export type AuditAction =
  // Auth & identity
  | 'ADMIN_CREATED'
  | 'MEMBER_SIGNED_UP'
  | 'MEMBER_LOGIN'
  | 'MEMBER_LOGOUT'
  | 'ADMIN_LOGIN'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'ADMIN_PASSWORD_RESET'
  // Member management
  | 'WORKER_PROMOTED'
  | 'WORKER_REINSTATED'
  | 'WORKER_REVOKED'
  | 'PASTOR_ASSIGNED'
  | 'PASTOR_TYPE_UPDATED'
  | 'PASTOR_REMOVED'
  | 'MEMBER_ACTIVATED'
  | 'MEMBER_DEACTIVATED'
  | 'MEMBER_UPDATED'
  | 'MEMBER_CREATED_BY_ADMIN'
  | 'MEMBER_PHOTO_UPDATED'
  | 'MEMBER_PHOTO_REMOVED'
  // Device management
  | 'DEVICE_PURGED'
  | 'DEVICE_RESET_REQUESTED'
  | 'DEVICE_RESET_COMPLETED'
  | 'EMAIL_CHANGE_REQUESTED'
  | 'EMAIL_CHANGE_COMPLETED'
  // Announcements
  | 'ANNOUNCEMENT_CREATED'
  | 'ANNOUNCEMENT_UPDATED'
  | 'ANNOUNCEMENT_DELETED'
  // Groups
  | 'GROUP_CREATED'
  | 'GROUP_UPDATED'
  | 'GROUP_DELETED'
  | 'GROUP_MEMBERS_ADDED'
  | 'GROUP_MEMBERS_REMOVED'
  // Events
  | 'EVENT_CREATED'
  | 'EVENT_UPDATED'
  | 'EVENT_DELETED'
  // Notes
  | 'NOTE_CREATED'
  | 'NOTE_UPDATED'
  | 'NOTE_DELETED'
  // Leave requests
  | 'LEAVE_APPROVED'
  | 'LEAVE_REJECTED'
  // Departments
  | 'DEPARTMENT_CREATED'
  | 'DEPARTMENT_UPDATED'
  | 'DEPARTMENT_DELETED'
  | 'DEPARTMENT_LEAD_ASSIGNED'
  | 'DEPARTMENT_LEAD_REMOVED'
  | 'BULK_DEPARTMENT_ASSIGNED'
  // Worker profiles
  | 'WORKER_PROFILE_UPDATED'
  | 'WORKER_TRAINEE_DEMOTED'
  // Classes
  | 'CLASS_TYPE_CREATED'
  | 'CLASS_TYPE_UPDATED'
  | 'CLASS_TYPE_DELETED'
  | 'CLASS_LEVEL_PROMOTED'
  | 'CLASS_CERTIFICATE_ISSUED'
  // Pastor feedback
  | 'PASTOR_FEEDBACK_SUBMITTED'
  | 'PASTOR_FEEDBACK_UPDATED'
  | 'PASTOR_FEEDBACK_RESPONDED'
  // Attendance
  | 'ATTENDANCE_ADMIN_MARKED'
  // Prayer requests & testimonies
  | 'PRAYER_REQUEST_SUBMITTED'
  | 'PRAYER_REQUEST_STATUS_UPDATED'
  | 'TESTIMONY_SUBMITTED'
  | 'PREGNANCY_CASE_CREATED'
  | 'PREGNANCY_VISIT_LOGGED'
  | 'PREGNANCY_CASE_STATUS_UPDATED'
  // Evangelism
  | 'CONVERT_CREATED'
  | 'CONVERT_STATUS_UPDATED'
  | 'CONVERT_REASSIGNED'
  | 'CONVERT_FOLLOW_UP_LOGGED'
  | 'CONVERT_LINKED_TO_MEMBER'
  // Bulk operations
  | 'BULK_WORKER_PROMOTED'
  | 'MEMBER_IMPORT_PREVIEWED'
  | 'MEMBER_IMPORT_COMMITTED'
  // Admin roles
  | 'ADMIN_ROLE_CREATED'
  | 'ADMIN_ROLE_UPDATED'
  | 'ADMIN_ROLE_DELETED'
  // Admin users
  | 'ADMIN_USER_CREATED'
  | 'ADMIN_USER_UPDATED'
  | 'ADMIN_USER_DEACTIVATED'
  // Tithe accounts
  | 'TITHE_ACCOUNT_CREATED'
  | 'TITHE_ACCOUNT_UPDATED'
  // Tithe
  | 'TITHE_BATCH_QUEUED'
  | 'TITHE_UNMATCHED_RESOLVED'
  | 'TITHE_UNMATCHED_DISMISSED'
  | 'TITHE_DISPUTE_APPROVED'
  | 'TITHE_DISPUTE_REJECTED'
  // Finance categories
  | 'FINANCE_CATEGORY_CREATED'
  | 'FINANCE_CATEGORY_UPDATED'
  // Finance requests
  | 'FINANCE_REQUEST_CREATED'
  | 'FINANCE_REQUEST_APPROVED'
  | 'FINANCE_REQUEST_REJECTED'
  | 'FINANCE_PROOF_ATTACHED'
  // Tithe payment proofs
  | 'TITHE_PROOF_SUBMITTED'
  | 'TITHE_PROOF_CONFIRMED'
  | 'TITHE_PROOF_DECLINED'
  | 'TITHE_PROOF_EXPIRED_PURGED'
  // Follow-up
  | 'FIRST_TIMER_SMS_SENT'
  // SMS
  | 'SMS_BROADCAST_SENT'
  // Church settings
  | 'CHURCH_SETTING_UPDATED'
  // Incident reports
  | 'INCIDENT_REPORT_CREATED'
  | 'INCIDENT_REPORT_STATUS_UPDATED'
  // Asset management
  | 'ASSET_CREATED'
  | 'ASSET_UPDATED'
  | 'ASSET_MAINTENANCE_SCHEDULED'
  | 'ASSET_MAINTENANCE_LOGGED'
  | 'ASSET_INVENTORY_UPDATED'
  | 'ASSET_CHECKED_OUT'
  | 'ASSET_RETURNED'
  // Finance module
  | 'FUND_CREATED'
  | 'FUND_UPDATED'
  | 'ACCOUNT_CREATED'
  | 'ACCOUNT_UPDATED'
  | 'ACCOUNTING_PERIOD_CREATED'
  | 'ACCOUNTING_PERIOD_CLOSED'
  | 'ACCOUNTING_PERIOD_REOPENED'
  | 'EXTERNAL_PAYEE_CREATED'
  | 'EXTERNAL_PAYEE_UPDATED'
  | 'JOURNAL_ENTRY_CREATED'
  | 'JOURNAL_ENTRY_APPROVED'
  | 'JOURNAL_ENTRY_VOIDED'
  | 'OFFERING_RECORDED'
  | 'OFFERING_RECONCILED'
  | 'BUDGET_CREATED'
  | 'BUDGET_DEACTIVATED'
  | 'BUDGET_REACTIVATED'
  | 'PLEDGE_CAMPAIGN_CREATED'
  | 'PLEDGE_CAMPAIGN_ACTIVE_UPDATED'
  | 'PLEDGE_CREATED'
  | 'PLEDGE_STATUS_UPDATED'
  | 'PLEDGE_CONTRIBUTION_SUBMITTED'
  | 'PLEDGE_CONTRIBUTION_CONFIRMED'
  | 'PLEDGE_CONTRIBUTION_DECLINED'
  | 'PLEDGE_AUTO_COMPLETED'
  | 'RECURRING_ENTRY_CREATED'
  | 'RECURRING_ENTRY_UPDATED'
  | 'PETTY_CASH_REQUESTED'
  | 'PETTY_CASH_APPROVED'
  | 'PETTY_CASH_REJECTED'
  | 'RECONCILIATION_CSV_UPLOADED'
  | 'RECONCILIATION_BULK_CONFIRMED'
  | 'RECONCILIATION_ROWS_POSTED'
  | 'VIRTUAL_ACCOUNT_CREATED'
  | 'VIRTUAL_ACCOUNT_DEACTIVATED'
  // Sermon archive
  | 'SERMON_CREATED'
  | 'SERMON_UPDATED'
  | 'SERMON_DELETED';

export interface AuditContext {
  actorId?: string;
  targetId?: string;
  targetEmail?: string;
  targetName?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditLogFilters {
  action?: AuditAction;
  actorId?: string;
  targetId?: string;
  targetEmail?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger('AUDIT');

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    @InjectQueue(AUDIT_LOG_QUEUE) private readonly auditQueue: Queue,
  ) {}

  log(action: AuditAction, context: AuditContext = {}): void {
    this.logger.log({ action, ...context });
    this.auditQueue.add(
      AUDIT_LOG_WRITE_JOB,
      { action, context },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  async findAll(
    page: number,
    limit: number,
    filters: AuditLogFilters = {},
  ): Promise<PaginationResponseDto<AuditLog>> {
    const qb = this.auditLogRepository
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.actor', 'actor')
      .orderBy('log.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (filters.action)
      qb.andWhere('log.action = :action', { action: filters.action });
    if (filters.actorId)
      qb.andWhere('actor.id = :actorId', { actorId: filters.actorId });
    if (filters.targetId)
      qb.andWhere('log.targetId = :targetId', { targetId: filters.targetId });
    if (filters.targetEmail)
      qb.andWhere('log.targetEmail ILIKE :targetEmail', {
        targetEmail: `%${filters.targetEmail}%`,
      });
    if (filters.dateFrom)
      qb.andWhere('log.createdAt >= :dateFrom', { dateFrom: filters.dateFrom });
    if (filters.dateTo)
      qb.andWhere('log.createdAt <= :dateTo', { dateTo: filters.dateTo });

    const [logs, total] = await qb.getManyAndCount();
    return UtilityService.createPaginationResponse(logs, page, limit, total);
  }
}
