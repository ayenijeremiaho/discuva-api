export enum PlatformSettingKey {
  SUBSCRIPTION_GRACE_PERIOD_DAYS = 'subscription_grace_period_days',
  // Stored in MB (not bytes) — this is the unit a platform admin actually
  // types into a form field. Consumers convert to bytes at read time.
  MAX_LOGO_UPLOAD_MB = 'max_logo_upload_mb',
  MAX_AVATAR_UPLOAD_MB = 'max_avatar_upload_mb',
  MAX_CLASS_MATERIAL_UPLOAD_MB = 'max_class_material_upload_mb',
  MAX_FINANCE_PROOF_UPLOAD_MB = 'max_finance_proof_upload_mb',
  MAX_FORM_ATTACHMENT_UPLOAD_MB = 'max_form_attachment_upload_mb',
  MAX_PAGE_IMAGE_UPLOAD_MB = 'max_page_image_upload_mb',
  MAX_CHURCH_CALENDAR_IMAGE_UPLOAD_MB = 'max_church_calendar_image_upload_mb',
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
  // Boolean (0/1) — when on, a self-serve POST /signup is held
  // AWAITING_APPROVAL instead of auto-enqueueing provisioning; a platform
  // admin with TENANTS_WRITE is emailed and must approve it. Off means
  // today's behavior — auto-provision immediately. See
  // TenantProvisioningService.holdForApproval/PlatformTenantService.approveTenant.
  SELF_SERVE_REQUIRES_APPROVAL = 'self_serve_requires_approval',
  // The verification review time promised to churches.
  REQUEST_REVIEW_HOURS = 'request_review_hours',
  UNVERIFIED_DAILY_EMAIL_LIMIT = 'unverified_daily_email_limit',
  UNVERIFIED_GROUP_MEMBER_LIMIT = 'unverified_group_member_limit',
  ACCOUNT_ARCHIVE_AFTER_DAYS = 'account_archive_after_days',
  ACCOUNT_DELETE_AFTER_DAYS = 'account_delete_after_days',
  ACCOUNT_AUTO_DELETE = 'account_auto_delete',
  COMMUNITY_MAX_CATEGORIES = 'community_max_categories',
  // 0 off, 1 only churches in DISCUVA_ACCOUNT_TEST_TENANTS, 2 every church.
  DISCUVA_ACCOUNT_MODE = 'discuva_account_mode',
  ACCOUNT_CODE_TTL_MINUTES = 'account_code_ttl_minutes',
  ACCOUNT_CODE_MAX_ATTEMPTS = 'account_code_max_attempts',
  ACCOUNT_CODE_REQUESTS_PER_HOUR = 'account_code_requests_per_hour',
  ACCOUNT_LINK_VALID_DAYS = 'account_link_valid_days',
  ACCOUNT_RECOVERY_WAIT_DAYS = 'account_recovery_wait_days',
  // Sign-in limits; until set here they follow the matching environment variables.
  LOGIN_MAX_ATTEMPTS = 'login_max_attempts',
  LOGIN_LOCK_MINUTES = 'login_lock_minutes',
  PORTAL_LOGIN_CAP = 'portal_login_cap',
  DEVICE_RESET_MAX_REQUESTS = 'device_reset_max_requests',
  DEVICE_RESET_WINDOW_HOURS = 'device_reset_window_hours',
  OTP_VERIFY_MAX_ATTEMPTS = 'otp_verify_max_attempts',
}
