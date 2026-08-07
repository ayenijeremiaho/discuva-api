import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SocialPost } from '../entity/social-post.entity';
import { SocialPostTarget } from '../entity/social-post-target.entity';
import { SocialAccount } from '../entity/social-account.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { CreateSocialPostDto } from '../dto/social-media.dto';
import {
  SocialPostStatus,
  SocialPostTargetStatus,
} from '../enum/social-media.enum';
import { SocialPublisherRegistry } from '../publisher/social-publisher-registry.service';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';

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
  ) {}

  async create(dto: CreateSocialPostDto, adminId: string): Promise<SocialPost> {
    const uniqueIds = Array.from(new Set(dto.targetAccountIds));
    const accounts = await this.accountRepo.find({
      where: { id: In(uniqueIds) },
    });
    if (accounts.length !== uniqueIds.length) {
      throw new BadRequestException('One or more target accounts not found');
    }

    const post = this.postRepo.create({
      content: dto.content,
      imageUrl: dto.imageUrl ?? null,
      status: SocialPostStatus.DRAFT,
      createdBy: { id: adminId } as Admin,
      targets: accounts.map((account) =>
        this.targetRepo.create({
          account,
          status: SocialPostTargetStatus.PENDING,
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
      relations: ['createdBy', 'targets', 'targets.account'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async getById(id: string): Promise<SocialPost> {
    const post = await this.postRepo.findOne({
      where: { id },
      relations: ['createdBy', 'targets', 'targets.account'],
    });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  // Compose-once, publish-everywhere: attempts every target independently
  // (one platform failing never blocks the others) and derives the post's
  // overall status from how many targets actually succeeded.
  async publish(id: string): Promise<SocialPost> {
    const post = await this.getById(id);
    post.status = SocialPostStatus.PUBLISHING;
    await this.postRepo.save(post);

    for (const target of post.targets) {
      const publisher = this.publisherRegistry.resolve(target.account.platform);
      const result = await publisher.publish(target.account, post);
      target.status = result.success
        ? SocialPostTargetStatus.SUCCESS
        : SocialPostTargetStatus.FAILED;
      target.errorMessage = result.error ?? null;
      target.publishedAt = result.success ? new Date() : null;
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
}
