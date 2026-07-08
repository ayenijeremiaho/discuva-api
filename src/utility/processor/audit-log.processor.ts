import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../entity/audit-log.entity';
import { Member } from '../../member/entity/member.entity';
import { AuditAction, AuditContext } from '../service/audit-log.service';

export const AUDIT_LOG_QUEUE = 'audit-log';
export const AUDIT_LOG_WRITE_JOB = 'write';

@Processor(AUDIT_LOG_QUEUE)
export class AuditLogProcessor {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  @Process(AUDIT_LOG_WRITE_JOB)
  async handle(job: Job<{ action: AuditAction; context: AuditContext }>) {
    const { action, context } = job.data;
    await this.auditLogRepository.save({
      action,
      actor: context.actorId ? ({ id: context.actorId } as Member) : null,
      targetId: context.targetId ?? null,
      targetEmail: context.targetEmail ?? null,
      targetName: context.targetName ?? null,
      metadata: context.metadata ?? null,
    });
  }
}
