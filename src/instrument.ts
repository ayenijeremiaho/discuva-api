import * as Sentry from '@sentry/node';

// Imported as the very first line of main.ts, before any other import —
// Sentry's Node SDK patches http/pg/etc. at module-load time for automatic
// instrumentation, which only works if init() runs before those modules are
// first required anywhere in the dependency graph.
//
// No-ops entirely when SENTRY_DSN is unset (local dev, CI) — matches this
// project's convention for every other optional external integration
// (email/SMS providers, Cloudinary, etc.): absence of config disables the
// feature rather than crashing startup. SENTRY_ENABLED is a separate,
// explicit kill switch on top of that — lets ops flip reporting off
// without touching the DSN (e.g. temporarily muting a noisy deploy)
// without treating "DSN configured" as an implicit always-on.
const dsn = process.env.SENTRY_DSN;
const enabled = (process.env.SENTRY_ENABLED ?? 'true') === 'true';
if (dsn && enabled) {
  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    // Error tracking only for now — no performance/tracing sampling, which
    // is a separate, heavier-weight concern (APM) not part of this ask.
    tracesSampleRate: 0,
  });
}
