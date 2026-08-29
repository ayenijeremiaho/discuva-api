import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SocialPlacement, SocialPlatform } from '../enum/social-media.enum';

// Generous, not a real per-platform limit — SocialMediaValidationService is
// the actual per-(platform, placement) caption-length gate at publish time.
// This just stops an absurdly large payload.
const MAX_CONTENT_LENGTH = 70_000;

export class CreateSocialAccountDto {
  @IsEnum(SocialPlatform)
  platform: SocialPlatform;

  @IsNotEmpty()
  @IsString()
  displayName: string;
}

export class SocialPostTargetDto {
  @IsUUID('4')
  accountId: string;

  @IsEnum(SocialPlacement)
  placement: SocialPlacement;

  // "Customize for this platform" at creation time — most targets omit
  // this and share SocialPost.content.
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  contentOverride?: string;
}

export class CreateSocialPostDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  content: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SocialPostTargetDto)
  targets: SocialPostTargetDto[];
}

// A separate action from create() — mirrors publish() being its own
// endpoint rather than a create-time flag, so media/targets can be
// attached to a draft first, then scheduled once ready.
export class ScheduleSocialPostDto {
  @IsDateString()
  scheduledFor: string;
}

// null explicitly clears the override, reverting the target back to
// sharing SocialPost.content — @ValidateIf, not @IsOptional, since the
// field must still be present (just possibly null), same nullable-field
// pattern EnrollGuestDto uses elsewhere in this module.
export class UpdateTargetOverrideDto {
  @ValidateIf((o) => o.contentOverride !== null)
  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  contentOverride: string | null;
}

// Both null clears the focal point (reverting to Cloudinary's g_auto
// content-aware cropping); both must be set or cleared together —
// SocialPostService enforces that, not this DTO.
export class UpdateTargetFocalPointDto {
  @ValidateIf((o) => o.x !== null)
  @IsNumber()
  @Min(0)
  @Max(1)
  x: number | null;

  @ValidateIf((o) => o.y !== null)
  @IsNumber()
  @Min(0)
  @Max(1)
  y: number | null;
}
