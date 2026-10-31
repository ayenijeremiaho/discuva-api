import { Logger } from '@nestjs/common';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { CloudinaryService } from '../../utility/service/cloudinary.service';

export const ACCOUNT_FILE_CLEANUP_QUEUE = 'account-file-cleanup';

export interface AccountFileCleanupJobData {
  tenantId: string;
  legacyPublicIds: string[];
}

export const ACCOUNT_FILE_CLEANUP_OPTIONS = {
  attempts: 8,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: true,
};

// Runs after the database delete, so a file storage outage can't block or undo it. Safe to repeat.
@Processor(ACCOUNT_FILE_CLEANUP_QUEUE)
export class AccountFileCleanupProcessor {
  private readonly logger = new Logger(AccountFileCleanupProcessor.name);

  constructor(private readonly cloudinary: CloudinaryService) {}

  @Process()
  async handle(job: Job<AccountFileCleanupJobData>): Promise<void> {
    const { tenantId, legacyPublicIds } = job.data;
    await this.cloudinary.deleteTenantFiles(tenantId, legacyPublicIds);
    this.logger.log(`Deleted files for removed account ${tenantId}`);
  }

  @OnQueueFailed()
  onFailed(job: Job<AccountFileCleanupJobData>, err: Error): void {
    this.logger.error(
      `File cleanup attempt ${job.attemptsMade} failed for ${job.data.tenantId}: ${err.message}`,
    );
  }
}
