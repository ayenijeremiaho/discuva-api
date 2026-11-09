import { Logger } from '@nestjs/common';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { AccountDeletionService } from '../service/account-deletion.service';

export const ACCOUNT_DELETION_QUEUE = 'discuva-account-deletion';

export interface AccountDeletionJobData {
  accountId: string;
  // The request this job was queued for; a cancelled or newer request makes it a no-op.
  requestedAt: number;
}

export const ACCOUNT_DELETION_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 300_000 },
  removeOnComplete: true,
};

@Processor(ACCOUNT_DELETION_QUEUE)
export class AccountDeletionProcessor {
  private readonly logger = new Logger(AccountDeletionProcessor.name);

  constructor(private readonly deletion: AccountDeletionService) {}

  @Process()
  async handle(job: Job<AccountDeletionJobData>): Promise<void> {
    await this.deletion.run(job.data.accountId, job.data.requestedAt);
  }

  @OnQueueFailed()
  onFailed(job: Job<AccountDeletionJobData>, err: Error): void {
    this.logger.error(
      `Deleting account ${job.data.accountId} failed (attempt ${job.attemptsMade}): ${err.message}`,
    );
  }
}
