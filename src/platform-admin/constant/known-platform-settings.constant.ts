import { PlatformSettingKey } from '../enum/platform-setting-key.enum';

export interface KnownPlatformSetting {
  label: string;
  unit: string;
  defaultValue: number;
  min: number;
  max: number;
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
  | PlatformSettingKey.MAX_FINANCE_PROOF_UPLOAD_MB,
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
};
