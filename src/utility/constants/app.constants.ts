// Application-wide constants. Branding/org values are configured via environment
// variables (PRODUCT_NAME, CHURCH_NAME, CHURCH_ADDRESS) and validated by Joi at
// startup — read them through ConfigService, not process.env.

// Exception to the rule above: @Cron() decorator options are evaluated at class
// decoration time (module import), before ConfigModule.forRoot() has run and before
// Nest's DI container exists — ConfigService isn't reachable there. Falls back to the
// same default as TIMEZONE in env.validation.ts so behaviour matches ConfigService.get()
// even when process.env.TIMEZONE isn't populated yet at import time.
export const CHURCH_TIMEZONE = process.env.TIMEZONE || 'Africa/Lagos';
