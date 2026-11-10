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
