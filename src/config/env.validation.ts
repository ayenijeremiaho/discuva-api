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

  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRY_IN: Joi.string().default('1h'),
  REFRESH_JWT_SECRET: Joi.string().min(32).required(),
  REFRESH_JWT_EXPIRY_IN: Joi.string().default('7d'),

  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_DB: Joi.number().default(0),

  EMAIL_PROVIDER: Joi.string().valid('gmail', 'resend').default('gmail'),
  EMAIL_FROM: Joi.string().optional(),

  // Gmail provider
  EMAIL_HOST: Joi.string().optional(),
  EMAIL_PORT: Joi.number().optional(),
  EMAIL_SECURE: Joi.boolean().default(false),
  EMAIL_USER: Joi.string().optional(),
  EMAIL_PASSWORD: Joi.string().optional(),

  // Resend provider
  RESEND_API_KEY: Joi.string().optional(),

  LOGIN_URL: Joi.string().uri().required(),
  ADMIN_LOGIN_URL: Joi.string().uri().required(),

  THROTTLE_TTL_MS: Joi.number().default(60_000),
  THROTTLE_LIMIT: Joi.number().default(100),

  LOGIN_MAX_ATTEMPTS: Joi.number().default(5),
  LOGIN_WINDOW_SECONDS: Joi.number().default(900),

  DEVICE_RESET_MAX_ATTEMPTS: Joi.number().default(3),
  DEVICE_RESET_WINDOW_SECONDS: Joi.number().default(86400),

  CLOUDINARY_CLOUD_NAME: Joi.string().required(),
  CLOUDINARY_API_KEY: Joi.string().required(),
  CLOUDINARY_API_SECRET: Joi.string().required(),

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

  PRODUCT_NAME: Joi.string().default('Discovery Hub'),
  CHURCH_NAME: Joi.string().default('RCCG Discovery Centre'),
  CHURCH_TAGLINE: Joi.string().default(
    'Destinies discovered, Champions raised',
  ),
  CHURCH_ADDRESS: Joi.string().default(
    '62 Igi Olugbin Street, Bariga. Lagos, Nigeria',
  ),
  DEFAULT_VENUE_NAME: Joi.string().default('RCCG Discovery Centre'),

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

  SESSION_MAX_AGE_DAYS: Joi.number().integer().min(1).default(30),
  DEFAULT_ADMIN_EMAIL: Joi.string().email().optional(),
  DEFAULT_ADMIN_PASSWORD_HASH: Joi.string().optional(),
  DEFAULT_VENUE_ADDRESS: Joi.string().default(
    '62 Igi Olugbin Street, Bariga. Lagos, Nigeria',
  ),
  DEFAULT_VENUE_LATITUDE: Joi.number().default(6.5244),
  DEFAULT_VENUE_LONGITUDE: Joi.number().default(3.3792),
  DEFAULT_EVENT_CONFIG_NAME: Joi.string().default('Default Event Config'),
  DEFAULT_EVENT_ALLOWED_DISTANCE_IN_METERS: Joi.number().default(100),

  WORKER_CHECKIN_START_OFFSET_SECONDS: Joi.number().default(-1800),
  WORKER_LATE_OFFSET_SECONDS: Joi.number().default(0),
  MEMBER_CHECKIN_START_OFFSET_SECONDS: Joi.number().default(-900),
  CHECKIN_STOP_OFFSET_SECONDS: Joi.number().default(3600),

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

  BULL_BOARD_USER: Joi.string().optional(),
  BULL_BOARD_PASSWORD: Joi.string().optional(),

  TERMII_API_KEY: Joi.string().optional(),
  TERMII_SENDER_ID: Joi.string().optional(),
  TERMII_BASE_URL: Joi.string().uri().default('https://api.ng.termii.com'),
}).options({ allowUnknown: true });
