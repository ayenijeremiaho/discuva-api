export enum PlatformSettingKey {
  SUBSCRIPTION_GRACE_PERIOD_DAYS = 'subscription_grace_period_days',
  // Stored in MB (not bytes) — this is the unit a platform admin actually
  // types into a form field. Consumers convert to bytes at read time.
  MAX_LOGO_UPLOAD_MB = 'max_logo_upload_mb',
  MAX_AVATAR_UPLOAD_MB = 'max_avatar_upload_mb',
  MAX_CLASS_MATERIAL_UPLOAD_MB = 'max_class_material_upload_mb',
  MAX_FINANCE_PROOF_UPLOAD_MB = 'max_finance_proof_upload_mb',
  // Boolean (0/1) — whether attendance check-in enforces the venue distance
  // check by default, for tenants that haven't set their own override (see
  // AttendanceSettingsService). Falls back to the ENFORCE_DISTANCE_CHECK env
  // var when no row exists yet, not a hardcoded default — see
  // PlatformSettingsService.resolveDefault().
  ENFORCE_DISTANCE_CHECK_DEFAULT = 'enforce_distance_check_default',
  // Days a DRAFT social post's uploaded media (SocialPostMedia + its
  // Cloudinary asset) is kept before SocialMediaRetentionScheduler deletes
  // it. Published posts' media is retained indefinitely regardless of this
  // setting — only unpublished drafts age out.
  SOCIAL_MEDIA_DRAFT_RETENTION_DAYS = 'social_media_draft_retention_days',
}
