export enum PlatformSettingKey {
  SUBSCRIPTION_GRACE_PERIOD_DAYS = 'subscription_grace_period_days',
  // Stored in MB (not bytes) — this is the unit a platform admin actually
  // types into a form field. Consumers convert to bytes at read time.
  MAX_LOGO_UPLOAD_MB = 'max_logo_upload_mb',
  MAX_AVATAR_UPLOAD_MB = 'max_avatar_upload_mb',
  MAX_CLASS_MATERIAL_UPLOAD_MB = 'max_class_material_upload_mb',
  MAX_FINANCE_PROOF_UPLOAD_MB = 'max_finance_proof_upload_mb',
}
