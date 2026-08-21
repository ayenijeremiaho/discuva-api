import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { SocialPost } from '../entity/social-post.entity';
import { SocialPostMedia } from '../entity/social-post-media.entity';
import { SocialPostStatus } from '../enum/social-media.enum';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { CloudinaryService } from '../../utility/service/cloudinary.service';

// Closes a gap none of the researched incumbents (Buffer/Hootsuite/Later)
// document clearly: an abandoned draft's uploaded media would otherwise sit
// in storage forever. Published posts' media is untouched regardless of
// age — the platform still needs that URL to show "this is what went out."
@Injectable()
export class SocialMediaRetentionScheduler {
  private readonly logger = new Logger(SocialMediaRetentionScheduler.name);

  constructor(
    @InjectRepository(SocialPost)
    private readonly postRepo: Repository<SocialPost>,
    @InjectRepository(SocialPostMedia)
    private readonly mediaRepo: Repository<SocialPostMedia>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly platformSettingsService: PlatformSettingsService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  @Cron('0 3 * * *')
  async deleteStaleDraftMedia(): Promise<void> {
    const retentionDays =
      await this.platformSettingsService.getSocialMediaDraftRetentionDays();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const result = await forEachActiveTenant(
      this.tenantRepo,
      this.cls,
      this.txHost,
      this.logger,
      async () => {
        const stalePosts = await this.postRepo.find({
          where: {
            status: SocialPostStatus.DRAFT,
            updatedAt: LessThan(cutoff),
          },
          relations: ['media'],
        });

        for (const post of stalePosts) {
          if (post.media.length === 0) continue;
          for (const media of post.media) {
            this.cloudinaryService.deleteByPublicId(
              media.publicId,
              media.mimeType.startsWith('video/') ? 'video' : 'image',
            );
          }
          await this.mediaRepo.remove(post.media);
        }
      },
    );

    this.logger.log(
      `Social media draft retention sweep: ${result.succeeded} tenant(s) processed, ${result.failed} failed.`,
    );
  }
}
