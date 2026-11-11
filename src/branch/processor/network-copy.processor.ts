import { Logger } from '@nestjs/common';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import {
  NETWORK_COPY_QUEUE,
  NetworkCopyJob,
} from '../../network-share/network-share.constants';
import { NetworkCopyService } from '../service/network-copy.service';
import { NetworkRollupService } from '../service/network-rollup.service';
import { NetworkClosureService } from '../service/network-closure.service';

@Processor(NETWORK_COPY_QUEUE)
export class NetworkCopyProcessor {
  private readonly logger = new Logger(NetworkCopyProcessor.name);

  constructor(
    private readonly copies: NetworkCopyService,
    private readonly rollups: NetworkRollupService,
    private readonly closures: NetworkClosureService,
  ) {}

  @Process()
  async handle(job: Job<NetworkCopyJob>): Promise<void> {
    const { kind, sourceTenantId, sourceId } = job.data;
    if (kind === 'events') await this.copies.copyEvents(sourceTenantId);
    else if (kind === 'rollup') await this.rollups.compute(sourceTenantId);
    else if (kind === 'closure') await this.closures.run(sourceId!);
    else await this.copies.copyAnnouncement(sourceTenantId, sourceId!);
  }

  @OnQueueFailed()
  onFailed(job: Job<NetworkCopyJob>, err: Error): void {
    this.logger.error(
      `Network copy (${job.data.kind}) for ${job.data.sourceTenantId} failed (attempt ${job.attemptsMade}): ${err.message}`,
    );
  }
}
