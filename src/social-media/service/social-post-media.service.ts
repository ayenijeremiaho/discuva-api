import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SocialPost } from '../entity/social-post.entity';
import { SocialPostMedia } from '../entity/social-post-media.entity';
import { SocialPostStatus } from '../enum/social-media.enum';
import { CloudinaryService } from '../../utility/service/cloudinary.service';

@Injectable()
export class SocialPostMediaService {
  constructor(
    @InjectRepository(SocialPost)
    private readonly postRepo: Repository<SocialPost>,
    @InjectRepository(SocialPostMedia)
    private readonly mediaRepo: Repository<SocialPostMedia>,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  // Only DRAFT posts can gain new attachments — once scheduled/publishing/
  // published, the retention scheduler and the publish itself both assume
  // a post's media set is settled.
  async addMedia(
    postId: string,
    files: Express.Multer.File[],
  ): Promise<SocialPostMedia[]> {
    const post = await this.postRepo.findOne({
      where: { id: postId },
      relations: ['media'],
    });
    if (!post) throw new NotFoundException('Post not found');
    if (post.status !== SocialPostStatus.DRAFT) {
      throw new BadRequestException('Media can only be added to a draft post.');
    }

    const startOrder = post.media?.length ?? 0;
    const uploaded = await Promise.all(
      files.map((file) =>
        this.cloudinaryService.uploadBuffer(
          file.buffer,
          'social-media',
          undefined,
          file.mimetype,
        ),
      ),
    );

    const rows = uploaded.map((result, i) =>
      this.mediaRepo.create({
        post,
        url: result.secureUrl,
        publicId: result.publicId,
        mimeType: files[i].mimetype,
        sizeBytes: files[i].size,
        width: result.width ?? null,
        height: result.height ?? null,
        durationSeconds: result.duration ?? null,
        order: startOrder + i,
      }),
    );
    return this.mediaRepo.save(rows);
  }

  async removeMedia(postId: string, mediaId: string): Promise<void> {
    const media = await this.mediaRepo.findOne({
      where: { id: mediaId, post: { id: postId } },
      relations: ['post'],
    });
    if (!media) throw new NotFoundException('Media not found on this post');
    if (media.post.status !== SocialPostStatus.DRAFT) {
      throw new BadRequestException(
        'Media can only be removed from a draft post.',
      );
    }

    await this.mediaRepo.remove(media);
    this.cloudinaryService.deleteByPublicId(
      media.publicId,
      media.mimeType.startsWith('video/') ? 'video' : 'image',
    );
  }
}
