import { Injectable } from '@nestjs/common';
import { SocialPlacement, SocialPlatform } from '../enum/social-media.enum';
import { SocialPostMedia } from '../entity/social-post-media.entity';

export interface ValidationIssue {
  code: string;
  message: string;
}

export interface TargetValidationResult {
  platform: SocialPlatform;
  placement: SocialPlacement;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

interface PlacementConstraints {
  requiresVideo?: boolean;
  forbidsVideo?: boolean;
  maxVideoBytes?: number;
  maxVideoSeconds?: number;
  idealMaxVideoSeconds?: number; // exceeding this is a warning, not an error
  maxImageBytes?: number;
  maxImages?: number;
  maxCaptionLength?: number;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

// SocialPilot's two-tier errors/warnings model, informed by the researched
// platform comparison table (docs referenced in the plan) — structural
// mismatches (wrong content type, over a hard limit) are errors that block
// that specific target; "ideally" recommendations (e.g. Reels performing
// worse past 3 minutes) are warnings that don't block publishing.
const CONSTRAINTS: Partial<
  Record<SocialPlatform, Partial<Record<SocialPlacement, PlacementConstraints>>>
> = {
  [SocialPlatform.FACEBOOK]: {
    [SocialPlacement.FEED]: {
      maxImageBytes: 30 * MB,
      maxVideoBytes: 4 * GB,
      maxVideoSeconds: 240 * 60,
      maxCaptionLength: 63206,
    },
  },
  [SocialPlatform.INSTAGRAM]: {
    [SocialPlacement.FEED]: {
      maxVideoBytes: 4 * GB,
      maxCaptionLength: 2200,
    },
    [SocialPlacement.STORY]: {
      maxVideoSeconds: 60,
      maxCaptionLength: 2200,
    },
    [SocialPlacement.REEL]: {
      requiresVideo: true,
      maxVideoBytes: 1 * GB,
      idealMaxVideoSeconds: 180,
      maxCaptionLength: 2200,
    },
  },
  [SocialPlatform.X]: {
    [SocialPlacement.FEED]: {
      maxImages: 4,
      maxVideoBytes: 512 * MB,
      maxVideoSeconds: 140,
      maxCaptionLength: 280,
    },
  },
  [SocialPlatform.YOUTUBE]: {
    [SocialPlacement.FEED]: {
      requiresVideo: true,
      maxVideoBytes: 256 * GB,
      maxVideoSeconds: 12 * 60 * 60,
    },
    [SocialPlacement.REEL]: {
      requiresVideo: true,
      maxVideoSeconds: 180,
    },
  },
};

@Injectable()
export class SocialMediaValidationService {
  validate(
    content: string,
    media: SocialPostMedia[],
    targets: { platform: SocialPlatform; placement: SocialPlacement }[],
  ): TargetValidationResult[] {
    const videos = media.filter((m) => m.mimeType.startsWith('video/'));
    const images = media.filter((m) => m.mimeType.startsWith('image/'));
    const primaryVideo = videos[0];

    return targets.map(({ platform, placement }) => {
      const constraints = CONSTRAINTS[platform]?.[placement];
      const errors: ValidationIssue[] = [];
      const warnings: ValidationIssue[] = [];

      if (!constraints) {
        errors.push({
          code: 'UNSUPPORTED_PLACEMENT',
          message: `${placement} isn't supported on ${platform} yet.`,
        });
        return { platform, placement, errors, warnings };
      }

      if (constraints.requiresVideo && videos.length === 0) {
        errors.push({
          code: 'VIDEO_REQUIRED',
          message: `${platform} ${placement} requires a video attachment.`,
        });
      }
      if (constraints.forbidsVideo && videos.length > 0) {
        errors.push({
          code: 'VIDEO_NOT_SUPPORTED',
          message: `${platform} ${placement} doesn't support video.`,
        });
      }
      if (
        constraints.maxImages !== undefined &&
        images.length > constraints.maxImages
      ) {
        errors.push({
          code: 'TOO_MANY_IMAGES',
          message: `${platform} ${placement} allows at most ${constraints.maxImages} images (${images.length} attached).`,
        });
      }
      if (
        primaryVideo &&
        constraints.maxVideoBytes !== undefined &&
        primaryVideo.sizeBytes > constraints.maxVideoBytes
      ) {
        errors.push({
          code: 'VIDEO_TOO_LARGE',
          message: `Video exceeds ${platform} ${placement}'s ${Math.round(constraints.maxVideoBytes / MB)}MB limit.`,
        });
      }
      if (
        primaryVideo?.durationSeconds != null &&
        constraints.maxVideoSeconds !== undefined &&
        primaryVideo.durationSeconds > constraints.maxVideoSeconds
      ) {
        errors.push({
          code: 'VIDEO_TOO_LONG',
          message: `Video exceeds ${platform} ${placement}'s ${constraints.maxVideoSeconds}s limit.`,
        });
      }
      if (
        primaryVideo?.durationSeconds != null &&
        constraints.idealMaxVideoSeconds !== undefined &&
        primaryVideo.durationSeconds > constraints.idealMaxVideoSeconds
      ) {
        warnings.push({
          code: 'VIDEO_LONGER_THAN_IDEAL',
          message: `Videos over ${constraints.idealMaxVideoSeconds}s tend to perform worse on ${platform} ${placement} — consider trimming.`,
        });
      }
      for (const image of images) {
        if (
          constraints.maxImageBytes !== undefined &&
          image.sizeBytes > constraints.maxImageBytes
        ) {
          errors.push({
            code: 'IMAGE_TOO_LARGE',
            message: `An image exceeds ${platform} ${placement}'s ${Math.round(constraints.maxImageBytes / MB)}MB limit.`,
          });
        }
      }
      if (
        constraints.maxCaptionLength !== undefined &&
        content.length > constraints.maxCaptionLength
      ) {
        errors.push({
          code: 'CAPTION_TOO_LONG',
          message: `Caption exceeds ${platform} ${placement}'s ${constraints.maxCaptionLength}-character limit (${content.length} used).`,
        });
      }

      return { platform, placement, errors, warnings };
    });
  }
}
