// Broader than RESERVED_SUBDOMAINS (extract-subdomain.ts — words that would
// collide with a real routed service, e.g. 'api'/'admin', blocked for
// *everyone* including platform admins since claiming one would break
// routing) — this additionally blocks generic/throwaway-sounding names a
// free-tier signup could squat on, and words that would look unprofessional
// or enable phishing if claimed by an unvetted signup (e.g. "login.<domain>"
// reads as legitimate to anyone who doesn't check closely). Unlike
// RESERVED_SUBDOMAINS, this list is a policy call, not a technical one —
// TenantProvisioningService.ensurePendingTenant lets a trusted,
// authenticated platform admin bypass just this half (never the
// routing-critical half) when they deliberately want e.g. a real sales-demo
// tenant at "demo.<domain>".
//
// Checked only at signup time, not by extractSubdomain — an existing tenant
// that somehow already holds one of these keeps resolving normally; this
// only stops a *new* claim.
export const GENERIC_OR_ABUSE_PRONE_SUBDOMAINS = new Set([
  // Throwaway / non-committal — free-tier signup makes these cheap to
  // squat on with zero intent to actually use the church platform.
  'test',
  'test1',
  'test2',
  'testing',
  'dev',
  'develop',
  'development',
  'demo',
  'demo1',
  'sample',
  'example',
  'staging',
  'stage',
  'sandbox',
  'temp',
  'temporary',
  'tmp',
  'trial',
  'preview',
  // Placeholder-y / null-like — not a real church name.
  'none',
  'null',
  'undefined',
  'na',
  'nil',
  'default',
  'new',
  'old',
  // Could be mistaken for an official Discuva surface, or enable phishing
  // if an unvetted signup claimed one (e.g. a fake "login" or "billing"
  // subdomain used to harvest credentials/card details).
  'login',
  'signin',
  'signup',
  'register',
  'auth',
  'sso',
  'account',
  'accounts',
  'secure',
  'security',
  'verify',
  'support',
  'help',
  'status',
  'billing',
  'payment',
  'pay',
  'checkout',
  // Infrastructure-adjacent — not currently routed anywhere, but reserved
  // in case they are later, same reasoning as RESERVED_SUBDOMAINS.
  'mail',
  'email',
  'smtp',
  'ftp',
  'cdn',
  'static',
  'assets',
  'media',
  'files',
  'docs',
  'blog',
  'dashboard',
  'portal',
  'console',
  'webmail',
]);
