import * as crypto from 'node:crypto';
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
import { BulkUploadJob } from '../entity/bulk-upload-job.entity';
import { ReconciliationRow } from '../entity/reconciliation-row.entity';
import {
  BulkUploadJobStatus,
  ReconciliationRowStatus,
} from '../enum/finance.enum';
import { CsvParser } from '../util/csv-parser';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { TenantJobEnvelope } from '../../tenant/utility/job-envelope';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';

export const RECONCILIATION_QUEUE = 'finance-reconciliation';
export const RECONCILIATION_PROCESS_JOB = 'parse-csv';

export interface ReconciliationJobData extends TenantJobEnvelope {
  jobId: string;
  csvContent: string;
}

@Processor(RECONCILIATION_QUEUE)
export class ReconciliationProcessor implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReconciliationProcessor.name);

  constructor(
    @InjectRepository(BulkUploadJob)
    private readonly jobRepo: Repository<BulkUploadJob>,
    @InjectRepository(ReconciliationRow)
    private readonly rowRepo: Repository<ReconciliationRow>,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  @Process(RECONCILIATION_PROCESS_JOB)
  async handleParse(job: Job<ReconciliationJobData>): Promise<void> {
    return runInTenantContext(this.cls, this.txHost, job.data, () =>
      this.doHandleParse(job.data),
    );
  }

  private async doHandleParse(data: ReconciliationJobData): Promise<void> {
    const { jobId, csvContent } = data;
    const uploadJob = await this.jobRepo.findOne({
      where: { id: jobId },
      relations: ['profile'],
    });
    if (!uploadJob) return;

    await this.jobRepo.update(jobId, { status: BulkUploadJobStatus.PARSING });

    try {
      const profile = uploadJob.profile;
      if (!profile) {
        await this.jobRepo.update(jobId, {
          status: BulkUploadJobStatus.FAILED,
          errorMessage: 'No import profile attached to this job.',
        });
        return;
      }

      const rows = CsvParser.parseAll(csvContent, profile);
      await this.jobRepo.update(jobId, { totalRows: rows.length });

      const [existingRowFpRows, existingTxFpRows] = await Promise.all([
        this.rowRepo
          .createQueryBuilder('r')
          .select('r.row_fingerprint', 'rf')
          .where('r.job_id = :jobId', { jobId })
          .getRawMany<{ rf: string }>(),
        this.rowRepo
          .createQueryBuilder('r')
          .select('DISTINCT r.transaction_fingerprint', 'tf')
          .where('r.job_id != :jobId', { jobId })
          .getRawMany<{ tf: string }>(),
      ]);

      const existingRowFps = new Set(existingRowFpRows.map((r) => r.rf));
      const existingTxFps = new Set(existingTxFpRows.map((r) => r.tf));

      const rowEntities: ReconciliationRow[] = [];
      for (const row of rows) {
        const rowFingerprint = this.fingerprint(
          `${row.date}|${row.narration}|${row.amount}|${row.creditDebit}`,
        );
        const transactionFingerprint = this.fingerprint(
          `${row.date}|${row.amount}|${row.creditDebit}`,
        );

        if (
          existingRowFps.has(rowFingerprint) ||
          existingTxFps.has(transactionFingerprint)
        )
          continue;

        existingRowFps.add(rowFingerprint);
        existingTxFps.add(transactionFingerprint);

        rowEntities.push(
          this.rowRepo.create({
            job: { id: jobId } as any,
            rowFingerprint,
            transactionFingerprint,
            transactionDate: row.date,
            narration: row.narration,
            amount: row.amount,
            creditDebit: row.creditDebit,
            status: ReconciliationRowStatus.PENDING,
          }),
        );
      }

      if (rowEntities.length > 0) {
        await this.rowRepo.save(rowEntities);
      }

      await this.jobRepo.update(jobId, {
        status: BulkUploadJobStatus.READY_FOR_REVIEW,
        processedRows: rowEntities.length,
      });

      this.logger.log(
        `Reconciliation job ${jobId} parsed ${rows.length} rows, ${rowEntities.length} new rows queued for review`,
      );
    } catch (err) {
      await this.jobRepo.update(jobId, {
        status: BulkUploadJobStatus.FAILED,
        errorMessage: (err as Error).message,
      });
      throw err;
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    const stuck = await this.jobRepo.count({
      where: { status: BulkUploadJobStatus.PARSING },
    });
    if (stuck > 0) {
      await this.jobRepo.update(
        { status: BulkUploadJobStatus.PARSING },
        {
          status: BulkUploadJobStatus.FAILED,
          errorMessage: 'Interrupted — service restarted',
        },
      );
      this.logger.warn(
        `Reset ${stuck} stuck PARSING reconciliation job(s) to FAILED on startup`,
      );
    }
  }

  @OnQueueStalled()
  async onStalled(job: Job<ReconciliationJobData>): Promise<void> {
    this.logger.warn(`Reconciliation job ${job.data.jobId} stalled`);
    await this.jobRepo.update(job.data.jobId, {
      status: BulkUploadJobStatus.FAILED,
      errorMessage: 'Job stalled; will be retried automatically',
    });
  }

  @OnQueueFailed()
  onFailed(job: Job<ReconciliationJobData>, error: Error): void {
    this.logger.error(
      `Reconciliation job ${job.data.jobId} failed: ${error.message}`,
    );
  }

  private fingerprint(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}
