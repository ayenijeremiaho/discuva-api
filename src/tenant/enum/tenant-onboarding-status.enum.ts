export enum TenantOnboardingStatus {
  PENDING = 'PENDING',
  // Self-serve only — a signup held for a platform admin to review, rather
  // than auto-enqueueing provisioning. See
  // PlatformSettingKey.SELF_SERVE_REQUIRES_APPROVAL. Never reached by
  // platform-admin-initiated tenant creation, which stays instant.
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  // Waiting for the requester and the church address to confirm their emails.
  AWAITING_CONFIRMATION = 'AWAITING_CONFIRMATION',
  PROVISIONING = 'PROVISIONING',
  ACTIVE = 'ACTIVE',
  FAILED = 'FAILED',
}
