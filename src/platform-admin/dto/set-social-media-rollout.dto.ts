import { ArrayUnique, IsBoolean, IsString, IsUUID } from 'class-validator';

// A single, all-or-specific rollout state for the 'social_media' module —
// the one control surface a platform admin uses instead of separately
// editing Plan.features (for "everyone") and each tenant's moduleOverrides
// (for "just this one"). setSocialMediaRollout() decides which underlying
// mechanism to write based on whether tenantIds is empty.
export class SetSocialMediaRolloutDto {
  @IsBoolean()
  enabled: boolean;

  // Empty + enabled=true means "everyone" (including tenants created
  // later). Non-empty + enabled=true means "only these tenants, right now."
  @IsUUID('4', { each: true })
  @ArrayUnique()
  @IsString({ each: true })
  tenantIds: string[];
}
