import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  OnQueueFailed,
  OnQueueStalled,
  Process,
  Processor,
} from '@nestjs/bull';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { TitheUploadBatch } from '../entity/tithe-upload-batch.entity';
import { TitheRecord } from '../entity/tithe-record.entity';
import { TitheUnmatchedRecord } from '../entity/tithe-unmatched-record.entity';
import { TitheDisputeRecord } from '../entity/tithe-dispute-record.entity';
import { Member } from '../../member/entity/member.entity';
import { TitheBatchStatus } from '../enum/tithe.enum';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { TenantJobEnvelope } from '../../tenant/utility/job-envelope';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';

export const TITHE_QUEUE = 'tithe';
export const TITHE_PROCESS_JOB = 'process-batch';

export interface TitheProcessJobData extends TenantJobEnvelope {
  batchId: string;
  rows: TitheRow[];
}

export interface TitheRow {
  email: string;
  amount: number;
  paymentDate: string;
  reference?: string;
  bankName?: string;
}

@Processor(TITHE_QUEUE)
export class TitheProcessor implements OnApplicationBootstrap {
  private readonly logger = new Logger(TitheProcessor.name);

  constructor(
    @InjectRepository(TitheUploadBatch)
    private readonly batchRepo: Repository<TitheUploadBatch>,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  @Process(TITHE_PROCESS_JOB)
  async handleBatch(job: Job<TitheProcessJobData>): Promise<void> {
    return runInTenantContext(this.cls, this.txHost, job.data, () =>
      this.doHandleBatch(job.data),
    );
  }

  private async doHandleBatch(data: TitheProcessJobData): Promise<void> {
    const { batchId, rows } = data;
    const batch = await this.batchRepo.findOne({ where: { id: batchId } });
    if (!batch) return;

    await this.batchRepo.update(batchId, {
      status: TitheBatchStatus.PROCESSING,
    });

    let matched = 0;
    let unmatched = 0;
    let disputed = 0;

    try {
      // txHost.withTransaction joins the tenant transaction runInTenantContext
      // already opened (Propagation.Required), rather than opening a second,
      // disconnected one that wouldn't see the SET LOCAL search_path — see
      // src/tenant/utility/run-in-tenant-context.ts.
      await this.txHost.withTransaction(async () => {
        const manager = this.txHost.tx;
        matched = 0;
        unmatched = 0;
        disputed = 0;

        for (const row of rows) {
          const member = await manager.findOne(Member, {
            where: { email: row.email.toLowerCase().trim() },
          });

          if (!member) {
            await manager.save(
              manager.create(TitheUnmatchedRecord, {
                batch: { id: batchId },
                rawEmail: row.email,
                amount: row.amount,
                paymentDate: row.paymentDate,
                reference: row.reference ?? null,
                bankName: row.bankName ?? null,
              }),
            );
            unmatched++;
            continue;
          }

          const existing = await manager.findOne(TitheRecord, {
            where: {
              member: { id: member.id },
              paymentDate: row.paymentDate,
              amount: row.amount,
            },
          });

          if (existing) {
            await manager.save(
              manager.create(TitheDisputeRecord, {
                batch: { id: batchId },
                existingRecord: { id: existing.id },
                member: { id: member.id },
                amount: row.amount,
                paymentDate: row.paymentDate,
                reference: row.reference ?? null,
                bankName: row.bankName ?? null,
              }),
            );
            disputed++;
            continue;
          }

          await manager.save(
            manager.create(TitheRecord, {
              member: { id: member.id },
              batch: { id: batchId },
              amount: row.amount,
              paymentDate: row.paymentDate,
              reference: row.reference ?? null,
              bankName: row.bankName ?? null,
            }),
          );
          matched++;
        }

        await manager.update(TitheUploadBatch, batchId, {
          status: TitheBatchStatus.COMPLETED,
          matchedRows: matched,
          unmatchedRows: unmatched,
          disputedRows: disputed,
          processedAt: new Date(),
        });
      });

      this.logger.log(
        `Batch ${batchId} completed — matched: ${matched}, unmatched: ${unmatched}, disputed: ${disputed}`,
      );
    } catch (err) {
      await this.batchRepo.update(batchId, {
        status: TitheBatchStatus.FAILED,
        errorMessage: (err as Error).message,
        processedAt: new Date(),
      });
      throw err;
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    const stuck = await this.batchRepo.count({
      where: { status: TitheBatchStatus.PROCESSING },
    });
    if (stuck > 0) {
      await this.batchRepo.update(
        { status: TitheBatchStatus.PROCESSING },
        {
          status: TitheBatchStatus.FAILED,
          errorMessage: 'Interrupted — service restarted',
        },
      );
      this.logger.warn(
        `Reset ${stuck} stuck PROCESSING batch(es) to FAILED on startup`,
      );
    }
  }

  @OnQueueStalled()
  async onStalled(job: Job<TitheProcessJobData>): Promise<void> {
    this.logger.warn(
      `Tithe batch job ${job.data.batchId} stalled (attempt ${job.attemptsMade}) — Bull will re-queue`,
    );
    await this.batchRepo.update(job.data.batchId, {
      status: TitheBatchStatus.FAILED,
      errorMessage:
        'Job stalled (worker interrupted); will be retried automatically',
    });
  }

  @OnQueueFailed()
  onFailed(job: Job<TitheProcessJobData>, error: Error): void {
    this.logger.error(
      `Tithe batch job ${job.data.batchId} failed (attempt ${job.attemptsMade}): ${error.message}`,
    );
  }
}
