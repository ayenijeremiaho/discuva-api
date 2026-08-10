import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  CORS_ORIGINS: Joi.string().required(),

  DATABASE_HOST: Joi.string().required(),
  DATABASE_PORT: Joi.number().default(5432),
  DATABASE_USER: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_NAME: Joi.string().required(),
  DATABASE_SSL: Joi.boolean().default(false),
  DATABASE_LOGGING: Joi.boolean().default(false),
  DATABASE_DEBUG: Joi.boolean().default(false),
  DATABASE_POOL: Joi.string().default('transaction'),
  DATABASE_POOL_SIZE: Joi.number().default(50),
  DATABASE_POOL_MIN: Joi.number().default(10),
  DATABASE_POOL_LOG: Joi.boolean().default(false),
  APP_NAME: Joi.string().default('discuva-api'),
  // TenantMiddleware strips this suffix off the request Host header to
  // find a tenant's subdomain (docs/MULTI_TENANT_MIGRATION.md §4.3).
  // 'localhost' in dev — *.localhost resolves to 127.0.0.1 in every modern
  // browser/Node with no /etc/hosts changes needed.
  APP_BASE_DOMAIN: Joi.string().default('localhost'),

  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRY_IN: Joi.string().default('1h'),
  REFRESH_JWT_SECRET: Joi.string().min(32).required(),
  REFRESH_JWT_EXPIRY_IN: Joi.string().default('7d'),
  PLATFORM_ADMIN_JWT_SECRET: Joi.string().min(32).required(),
  PLATFORM_ADMIN_JWT_EXPIRY_IN: Joi.string().default('1h'),
  // Symmetric key for encrypting tenant BYOK communication-provider
  // credentials at rest (src/utility/service/encryption.service.ts) —
  // hashed to a 32-byte AES-256 key, so same min-length convention as the
  // JWT secrets above, no fixed hex/base64 format required.
  CREDENTIALS_ENCRYPTION_KEY: Joi.string().min(32).required(),

  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_DB: Joi.number().default(0),
  REDIS_TLS: Joi.boolean().default(false),

  EMAIL_PROVIDER: Joi.string().valid('gmail', 'resend').default('gmail'),
  EMAIL_FROM: Joi.string().optional(),

  EMAIL_HOST: Joi.string().optional(),
  EMAIL_PORT: Joi.number().optional(),
  EMAIL_SECURE: Joi.boolean().default(false),
  EMAIL_USER: Joi.string().optional(),
  EMAIL_PASSWORD: Joi.string().optional(),

  RESEND_API_KEY: Joi.string().optional(),

  // SendGrid provider — platform-default API key; tenants may override via
  // their own BYOK credentials instead. SENDGRID_BASE_URL matches every
  // sibling provider's own *_BASE_URL override (Mailgun/Paystack/Flutterwave)
  // for region failover / test doubles.
  SENDGRID_API_KEY: Joi.string().optional(),
  SENDGRID_BASE_URL: Joi.string().uri().optional(),

  // Mailgun provider — platform-default API key/domain; MAILGUN_BASE_URL
  // lets the EU region (api.eu.mailgun.net/v3) be selected without a code
  // change.
  MAILGUN_API_KEY: Joi.string().optional(),
  MAILGUN_DOMAIN: Joi.string().optional(),
  MAILGUN_BASE_URL: Joi.string().uri().optional(),

  LOGIN_URL: Joi.string().uri().required(),
  ADMIN_LOGIN_URL: Joi.string().uri().required(),
  PLATFORM_LOGIN_URL: Joi.string().uri().required(),
  SUPPORT_FORM_URL: Joi.string().uri().optional(),
  EXPLAINER_VIDEO_ANDROID_URL: Joi.string().uri().optional(),
  EXPLAINER_VIDEO_IOS_URL: Joi.string().uri().optional(),

  THROTTLE_TTL_MS: Joi.number().default(60_000),
  THROTTLE_LIMIT: Joi.number().default(100),

  LOGIN_MAX_ATTEMPTS: Joi.number().default(5),
  LOGIN_WINDOW_SECONDS: Joi.number().default(900),

  DEVICE_RESET_MAX_ATTEMPTS: Joi.number().default(3),
  DEVICE_RESET_WINDOW_SECONDS: Joi.number().default(86400),

  CLOUDINARY_CLOUD_NAME: Joi.string().required(),
  CLOUDINARY_API_KEY: Joi.string().required(),
  CLOUDINARY_API_SECRET: Joi.string().required(),

  SENTRY_DSN: Joi.string().allow('').optional(),
  SENTRY_ENABLED: Joi.string().valid('true', 'false').default('true'),
  SENTRY_ENVIRONMENT: Joi.string().optional(),

  POSTMAN_URL: Joi.string()
    .uri()
    .default(
      'https://www.postman.com/workers-team/workspace/discovery-hub-api',
    ),
  LOGO_URL: Joi.string()
    .uri()
    .default(
      'https://res.cloudinary.com/dap7jwvms/image/upload/v1781539923/DC_LOGO_aswzgi.png',
    ),

  PRODUCT_NAME: Joi.string().default('Discuva'),
  CHURCH_NAME: Joi.string().default('RCCG Discovery Centre'),
  CHURCH_TAGLINE: Joi.string().default(
    'Destinies discovered, Champions raised',
  ),
  CHURCH_ADDRESS: Joi.string().default(
    '62 Igi Olugbin Street, Bariga. Lagos, Nigeria',
  ),

  CURRENCY_CODE: Joi.string().default('NGN'),
  CURRENCY_LOCALE: Joi.string().default('en-NG'),
  TIMEZONE: Joi.string().default('Africa/Lagos'),

  ONLINE_CHECKIN_WINDOW_HOURS: Joi.number().default(3),
  SERVICE_SLOT_CAUTION_THRESHOLD_RATIO: Joi.number()
    .min(0)
    .max(1)
    .default(0.25),
  FOLLOW_UP_DUE_DAYS: Joi.number().default(3),
  FOLLOW_UP_STALE_DAYS: Joi.number().default(7),
  ENFORCE_DISTANCE_CHECK: Joi.boolean().default(false),
  ANNUAL_GIVING_STATEMENT_ENABLED: Joi.boolean().default(false),

  OTP_TTL_SECONDS: Joi.number().default(900),
  FORGOT_PASSWORD_MAX_ATTEMPTS: Joi.number().default(3),
  FORGOT_PASSWORD_WINDOW_SECONDS: Joi.number().default(3600),

  CACHE_TTL_REFERENCE_SECONDS: Joi.number().default(300),
  CACHE_TTL_LEADERBOARD_SECONDS: Joi.number().default(90),
  WISH_DAILY_LIMIT: Joi.number().default(20),

  INCIDENT_DAILY_REPORT_LIMIT: Joi.number().default(2),
  ASSET_OVERDUE_NOTIFICATION_DAYS: Joi.string().default('1,3,7'),
  TITHE_PROOF_EXPIRY_DAYS: Joi.number().default(90),
  MAX_FILE_UPLOAD_BYTES: Joi.number().default(5 * 1024 * 1024),
  MAX_CLASS_MATERIAL_UPLOAD_BYTES: Joi.number().default(10 * 1024 * 1024),
  // Small-image convention shared by every logo/photo/avatar upload route —
  // tenant logo, tenant custom asset images, member profile photo.
  MAX_AVATAR_UPLOAD_BYTES: Joi.number().default(3 * 1024 * 1024),
  // Finance request payment-proof attachments — deliberately its own var
  // rather than reusing MAX_CLASS_MATERIAL_UPLOAD_BYTES (same 10MB value
  // today, but semantically unrelated; coupling them would mean changing
  // the class-material limit for one reason silently changes this too).
  MAX_FINANCE_PROOF_UPLOAD_BYTES: Joi.number().default(10 * 1024 * 1024),

  SESSION_MAX_AGE_DAYS: Joi.number().integer().min(1).default(30),
  DEFAULT_ADMIN_EMAIL: Joi.string().email().optional(),
  DEFAULT_ADMIN_PASSWORD_HASH: Joi.string().optional(),
  DEFAULT_PLATFORM_ADMIN_EMAIL: Joi.string().email().optional(),
  DEFAULT_PLATFORM_ADMIN_PASSWORD_HASH: Joi.string().optional(),

  EMAIL_SERVICE: Joi.string().default('gmail'),

  VAPID_PUBLIC_KEY: Joi.string().required(),
  VAPID_PRIVATE_KEY: Joi.string().required(),
  VAPID_SUBJECT: Joi.string().uri().required(),

  EMAIL_ATTENDANCE_CHECKIN_ENABLED: Joi.boolean().default(true),
  EMAIL_BIRTHDAY_ENABLED: Joi.boolean().default(true),
  EMAIL_EVENT_REMINDER_ENABLED: Joi.boolean().default(true),
  EMAIL_PRAYER_REMINDER_ENABLED: Joi.boolean().default(true),
  EMAIL_FOLLOW_UP_ENABLED: Joi.boolean().default(true),
  EMAIL_ASSET_ALERTS_ENABLED: Joi.boolean().default(true),
  EMAIL_GIVING_RECEIPT_ENABLED: Joi.boolean().default(true),
  EMAIL_FINANCE_ALERTS_ENABLED: Joi.boolean().default(true),
  EMAIL_SESSION_REPORT_ENABLED: Joi.boolean().default(true),
  EMAIL_INCIDENT_REPORT_ENABLED: Joi.boolean().default(true),
  EMAIL_CHILDREN_CHURCH_ENABLED: Joi.boolean().default(true),
  EMAIL_LOGIN_ALERT_ENABLED: Joi.boolean().default(true),
  EMAIL_PASTOR_FEEDBACK_ENABLED: Joi.boolean().default(true),
  EMAIL_MEMBERSHIP_ANNIVERSARY_ENABLED: Joi.boolean().default(true),

  BULL_BOARD_USER: Joi.string().optional(),
  BULL_BOARD_PASSWORD: Joi.string().optional(),

  // Pure BYOK — every tenant configures their own Termii/Twilio credentials
  // under Communication Providers, there is no platform-default account.
  // Only the API host itself (infrastructure, not a secret) is env-driven.
  TERMII_BASE_URL: Joi.string().uri().default('https://api.ng.termii.com'),

  // Platform-wide fallback Data API key, used when a tenant hasn't set its
  // own via PUT /v1/youtube-integration. Channel id has no platform-wide
  // equivalent — it's always tenant-specific, set the same way.
  YOUTUBE_API_KEY: Joi.string().optional(),
  YOUTUBE_WEBSUB_CALLBACK_URL: Joi.string().uri().optional(),
  // Shared HMAC secret sent as hub.secret on subscribe — the hub then signs
  // every notification with it (X-Hub-Signature), which is how the callback
  // tells a genuine hub delivery apart from a forged POST to the public URL.
  YOUTUBE_WEBSUB_SECRET: Joi.string().optional(),
  PUBSUBHUBBUB_URL: Joi.string()
    .uri()
    .default('https://pubsubhubbub.appspot.com/subscribe'),

  // All optional — a deployment that hasn't set a given provider's keys
  // simply can't be selected as ?provider= on a checkout call
  // (PaymentProviderRegistryService throws a clean 400, not a crash).
  PAYSTACK_SECRET_KEY: Joi.string().optional(),
  PAYSTACK_BASE_URL: Joi.string().uri().default('https://api.paystack.co'),
  FLUTTERWAVE_SECRET_KEY: Joi.string().optional(),
  // Shared secret configured in the Flutterwave dashboard, compared
  // verbatim against the verif-hash webhook header — not an HMAC key.
  FLUTTERWAVE_SECRET_HASH: Joi.string().optional(),
  FLUTTERWAVE_BASE_URL: Joi.string()
    .uri()
    .default('https://api.flutterwave.com/v3'),
  KORA_SECRET_KEY: Joi.string().optional(),
  KORA_BASE_URL: Joi.string()
    .uri()
    .default('https://api.korapay.com/merchant/api/v1'),
  DEFAULT_PAYMENT_PROVIDER: Joi.string()
    .valid('paystack', 'flutterwave', 'kora')
    .default('paystack'),
  // Billing-cycle policy constants — see CheckoutService/SubscriptionLapseScheduler.
  SUBSCRIPTION_PERIOD_DAYS: Joi.number().integer().positive().default(30),
  GRACE_PERIOD_DAYS: Joi.number().integer().positive().default(7),
}).options({ allowUnknown: true });
