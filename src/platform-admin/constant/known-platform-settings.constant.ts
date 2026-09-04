import { PlatformSettingKey } from '../enum/platform-setting-key.enum';

export interface KnownPlatformSetting {
  label: string;
  unit: string;
  defaultValue: number;
  min: number;
  max: number;
  // 'boolean' settings are still stored/transmitted as 0/1 (no new column
  // shape needed) — this is purely a rendering hint so a settings UI shows
  // a toggle instead of a number input. Omitted = 'number' (the default
  // every existing setting already is).
  type?: 'number' | 'boolean';
}

export const KNOWN_PLATFORM_SETTINGS: Record<
  PlatformSettingKey,
  KnownPlatformSetting
> = {
  [PlatformSettingKey.SUBSCRIPTION_GRACE_PERIOD_DAYS]: {
    label: 'Subscription Grace Period',
    unit: 'days after payment lapse before downgrade to Free',
    defaultValue: 7,
    min: 0,
    max: 365,
  },
  [PlatformSettingKey.MAX_LOGO_UPLOAD_MB]: {
    label: 'Logo & Appearance Image Upload Limit',
    unit: 'MB — church logo and mobile app appearance images',
    defaultValue: 5,
    min: 1,
    max: 25,
  },
  [PlatformSettingKey.MAX_AVATAR_UPLOAD_MB]: {
    label: 'Profile Photo Upload Limit',
    unit: 'MB — member profile pictures',
    defaultValue: 3,
    min: 1,
    max: 15,
  },
  [PlatformSettingKey.MAX_CLASS_MATERIAL_UPLOAD_MB]: {
    label: 'Class Material Upload Limit',
    unit: 'MB — training class documents, slides, and images',
    defaultValue: 10,
    min: 1,
    max: 50,
  },
  [PlatformSettingKey.MAX_FINANCE_PROOF_UPLOAD_MB]: {
    label: 'Finance Proof Upload Limit',
    unit: 'MB — payment-proof attachments on finance requests',
    defaultValue: 10,
    min: 1,
    max: 50,
  },
  [PlatformSettingKey.MAX_FORM_ATTACHMENT_UPLOAD_MB]: {
    label: 'Form Attachment Upload Limit',
    unit: 'MB — files uploaded to a FILE-type field on a form',
    defaultValue: 10,
    min: 1,
    max: 50,
  },
  [PlatformSettingKey.MAX_PAGE_IMAGE_UPLOAD_MB]: {
    label: 'Page Image Upload Limit',
    unit: 'MB — hero, speaker, gallery, and OG images on a public Page',
    defaultValue: 5,
    min: 1,
    max: 25,
  },
  [PlatformSettingKey.ENFORCE_DISTANCE_CHECK_DEFAULT]: {
    label: 'Enforce Attendance Distance Check',
    unit: 'default for churches that have not set their own override — 0 = off, 1 = on',
    // Not the real fallback — PlatformSettingsService.resolveDefault()
    // reads the live ENFORCE_DISTANCE_CHECK env var instead whenever no
    // row exists yet, so an environment that already has it set to true
    // isn't silently reset to off the moment this ships. This value only
    // matters if that env read somehow comes back undefined.
    defaultValue: 0,
    min: 0,
    max: 1,
    type: 'boolean',
  },
  [PlatformSettingKey.SOCIAL_MEDIA_DRAFT_RETENTION_DAYS]: {
    label: 'Social Media Draft Retention',
    unit: "days an unpublished draft post's uploaded media is kept before automatic deletion",
    defaultValue: 30,
    min: 1,
    max: 365,
  },
};

// Multer parses to memory before our own dynamic per-setting check can run
// (see DynamicLimitedFileInterceptor) — this is the hard, non-configurable
// ceiling Multer itself enforces, always >= the relevant setting's `max`
// above, so the live-configured value is always the binding constraint in
// normal operation.
export const UPLOAD_HARD_CEILING_BYTES: Record<
  | PlatformSettingKey.MAX_LOGO_UPLOAD_MB
  | PlatformSettingKey.MAX_AVATAR_UPLOAD_MB
  | PlatformSettingKey.MAX_CLASS_MATERIAL_UPLOAD_MB
  | PlatformSettingKey.MAX_FINANCE_PROOF_UPLOAD_MB
  | PlatformSettingKey.MAX_FORM_ATTACHMENT_UPLOAD_MB
  | PlatformSettingKey.MAX_PAGE_IMAGE_UPLOAD_MB,
  number
> = {
  [PlatformSettingKey.MAX_LOGO_UPLOAD_MB]:
    KNOWN_PLATFORM_SETTINGS[PlatformSettingKey.MAX_LOGO_UPLOAD_MB].max *
    1024 *
    1024,
  [PlatformSettingKey.MAX_AVATAR_UPLOAD_MB]:
    KNOWN_PLATFORM_SETTINGS[PlatformSettingKey.MAX_AVATAR_UPLOAD_MB].max *
    1024 *
    1024,
  [PlatformSettingKey.MAX_CLASS_MATERIAL_UPLOAD_MB]:
    KNOWN_PLATFORM_SETTINGS[PlatformSettingKey.MAX_CLASS_MATERIAL_UPLOAD_MB]
      .max *
    1024 *
    1024,
  [PlatformSettingKey.MAX_FINANCE_PROOF_UPLOAD_MB]:
    KNOWN_PLATFORM_SETTINGS[PlatformSettingKey.MAX_FINANCE_PROOF_UPLOAD_MB]
      .max *
    1024 *
    1024,
  [PlatformSettingKey.MAX_FORM_ATTACHMENT_UPLOAD_MB]:
    KNOWN_PLATFORM_SETTINGS[PlatformSettingKey.MAX_FORM_ATTACHMENT_UPLOAD_MB]
      .max *
    1024 *
    1024,
  [PlatformSettingKey.MAX_PAGE_IMAGE_UPLOAD_MB]:
    KNOWN_PLATFORM_SETTINGS[PlatformSettingKey.MAX_PAGE_IMAGE_UPLOAD_MB].max *
    1024 *
    1024,
};
