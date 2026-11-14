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
  [PlatformSettingKey.MAX_CHURCH_CALENDAR_IMAGE_UPLOAD_MB]: {
    label: 'Church Calendar Image Upload Limit',
    unit: 'MB — per-entry photos on a Church Calendar',
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
  [PlatformSettingKey.SELF_SERVE_REQUIRES_APPROVAL]: {
    label: 'Require Manual Approval for Signups',
    unit: 'off = auto-provision self-serve signups immediately; on = hold for a platform admin to approve — 0 = off, 1 = on',
    defaultValue: 0,
    min: 0,
    max: 1,
    type: 'boolean',
  },
  [PlatformSettingKey.REQUEST_REVIEW_HOURS]: {
    label: 'Promised Verification Review Time',
    unit: 'hours, shown when someone asks to be verified',
    defaultValue: 24,
    min: 1,
    max: 168,
  },
  [PlatformSettingKey.UNVERIFIED_DAILY_EMAIL_LIMIT]: {
    label: 'Daily Email Limit for Unverified Accounts',
    unit: "emails a day through Discuva's provider. Security notices and receipts aren't counted",
    defaultValue: 20,
    min: 0,
    max: 1000,
  },
  [PlatformSettingKey.ACCOUNT_ARCHIVE_AFTER_DAYS]: {
    label: 'Archive Inactive Accounts After',
    unit: 'days without a sign-in. Unverified free accounts only',
    defaultValue: 90,
    min: 7,
    max: 3650,
  },
  [PlatformSettingKey.ACCOUNT_DELETE_AFTER_DAYS]: {
    label: 'Delete Inactive Accounts After',
    unit: 'days without a sign-in. Must be later than archiving',
    defaultValue: 100,
    min: 8,
    max: 3650,
  },
  [PlatformSettingKey.DISCUVA_ACCOUNT_MODE]: {
    label: 'One Discuva Sign-in',
    unit: '0 = off, 1 = test churches only (DISCUVA_ACCOUNT_TEST_TENANTS), 2 = every church',
    defaultValue: 0,
    min: 0,
    max: 2,
  },
  [PlatformSettingKey.CHURCH_DELETE_MAX_MEMBERS]: {
    label: 'Console Church Delete Limit',
    unit: 'most members a live church can have and still be deleted from the console (suspend it first)',
    defaultValue: 25,
    min: 0,
    max: 500,
  },
  [PlatformSettingKey.ACCOUNT_CODE_TTL_MINUTES]: {
    label: 'Discuva Account Code Life',
    unit: 'minutes a join or link code stays valid',
    defaultValue: 10,
    min: 5,
    max: 30,
  },
  [PlatformSettingKey.ACCOUNT_CODE_MAX_ATTEMPTS]: {
    label: 'Discuva Account Code Attempts',
    unit: 'wrong tries per code before a new one is needed',
    defaultValue: 5,
    min: 3,
    max: 10,
  },
  [PlatformSettingKey.ACCOUNT_CODE_REQUESTS_PER_HOUR]: {
    label: 'Discuva Account Code Requests',
    unit: 'join or link codes per hour, per email and device',
    defaultValue: 3,
    min: 1,
    max: 10,
  },
  [PlatformSettingKey.ACCOUNT_LINK_VALID_DAYS]: {
    label: 'Email-change Undo and Freeze Links',
    unit: 'days the "undo" and "this wasn\'t me" links in security emails keep working',
    defaultValue: 7,
    min: 1,
    max: 30,
  },
  [PlatformSettingKey.ACCOUNT_RECOVERY_WAIT_DAYS]: {
    label: 'Wait Between Account Recoveries',
    unit: 'days before an admin can recover the same Discuva account again',
    defaultValue: 7,
    min: 1,
    max: 30,
  },
  [PlatformSettingKey.ADMIN_ACCESS_MODE]: {
    label: 'Individual Admin and Form Access',
    unit: '0 = off, 1 = test organisations (ADMIN_ACCESS_TEST_TENANTS), 2 = every organisation',
    defaultValue: 0,
    min: 0,
    max: 2,
  },
  [PlatformSettingKey.DISCUVA_PROFILE_MODE]: {
    label: 'Global Profile',
    unit: '0 = off, 1 = test churches only (DISCUVA_ACCOUNT_TEST_TENANTS), 2 = every church. Needs One Discuva Sign-in on too',
    defaultValue: 0,
    min: 0,
    max: 2,
  },
  [PlatformSettingKey.PHOTO_REPORT_REMOVALS]: {
    label: 'Photo Removals Before a Report',
    unit: 'photos admins remove from one person before it shows under Photo reports',
    defaultValue: 3,
    min: 2,
    max: 20,
  },
  [PlatformSettingKey.PHOTO_REPORT_WINDOW_DAYS]: {
    label: 'Photo Report Window',
    unit: 'days the photo removals are counted over',
    defaultValue: 90,
    min: 7,
    max: 365,
  },
  [PlatformSettingKey.ACCOUNT_DELETE_GRACE_DAYS]: {
    label: 'Discuva Account Deletion Wait',
    unit: 'days a person can cancel deleting their Discuva account',
    defaultValue: 14,
    min: 1,
    max: 60,
  },
  [PlatformSettingKey.LOGIN_MAX_ATTEMPTS]: {
    label: 'Wrong Passwords Before a Pause',
    unit: 'tries per email from the registered phone, from other phones, or from one network address in the portal',
    defaultValue: 5,
    min: 3,
    max: 10,
  },
  [PlatformSettingKey.LOGIN_LOCK_MINUTES]: {
    label: 'Sign-in Pause Length',
    unit: 'minutes before wrong-password tries are allowed again',
    defaultValue: 15,
    min: 5,
    max: 60,
  },
  [PlatformSettingKey.PORTAL_LOGIN_CAP]: {
    label: 'Admin Portal Wrong-password Cap',
    unit: 'tries per email across every network address, in the same pause length',
    defaultValue: 20,
    min: 10,
    max: 100,
  },
  [PlatformSettingKey.DEVICE_RESET_MAX_REQUESTS]: {
    label: 'Device Reset Requests',
    unit: 'Reset Device Access codes per email and requesting phone',
    defaultValue: 3,
    min: 1,
    max: 5,
  },
  [PlatformSettingKey.DEVICE_RESET_WINDOW_HOURS]: {
    label: 'Device Reset Window',
    unit: 'hours the device reset request count covers',
    defaultValue: 24,
    min: 1,
    max: 48,
  },
  [PlatformSettingKey.OTP_VERIFY_MAX_ATTEMPTS]: {
    label: 'Wrong Code Tries',
    unit: 'wrong tries per password-reset, device-reset or email-change code',
    defaultValue: 5,
    min: 3,
    max: 10,
  },
  [PlatformSettingKey.COMMUNITY_MAX_CATEGORIES]: {
    label: 'Community Categories',
    unit: "categories at most in an account's Community space",
    defaultValue: 8,
    min: 1,
    max: 30,
  },
  [PlatformSettingKey.UNVERIFIED_GROUP_MEMBER_LIMIT]: {
    label: 'Private Group Member Limit',
    unit: 'people, until a small group is verified',
    defaultValue: 50,
    min: 5,
    max: 1000,
  },
  [PlatformSettingKey.ACCOUNT_AUTO_DELETE]: {
    label: 'Permanently Delete Inactive Accounts',
    unit: 'off = archive only; on = permanently delete the data — 0 = off, 1 = on',
    defaultValue: 0,
    min: 0,
    max: 1,
    type: 'boolean',
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
  | PlatformSettingKey.MAX_PAGE_IMAGE_UPLOAD_MB
  | PlatformSettingKey.MAX_CHURCH_CALENDAR_IMAGE_UPLOAD_MB,
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
  [PlatformSettingKey.MAX_CHURCH_CALENDAR_IMAGE_UPLOAD_MB]:
    KNOWN_PLATFORM_SETTINGS[
      PlatformSettingKey.MAX_CHURCH_CALENDAR_IMAGE_UPLOAD_MB
    ].max *
    1024 *
    1024,
};
