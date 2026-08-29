import { Injectable } from '@nestjs/common';
import { SocialPlacement } from '../enum/social-media.enum';
import { SocialPostMedia } from '../entity/social-post-media.entity';

export interface FocalPoint {
  x: number;
  y: number;
}

// Only STORY/REEL get cropped — both have one universal, strict
// requirement (9:16 vertical, full-bleed) across every platform that
// supports them. FEED has no single "correct" aspect ratio the way
// Stories/Reels do (every platform accepts a range in-feed), so leaving
// FEED media untouched is a deliberate choice, not an oversight — cropping
// it would mean picking a ratio SocialMediaValidationService itself
// doesn't enforce.
const CROPPED_PLACEMENTS = new Set([
  SocialPlacement.STORY,
  SocialPlacement.REEL,
]);
const VERTICAL_ASPECT_RATIO = '9:16';
const UPLOAD_MARKER = '/upload/';

@Injectable()
export class SocialMediaCropService {
  needsCrop(placement: SocialPlacement): boolean {
    return CROPPED_PLACEMENTS.has(placement);
  }

  // Returns `media` unchanged for a placement that doesn't need cropping —
  // callers can always run every target's media through this rather than
  // branching themselves.
  resolveMediaForPlacement(
    media: SocialPostMedia[],
    placement: SocialPlacement,
    focal: FocalPoint | null,
  ): SocialPostMedia[] {
    if (!this.needsCrop(placement)) return media;
    return media.map((m) => ({
      ...m,
      url: this.buildCroppedUrl(m.url, focal),
    }));
  }

  // g_auto (Cloudinary's content-aware/saliency cropping — core product,
  // no add-on) is the zero-effort default; a stored focal point (from a
  // single click on the composer's preview) overrides it with
  // g_xy_center — Cloudinary accepts x/y as float percentages (0-1) of
  // the image directly, so a click position on the rendered preview maps
  // straight through with no pixel-dimension math needed on either side.
  buildCroppedUrl(url: string, focal: FocalPoint | null): string {
    const gravity = focal
      ? `g_xy_center,x_${focal.x.toFixed(4)},y_${focal.y.toFixed(4)}`
      : 'g_auto';
    return this.insertTransformation(
      url,
      `c_fill,ar_${VERTICAL_ASPECT_RATIO},${gravity}`,
    );
  }

  // Cloudinary delivery URLs are always
  // .../<resource_type>/upload/<version>/<public_id>.<ext> — a
  // transformation is just another path segment inserted right after
  // /upload/. Falls back to the original URL untouched if it doesn't look
  // like a Cloudinary delivery URL, rather than producing a broken one.
  private insertTransformation(url: string, transformation: string): string {
    const idx = url.indexOf(UPLOAD_MARKER);
    if (idx === -1) return url;
    const insertAt = idx + UPLOAD_MARKER.length;
    return `${url.slice(0, insertAt)}${transformation}/${url.slice(insertAt)}`;
  }
}
