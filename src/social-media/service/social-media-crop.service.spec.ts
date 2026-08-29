import { SocialMediaCropService } from './social-media-crop.service';
import { SocialPlacement } from '../enum/social-media.enum';
import { SocialPostMedia } from '../entity/social-post-media.entity';

function media(overrides: Partial<SocialPostMedia> = {}): SocialPostMedia {
  return {
    id: 'm1',
    url: 'https://res.cloudinary.com/demo/image/upload/v1699999999/social-media/photo.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    width: 1080,
    height: 1080,
    durationSeconds: null,
    order: 0,
    ...overrides,
  } as SocialPostMedia;
}

describe('SocialMediaCropService', () => {
  const service = new SocialMediaCropService();

  describe('needsCrop', () => {
    it('is true for STORY and REEL, false for FEED', () => {
      expect(service.needsCrop(SocialPlacement.STORY)).toBe(true);
      expect(service.needsCrop(SocialPlacement.REEL)).toBe(true);
      expect(service.needsCrop(SocialPlacement.FEED)).toBe(false);
    });
  });

  describe('resolveMediaForPlacement', () => {
    it('returns media unchanged for FEED', () => {
      const original = [media()];
      const result = service.resolveMediaForPlacement(
        original,
        SocialPlacement.FEED,
        null,
      );
      expect(result).toBe(original);
    });

    it('crops every attachment for STORY, without mutating the originals', () => {
      const original = [media({ id: 'a' }), media({ id: 'b' })];
      const result = service.resolveMediaForPlacement(
        original,
        SocialPlacement.STORY,
        null,
      );
      expect(result).toHaveLength(2);
      expect(result[0].url).toContain('c_fill,ar_9:16,g_auto');
      expect(result[1].url).toContain('c_fill,ar_9:16,g_auto');
      expect(result[0]).not.toBe(original[0]);
      expect(original[0].url).not.toContain('c_fill');
    });
  });

  describe('buildCroppedUrl', () => {
    it('uses g_auto (content-aware cropping) when no focal point is given', () => {
      const url = service.buildCroppedUrl(
        'https://res.cloudinary.com/demo/image/upload/v1/photo.jpg',
        null,
      );
      expect(url).toBe(
        'https://res.cloudinary.com/demo/image/upload/c_fill,ar_9:16,g_auto/v1/photo.jpg',
      );
    });

    it('uses g_xy_center with the given normalized focal point', () => {
      const url = service.buildCroppedUrl(
        'https://res.cloudinary.com/demo/image/upload/v1/photo.jpg',
        { x: 0.62, y: 0.35 },
      );
      expect(url).toBe(
        'https://res.cloudinary.com/demo/image/upload/c_fill,ar_9:16,g_xy_center,x_0.6200,y_0.3500/v1/photo.jpg',
      );
    });

    it('returns the url unchanged if it does not look like a Cloudinary delivery URL', () => {
      const url = service.buildCroppedUrl(
        'https://example.com/not-cloudinary.jpg',
        null,
      );
      expect(url).toBe('https://example.com/not-cloudinary.jpg');
    });
  });
});
