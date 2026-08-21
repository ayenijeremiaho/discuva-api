import { SocialMediaValidationService } from './social-media-validation.service';
import { SocialPlacement, SocialPlatform } from '../enum/social-media.enum';
import { SocialPostMedia } from '../entity/social-post-media.entity';

function media(overrides: Partial<SocialPostMedia> = {}): SocialPostMedia {
  return {
    id: 'media-1',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    width: 1080,
    height: 1080,
    durationSeconds: null,
    order: 0,
    ...overrides,
  } as SocialPostMedia;
}

describe('SocialMediaValidationService', () => {
  const service = new SocialMediaValidationService();

  it('passes a short-caption image post targeting Facebook Feed with no issues', () => {
    const [result] = service.validate(
      'Hello church!',
      [media()],
      [{ platform: SocialPlatform.FACEBOOK, placement: SocialPlacement.FEED }],
    );
    expect(result.errors).toHaveLength(0);
  });

  it('errors when YouTube Feed has no video attached', () => {
    const [result] = service.validate(
      'New sermon',
      [media()],
      [{ platform: SocialPlatform.YOUTUBE, placement: SocialPlacement.FEED }],
    );
    expect(result.errors.map((e) => e.code)).toContain('VIDEO_REQUIRED');
  });

  it('errors when Instagram Reel has no video attached', () => {
    const [result] = service.validate(
      'Reel time',
      [media()],
      [{ platform: SocialPlatform.INSTAGRAM, placement: SocialPlacement.REEL }],
    );
    expect(result.errors.map((e) => e.code)).toContain('VIDEO_REQUIRED');
  });

  it('errors when a video exceeds the platform+placement byte limit', () => {
    const bigVideo = media({
      mimeType: 'video/mp4',
      sizeBytes: 600 * 1024 * 1024, // 600MB > X's 512MB feed limit
      durationSeconds: 30,
    });
    const [result] = service.validate(
      'Watch this',
      [bigVideo],
      [{ platform: SocialPlatform.X, placement: SocialPlacement.FEED }],
    );
    expect(result.errors.map((e) => e.code)).toContain('VIDEO_TOO_LARGE');
  });

  it('errors when a video exceeds the platform+placement duration limit', () => {
    const longVideo = media({
      mimeType: 'video/mp4',
      sizeBytes: 1024,
      durationSeconds: 200, // > X's 140s feed limit
    });
    const [result] = service.validate(
      'Watch this',
      [longVideo],
      [{ platform: SocialPlatform.X, placement: SocialPlacement.FEED }],
    );
    expect(result.errors.map((e) => e.code)).toContain('VIDEO_TOO_LONG');
  });

  it('warns (does not error) when an Instagram Reel exceeds the ideal-but-not-hard duration cap', () => {
    const longReel = media({
      mimeType: 'video/mp4',
      sizeBytes: 1024,
      durationSeconds: 200, // > 180s ideal, well under the 1GB byte cap
    });
    const [result] = service.validate(
      'Reel',
      [longReel],
      [{ platform: SocialPlatform.INSTAGRAM, placement: SocialPlacement.REEL }],
    );
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.map((w) => w.code)).toContain(
      'VIDEO_LONGER_THAN_IDEAL',
    );
  });

  it('errors when too many images are attached for X Feed', () => {
    const images = Array.from({ length: 5 }, () => media());
    const [result] = service.validate('Photo dump', images, [
      { platform: SocialPlatform.X, placement: SocialPlacement.FEED },
    ]);
    expect(result.errors.map((e) => e.code)).toContain('TOO_MANY_IMAGES');
  });

  it('errors when the caption exceeds the platform+placement character limit', () => {
    const [result] = service.validate(
      'a'.repeat(300),
      [media()],
      [{ platform: SocialPlatform.X, placement: SocialPlacement.FEED }],
    );
    expect(result.errors.map((e) => e.code)).toContain('CAPTION_TOO_LONG');
  });

  it('validates each target independently — one failing does not affect another', () => {
    const results = service.validate(
      'a'.repeat(300),
      [media()],
      [
        { platform: SocialPlatform.X, placement: SocialPlacement.FEED },
        { platform: SocialPlatform.FACEBOOK, placement: SocialPlacement.FEED },
      ],
    );
    expect(results[0].errors.length).toBeGreaterThan(0);
    expect(results[1].errors).toHaveLength(0);
  });
});
