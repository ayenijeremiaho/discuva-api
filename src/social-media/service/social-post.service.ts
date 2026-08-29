import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { In, Repository } from 'typeorm';
import { Queue } from 'bull';
import { ClsService } from 'nestjs-cls';
import { SocialPost } from '../entity/social-post.entity';
import { SocialPostTarget } from '../entity/social-post-target.entity';
import { SocialAccount } from '../entity/social-account.entity';
import { Admin } from '../../admin/entity/admin.entity';
import {
  CreateSocialPostDto,
  UpdateTargetFocalPointDto,
  UpdateTargetOverrideDto,
} from '../dto/social-media.dto';
import {
  SocialPostStatus,
  SocialPostTargetStatus,
} from '../enum/social-media.enum';
import { SocialPublisherRegistry } from '../publisher/social-publisher-registry.service';
import { SocialStatsFetcherRegistry } from '../stats/social-stats-fetcher-registry.service';
import { PostStats } from '../stats/social-stats-fetcher.interface';
import { SocialMediaValidationService } from './social-media-validation.service';
import { SocialMediaCropService } from './social-media-crop.service';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { buildJobEnvelope } from '../../tenant/utility/job-envelope';
import { SocialPostPublishJobData } from '../processor/social-post-publish.processor';

@Injectable()
export class SocialPostService {
  constructor(
    @InjectRepository(SocialPost)
    private readonly postRepo: Repository<SocialPost>,
    @InjectRepository(SocialPostTarget)
    private readonly targetRepo: Repository<SocialPostTarget>,
    @InjectRepository(SocialAccount)
    private readonly accountRepo: Repository<SocialAccount>,
    private readonly publisherRegistry: SocialPublisherRegistry,
    private readonly statsFetcherRegistry: SocialStatsFetcherRegistry,
    private readonly validationService: SocialMediaValidationService,
    private readonly cropService: SocialMediaCropService,
    @InjectQueue('social-post-publish')
    private readonly publishQueue: Queue<SocialPostPublishJobData>,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async create(dto: CreateSocialPostDto, adminId: string): Promise<SocialPost> {
    const uniqueAccountIds = Array.from(
      new Set(dto.targets.map((t) => t.accountId)),
    );
    const accounts = await this.accountRepo.find({
      where: { id: In(uniqueAccountIds) },
    });
    if (accounts.length !== uniqueAccountIds.length) {
      throw new BadRequestException('One or more target accounts not found');
    }
    const accountById = new Map(accounts.map((a) => [a.id, a]));

    const post = this.postRepo.create({
      content: dto.content,
      status: SocialPostStatus.DRAFT,
      createdBy: { id: adminId } as Admin,
      targets: dto.targets.map((t) =>
        this.targetRepo.create({
          account: accountById.get(t.accountId),
          placement: t.placement,
          status: SocialPostTargetStatus.PENDING,
          contentOverride: t.contentOverride?.trim() || null,
        }),
      ),
    });
    return this.postRepo.save(post);
  }

  async getAll(
    page = 1,
    limit = 20,
  ): Promise<PaginationResponseDto<SocialPost>> {
    const [data, total] = await this.postRepo.findAndCount({
      relations: ['createdBy', 'targets', 'targets.account', 'media'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async getById(id: string): Promise<SocialPost> {
    const post = await this.postRepo.findOne({
      where: { id },
      relations: ['createdBy', 'targets', 'targets.account', 'media'],
    });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  // Compose-once, publish-everywhere: attempts every target independently
  // (one platform failing never blocks the others) and derives the post's
  // overall status from how many targets actually succeeded. Validation
  // errors (SocialMediaValidationService) block a target from ever
  // reaching its publisher — same "one platform failing never blocks the
  // others" independence, just failing earlier and without wasting an API
  // call on a request that was never going to succeed.
  //
  // Every target's content and media are resolved here, once, before
  // anything is validated or published — target.contentOverride ??
  // post.content, and media urls run through SocialMediaCropService for
  // this target's placement/focal point. A publisher only ever sees
  // already-resolved values, never SocialPost/SocialPostTarget directly —
  // see SocialPlatformPublisher's own comment for why that split matters.
  async publish(id: string): Promise<SocialPost> {
    const post = await this.getById(id);
    post.status = SocialPostStatus.PUBLISHING;
    await this.postRepo.save(post);

    const resolvedContent = post.targets.map(
      (t) => t.contentOverride ?? post.content,
    );
    const resolvedMedia = post.targets.map((t) =>
      this.cropService.resolveMediaForPlacement(
        post.media,
        t.placement,
        this.resolveFocalPoint(t),
      ),
    );

    const validationByTarget = this.validationService.validate(
      post.media,
      post.targets.map((t, i) => ({
        platform: t.account.platform,
        placement: t.placement,
        content: resolvedContent[i],
      })),
    );

    for (const [i, target] of post.targets.entries()) {
      const validation = validationByTarget[i];
      if (validation.errors.length > 0) {
        target.status = SocialPostTargetStatus.FAILED;
        target.errorMessage = validation.errors.map((e) => e.message).join(' ');
        target.publishedAt = null;
        continue;
      }

      const publisher = await this.publisherRegistry.resolve(
        target.account.platform,
      );
      const result = await publisher.publish(
        target.account,
        resolvedContent[i],
        resolvedMedia[i],
        target.placement,
      );
      target.status = result.success
        ? SocialPostTargetStatus.SUCCESS
        : SocialPostTargetStatus.FAILED;
      target.errorMessage = result.error ?? null;
      target.publishedAt = result.success ? new Date() : null;
      if (result.externalPostId) target.externalPostId = result.externalPostId;
    }
    await this.targetRepo.save(post.targets);

    const succeeded = post.targets.filter(
      (t) => t.status === SocialPostTargetStatus.SUCCESS,
    ).length;
    post.status =
      succeeded === 0
        ? SocialPostStatus.FAILED
        : succeeded === post.targets.length
          ? SocialPostStatus.PUBLISHED
          : SocialPostStatus.PARTIALLY_PUBLISHED;
    post.publishedAt = succeeded > 0 ? new Date() : null;

    return this.postRepo.save(post);
  }

  // Queues a delayed job that calls this exact publish() method when it
  // fires — jobId is the post's own id, both so a post can never be
  // double-scheduled (Bull rejects a duplicate jobId) and so
  // cancelSchedule can find the job again without a separate stored column.
  async schedule(id: string, scheduledFor: Date): Promise<SocialPost> {
    const post = await this.getById(id);
    if (post.status !== SocialPostStatus.DRAFT) {
      throw new BadRequestException('Only a draft post can be scheduled.');
    }
    if (scheduledFor.getTime() <= Date.now()) {
      throw new BadRequestException('scheduledFor must be in the future.');
    }

    post.status = SocialPostStatus.SCHEDULED;
    post.scheduledFor = scheduledFor;
    await this.postRepo.save(post);

    await this.publishQueue.add(
      'publish',
      { postId: id, ...buildJobEnvelope(this.cls) },
      {
        jobId: id,
        delay: scheduledFor.getTime() - Date.now(),
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    return post;
  }

  async cancelSchedule(id: string): Promise<SocialPost> {
    const post = await this.getById(id);
    if (post.status !== SocialPostStatus.SCHEDULED) {
      throw new BadRequestException('Post is not currently scheduled.');
    }

    const job = await this.publishQueue.getJob(id);
    if (job) await job.remove();

    post.status = SocialPostStatus.DRAFT;
    post.scheduledFor = null;
    return this.postRepo.save(post);
  }

  async delete(id: string): Promise<void> {
    const post = await this.getById(id);
    if (
      post.status !== SocialPostStatus.DRAFT &&
      post.status !== SocialPostStatus.FAILED
    ) {
      throw new BadRequestException(
        'Only draft or fully-failed posts can be deleted — published history is kept',
      );
    }
    await this.postRepo.remove(post);
  }

  // DRAFT-only, same rule addMedia/removeMedia already enforce
  // (SocialPostMediaService) — a target that's already PUBLISHING or
  // resolved shouldn't have its content silently change under it.
  async updateTargetOverride(
    postId: string,
    targetId: string,
    dto: UpdateTargetOverrideDto,
  ): Promise<SocialPostTarget> {
    const target = await this.getDraftTargetOrThrow(postId, targetId);
    target.contentOverride = dto.contentOverride?.trim() || null;
    return this.targetRepo.save(target);
  }

  // x/y are always set or cleared together — a lone x with no y (or vice
  // versa) is meaningless as a crop focal point, so this rejects that
  // combination outright rather than silently ignoring the stray value.
  async updateTargetFocalPoint(
    postId: string,
    targetId: string,
    dto: UpdateTargetFocalPointDto,
  ): Promise<SocialPostTarget> {
    if ((dto.x === null) !== (dto.y === null)) {
      throw new BadRequestException('x and y must be set or cleared together.');
    }
    const target = await this.getDraftTargetOrThrow(postId, targetId);
    target.mediaFocalX = dto.x;
    target.mediaFocalY = dto.y;
    return this.targetRepo.save(target);
  }

  // No DRAFT restriction, unlike updateTargetOverride/updateTargetFocalPoint
  // — this only reads, and only makes sense once a target has actually
  // published (has an externalPostId to look up in the first place).
  async getTargetStats(postId: string, targetId: string): Promise<PostStats> {
    const post = await this.getById(postId);
    const target = post.targets.find((t) => t.id === targetId);
    if (!target) {
      throw new NotFoundException('Target not found on this post.');
    }
    if (!target.externalPostId) {
      throw new BadRequestException(
        'This target has not been published yet — there is nothing to fetch stats for.',
      );
    }
    const fetcher = this.statsFetcherRegistry.resolve(target.account.platform);
    return fetcher.getStats(target.account, target.externalPostId);
  }

  private async getDraftTargetOrThrow(
    postId: string,
    targetId: string,
  ): Promise<SocialPostTarget> {
    const post = await this.getById(postId);
    if (post.status !== SocialPostStatus.DRAFT) {
      throw new BadRequestException(
        "Only a draft post's targets can be customized.",
      );
    }
    const target = post.targets.find((t) => t.id === targetId);
    if (!target) {
      throw new NotFoundException('Target not found on this post.');
    }
    return target;
  }

  private resolveFocalPoint(
    target: SocialPostTarget,
  ): { x: number; y: number } | null {
    if (target.mediaFocalX == null || target.mediaFocalY == null) return null;
    return { x: Number(target.mediaFocalX), y: Number(target.mediaFocalY) };
  }
}
