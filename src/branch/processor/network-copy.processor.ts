import { Logger } from '@nestjs/common';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import {
  NETWORK_COPY_QUEUE,
  NetworkCopyJob,
} from '../../network-share/network-share.constants';
import { NetworkCopyService } from '../service/network-copy.service';

@Processor(NETWORK_COPY_QUEUE)
export class NetworkCopyProcessor {
  private readonly logger = new Logger(NetworkCopyProcessor.name);

  constructor(private readonly copies: NetworkCopyService) {}

  @Process()
  async handle(job: Job<NetworkCopyJob>): Promise<void> {
    if (job.data.kind === 'events')
      await this.copies.copyEvents(job.data.sourceTenantId);
    else
      await this.copies.copyAnnouncement(
        job.data.sourceTenantId,
        job.data.sourceId!,
      );
  }

  @OnQueueFailed()
  onFailed(job: Job<NetworkCopyJob>, err: Error): void {
    this.logger.error(
      `Network copy (${job.data.kind}) for ${job.data.sourceTenantId} failed (attempt ${job.attemptsMade}): ${err.message}`,
    );
  }
}
