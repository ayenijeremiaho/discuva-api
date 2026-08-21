import { Injectable, Logger } from '@nestjs/common';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { TenantJobEnvelope } from '../../tenant/utility/job-envelope';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';
import { SocialPostService } from '../service/social-post.service';

export interface SocialPostPublishJobData extends TenantJobEnvelope {
  postId: string;
}

// Fires when a "Schedule for later" post's delay elapses — calls the exact
// same SocialPostService.publish() "Publish Now" calls, so there is only
// ever one publish code path regardless of how it was triggered.
@Injectable()
@Processor('social-post-publish')
export class SocialPostPublishProcessor {
  private readonly logger = new Logger(SocialPostPublishProcessor.name);

  constructor(
    private readonly postService: SocialPostService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  @Process('publish')
  async handlePublish(job: Job<SocialPostPublishJobData>): Promise<void> {
    await runInTenantContext(this.cls, this.txHost, job.data, async () => {
      await this.postService.publish(job.data.postId);
    });
  }

  @OnQueueFailed()
  onFailed(job: Job<SocialPostPublishJobData>, error: Error): void {
    this.logger.error(
      `Scheduled social post ${job.data.postId} failed to publish: ${error.message}`,
    );
  }
}
