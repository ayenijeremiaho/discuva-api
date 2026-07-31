import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { AuditLog } from '../entity/audit-log.entity';
import { Member } from '../../member/entity/member.entity';
import { AuditAction, AuditContext } from '../service/audit-log.service';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { TenantJobEnvelope } from '../../tenant/utility/job-envelope';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';

export const AUDIT_LOG_QUEUE = 'audit-log';
export const AUDIT_LOG_WRITE_JOB = 'write';

export interface AuditLogJobData extends TenantJobEnvelope {
  action: AuditAction;
  context: AuditContext;
}

@Processor(AUDIT_LOG_QUEUE)
export class AuditLogProcessor {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  @Process(AUDIT_LOG_WRITE_JOB)
  async handle(job: Job<AuditLogJobData>) {
    return runInTenantContext(this.cls, this.txHost, job.data, async () => {
      const { action, context } = job.data;
      await this.auditLogRepository.save({
        action,
        actor: context.actorId ? ({ id: context.actorId } as Member) : null,
        targetId: context.targetId ?? null,
        targetEmail: context.targetEmail ?? null,
        targetName: context.targetName ?? null,
        metadata: context.metadata ?? null,
      });
    });
  }
}
