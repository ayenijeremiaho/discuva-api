# Multi-Tenant Migration Plan

> **Status:** Active — target: freemium SaaS launch. See [`PRODUCT_STRATEGY.md`](./PRODUCT_STRATEGY.md) for the business
> model this plan implements. This document covers only the technical how; the product paper covers the why and what.

---

## 1. Business Model & Repo Strategy

**Decision (2026-08, supersedes the original open-source + private-fork plan):** Discovery Hub ships as a single
freemium SaaS product, one repo, no self-hosted tier. There is no `discovery-hub-cloud` fork and no upstream/downstream
sync discipline to maintain — `discovery-hub` itself becomes the SaaS backend, and multi-tenancy is infrastructure
added directly into it per §4.

| Tier | Audience | Hosting |
|---|---|---|
| **Free** | Any church, self-serve signup | Platform-operated (shared multi-tenant infrastructure) |
| **Pro** | Churches that need Finance, SMS, and other operational modules | Platform-operated (same infrastructure, plan-gated features) |

Free and Pro are the same codebase, same deployment, same database cluster — the only difference is which
`PlanFeature`s (§4.11) a tenant's active plan unlocks. There is nothing to fork and nothing to keep in sync, because
there is only one version of the product running anywhere.

The frontends follow the same single-repo model:

| App | Repo | Audience |
|---|---|---|
| Admin Portal | `Faithapp-admin` | Church admins/workers (all tiers) |
| Member PWA | `Faithapp` | Church members (all tiers) |
| Platform Dashboard | `discovery-hub-platform` (new) | Platform operators only — never church-facing |

---

## 2. Architecture Decision: Schema-Per-Tenant

Each church gets its own PostgreSQL schema within a single database instance.

```
public
  └── tenants                  ← tenant registry
  └── platform_admins          ← platform operator accounts

church_alpha
  └── members, admins, events, finance, ...

church_beta
  └── members, admins, events, finance, ...
```

### Why schema-per-tenant over alternatives

| Approach | Isolation | Risk | Ops Complexity |
|---|---|---|---|
| Row-level (`tenant_id` column) | Low — one missed filter leaks data | High | Low |
| **Schema-per-tenant** ✓ | High — PostgreSQL enforces it | None | Medium |
| Database-per-tenant | Highest | None | High (connection pool explosion) |

Schema-per-tenant gives database-enforced isolation without the infrastructure overhead of separate databases. No application-level filter discipline required — a query in the wrong schema simply finds no rows.

---

## 3. How Tenant Resolution Works

### Admin portal and PWA (subdomain-based)
```
church-alpha.yourdomain.com       → Admin portal for church Alpha
app.church-alpha.yourdomain.com   → PWA for church Alpha's members
```
The backend reads the `Host` header on every request. No configuration in the frontend — the subdomain IS the tenant identifier.

### Why no church code field is needed for the PWA
The PWA is browser-based, so it has a URL. The subdomain is present on every fetch automatically. When a member installs the PWA to their home screen, the Web App Manifest bakes in the `start_url` which already contains the correct subdomain. The installed app always opens against the right church.

A church code / custom header would only be needed if a native iOS/Android app was shipped through an app store, where the URL is not inherent to the binary.

---

## 4. Backend Migration (`discovery-hub`)

All changes are **additive**. No existing entity, service, controller, or guard needs to be modified. The multi-tenant layer sits underneath the existing business logic.

### 4.1 Public Schema — Tenant Registry

Create a migration that adds the following to the `public` schema (outside any tenant schema):

```sql
CREATE TABLE public.tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subdomain   VARCHAR NOT NULL UNIQUE,        -- 'church-alpha'
  schema_name VARCHAR NOT NULL UNIQUE,        -- 'church_alpha'
  cluster_id  VARCHAR NOT NULL DEFAULT 'default', -- see §12; every tenant points at 'default' until multi-cluster is real
  name        VARCHAR NOT NULL,               -- display name
  logo_url    VARCHAR,
  currency    VARCHAR NOT NULL DEFAULT 'NGN', -- what this church's own tithes/offerings display in — separate concern from plans.currency (what the platform charges), same default for the same reason
  timezone    VARCHAR NOT NULL DEFAULT 'UTC',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.platform_admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR NOT NULL UNIQUE,
  password_hash VARCHAR NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4.2 CLS — Tenant Context Propagation

Install `nestjs-cls`. This wraps Node's `AsyncLocalStorage` so tenant context flows transparently through the full request lifecycle — controllers → services → repositories → Bull job processors — without manually threading a `tenantId` parameter through every call.

```bash
npm install nestjs-cls
```

Register globally in `AppModule`:

```typescript
ClsModule.forRoot({
  global: true,
  middleware: { mount: true },
})
```

The CLS store holds:
```typescript
interface AppClsStore extends ClsStore {
  tenantId: string;
  schemaName: string;
  clusterId: string; // 'default' until multi-cluster (§12) is real — carried from day one so nothing needs retrofitting later
}
```

### 4.3 Tenant Middleware

A NestJS middleware resolves the tenant from the `Host` header and writes it into the CLS store. Runs before every request.

```typescript
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly cls: ClsService,
    private readonly tenantRepository: Repository<Tenant>,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const subdomain = extractSubdomain(req.hostname); // 'church-alpha'
    const tenant = await this.tenantRepository.findOneBy({ subdomain, isActive: true });

    if (!tenant) throw new NotFoundException('Tenant not found');

    this.cls.set('tenantId', tenant.id);
    this.cls.set('schemaName', tenant.schemaName);
    next();
  }
}
```

Exempt routes: `GET /platform/*` (platform admin routes operate on `public` schema directly).

### 4.4 Schema Switching — search_path Per Request

**This section's approach changed after review — read the pooling note before implementing.** The original design
set `search_path` at the session/connection level. That's unsafe here: `env.validation.ts` already defines
`DATABASE_POOL` with a default of `'transaction'`, meaning this app is designed to run behind an external pooler
(PgBouncer/Supavisor) in transaction-pooling mode. Under transaction pooling, a physical connection is returned to
the pool at the end of each transaction and can be handed to a **different tenant's** next request without resetting
session state — a session-level `SET search_path` would leak across tenants unless the pooler is explicitly
configured to reset it, which is fragile to depend on.

**Correct approach: `SET LOCAL search_path`, inside an explicit transaction wrapping the whole request.**
`SET LOCAL` is transaction-scoped — it auto-resets when the transaction ends, which is safe under transaction-mode
pooling regardless of what the pooler does between transactions. This requires wrapping each request in one explicit
DB transaction (via a NestJS interceptor), not just setting a value before the first query:

```typescript
// Tenant transaction interceptor — wraps every request in one transaction and
// scopes search_path to it via SET LOCAL, which is safe under PgBouncer/Supavisor
// transaction-mode pooling (session-level SET is not — see above).
await dataSource.transaction(async (manager) => {
  await manager.query(`SET LOCAL search_path TO ${schemaName}, public`);
  // ... rest of the request handler runs against `manager` (or a CLS-scoped
  // reference to it), so every query in this request — controller through
  // repository — executes inside this one transaction.
});
```

All TypeORM queries within that transaction — including joins and subqueries — automatically resolve to the correct
schema. No changes to any repository or service.

**Implication worth being explicit about:** every request now runs inside one DB transaction by construction, not
just requests that were already transactional. This is a real (if usually invisible) behavior change from typical
NestJS/TypeORM setups where each query is its own implicit auto-commit transaction — long-running requests now hold
a transaction open for their full duration. Keep request handlers reasonably fast; this is a stronger argument than
usual for not doing slow synchronous work (e.g. calling a slow external API) inside a request that also touches the
DB — push that to a Bull job instead, which already gets its own transaction per §4.6.

**Considered and deliberately rejected: a "Repository Resolver" abstraction layer.** An alternative design wraps every TypeORM repository behind a tenant-aware resolver, so business services request a repository through infrastructure rather than TypeORM resolving the schema implicitly via `search_path`. This was considered and set aside — `search_path` already gives business logic zero awareness of tenancy (the stated goal), so a resolver layer on top would add a real abstraction for a problem that's already solved, contradicting the "no infrastructure overhead beyond what's needed" reasoning behind choosing schema-per-tenant in the first place (§1). Revisit only if a concrete case emerges where `search_path` genuinely can't express what's needed (e.g. a single request legitimately needing two tenants' data at once).

### 4.5 Redis Key Namespacing

Prefix all cache keys with the tenant's **id**, not its schema name, so tenant A's cache never collides with tenant B's:

```
tenant:{tenantId}:...
```

`tenantId` rather than `schemaName` is the deliberate choice — schema name is stable today, but §12's Stage 3 ("tenant relocation") means a tenant could in principle move to a different schema/cluster later, while `tenantId` never changes. Keying cache on the identifier that's guaranteed permanent avoids a future cache-invalidation headache.

Modify `CacheService.key()`:

```typescript
key(suffix: string): string {
  const tenantId = this.cls.get('tenantId') ?? 'global';
  return `tenant:${tenantId}:${suffix}`;
}
```

No other changes needed — all existing `cacheService.get/set/del` calls go through `key()` already.

### 4.6 Bull Queues — Tenant Propagation

Add `tenantId`, `schemaName`, and `correlationId` to every job payload when a job is created:

```typescript
await this.queue.add('job-name', {
  ...existingPayload,
  tenantId: this.cls.get('tenantId'),
  schemaName: this.cls.get('schemaName'),
  correlationId: this.cls.get('correlationId') ?? randomUUID(),
});
```

`correlationId` is carried through purely for observability — it lets a log line in a Bull processor be traced back to the originating request even though the job runs on a separate worker process, minutes or hours later. Generate it once per request (e.g. in the same middleware that sets `tenantId`) and thread it through every job spawned from that request.

In every Bull processor, restore CLS context at the top of the `process()` method before any DB or cache call:

```typescript
async process(job: Job) {
  this.cls.set('tenantId', job.data.tenantId);
  this.cls.set('schemaName', job.data.schemaName);
  this.cls.set('correlationId', job.data.correlationId);
  await dataSource.query(`SET search_path TO ${job.data.schemaName}, public`);
  // ... existing processor logic unchanged
}
```

### 4.7 New Endpoint: GET /tenant/info

A public (unauthenticated) endpoint the frontend calls on mount to get branding for the current subdomain.

```typescript
// Returns for the resolved tenant:
{
  name: string;
  logoUrl: string | null;
  currency: string;
  timezone: string;
}
```

This endpoint bypasses the auth guard but still goes through tenant middleware.

### 4.8 Tenant Provisioning — Self-Serve Signup, Not a Manually-Run Script

**This section's premise changed from the original plan.** A freemium, self-serve product means signup itself has
to create the tenant — a platform operator manually running a CLI script per new church doesn't scale past a
handful of customers and contradicts the "no sales team needed" positioning (product paper §5). Provisioning is a
**shared service**, called from two places: a public signup endpoint (the normal path) and a CLI script (for
platform-admin/support use — re-provisioning, migrating the existing client per §8, etc).

**`TenantProvisioningService`** does the same four steps as originally planned, unchanged:

1. Creates a new PostgreSQL schema: `CREATE SCHEMA church_beta`
2. Runs migrations against that schema — **not** `src/migrations/1790553600000-Baseline.ts` directly. Baseline was
   generated via `pg_dump --schema-only`, which hardcodes every object as `public.foo`; it can only ever target
   `public` regardless of connection config, confirmed empirically (fails immediately with "relation already
   exists" against a fresh schema). `src/migrations/tenant/1790726400000-TenantSchemaGenesis.ts` is a schema-agnostic
   twin — same SQL, `public.` stripped — living outside `src/migrations/` specifically so the main app's own
   migration runner (glob: `src/migrations/*`, non-recursive) never picks it up. It's still **one migration file**,
   which is what makes provisioning fast enough to run synchronously inside a signup HTTP request instead of
   needing an async job with a "setting up your account…" waiting screen. Applying it requires the target schema
   set via the `-c search_path=...` Postgres connection startup parameter, not the TypeORM `schema` DataSource
   option — that option only affects TypeORM's own generated SQL, not a migration's raw queries (also confirmed
   empirically). See `TenantProvisioningService.runTenantMigrations()`.

   **Maintenance cost, accepted:** any future migration touching tenant-owned business tables needs a counterpart
   added to `src/migrations/tenant/` too, until §8's existing-client migration retires `src/migrations/`'s
   business-schema role entirely and TenantSchemaGenesis's lineage becomes the only copy that matters.
3. Seeds the SuperAdmin role and the actual admin account from the signup form (not a placeholder) — via the
   transactional `EntityManager` directly (`txHost.tx`), not `@InjectRepository()`-injected repositories or
   `AdminRoleService`. Those do not pick up a manually-entered CLS transaction the way they do inside a real HTTP
   request handled by `TenantTransactionInterceptor` — confirmed empirically they kept resolving against `public`
   regardless of `SET LOCAL search_path`, seeding the live deployment's actual `admins` table instead of the new
   tenant schema.
4. Inserts/activates the `public.tenants` row, with `plan_id = 'free'` (§4.11)

**`POST /signup` (public, unauthenticated, rate-limited by IP)** — the primary entry point:

```typescript
// { churchName, subdomain, adminEmail, adminPassword }
// 1. Validate subdomain: format, not a reserved word (www/api/admin/platform/app), uniqueness
//    (rely on the unique constraint + catch the conflict — check-then-insert races under concurrent signups)
// 2. tenantProvisioningService.provision({ subdomain, churchName, adminEmail, adminPassword, planId: 'free' })
// 3. Return an access token — the church is immediately logged in on its new subdomain
```

**Provision immediately, gate cost behind verification.** Weighed provisioning-on-verified-email-only (safer, worse
onboarding) against provisioning-immediately-then-verifying (better onboarding, but a throwaway email can spin up a
schema). Immediate provisioning wins — creating a schema is cheap (one migration) and the good first-run experience
matters for a self-serve funnel — but nothing that costs real money runs before verification: SMS sending (§4.11)
and any paid-plan upgrade both require a verified email on the account.

**`provision:tenant` CLI** becomes a thin wrapper calling the same `TenantProvisioningService`, kept for
platform-admin-triggered provisioning (support cases, the existing-client migration in §8) — not a second
implementation to keep in sync with the signup endpoint:

```bash
npm run provision:tenant -- --subdomain=church-beta --name="Beta Church" --admin-email=admin@betachurch.org --plan=free
```

**Provisioning must be idempotent regardless of caller.** Insert the `public.tenants` row first with status `PROVISIONING` (not `is_active = true`), then run steps 1–3, then flip to active only on full success. Re-running provisioning for a tenant already mid-provisioning must detect existing state at each step (schema already created, migrations already applied) and skip forward rather than erroring or double-creating — a crash partway through (e.g. schema created but migrations not yet run) is a real failure mode, not an edge case, and must be safely resumable by just calling the service again with the same subdomain.

### 4.9 Migration Runner — All Tenants

A script to run pending migrations against every active tenant schema:

```bash
npm run migration:run:all-tenants
```

This iterates `public.tenants`, sets `search_path` to each schema, and applies pending migrations. Run this during every production deployment.

**Execution model:**

- **Concurrency:** schemas are lock-independent — safe to migrate concurrently across tenants. Migrations *within* one tenant's schema must stay sequential (TypeORM's own runner already guarantees this per connection). Use a bounded worker pool (~5–10 concurrent tenants, capped well under Postgres `max_connections`) rather than full-sequential (correct but slow at scale) or unbounded parallel (correct but can exhaust connections).
- **Resumability:** track per-tenant migration status in a small log table (e.g. `public.tenant_migration_runs`: `tenant_id`, `migration_name`, `status`, `ran_at`) so a crash mid-run doesn't require restarting from tenant 1.
- **Failure policy:** fail-fast with an alert, not skip-and-continue. A tenant silently left behind on schema version produces a worse bug later (a query referencing a column that doesn't exist for that one tenant) than a stalled deploy does.
- **No off-the-shelf tool exists for this in TypeORM.** Rails' `apartment` gem does schema-per-tenant migrations natively for ActiveRecord; there is no TypeORM equivalent. `migration:run:all-tenants` has to remain a custom script — the model above (bounded pool + resumability log + fail-fast) is that script's spec.
- **Honest scaling tradeoff:** schema-per-tenant migration cost scales roughly linearly with tenant count (mitigated, not eliminated, by concurrency) — unlike row-level multi-tenancy, where a single `ALTER TABLE` touches every tenant's rows in one operation. Fine at the likely scale of this product (dozens–low-hundreds of churches); becomes a real deploy-time cost in the thousands-of-tenants range. Not worth designing around now, just worth knowing it's there.

### 4.10 Platform Admin Module

A new NestJS module at `src/platform-admin/`. Its guards check for a `platform_admin` JWT claim. All its services operate directly on `public` schema tables (`tenants`, `platform_admins`, `plans`, `subscriptions`, `communication_providers`, `tenant_communication_provider_configs`, `sms_wallets`) — they never touch tenant schemas.

Capabilities:
- `GET /platform/tenants` — list all tenants with health stats
- `POST /platform/tenants` — provision a new tenant (calls `TenantProvisioningService` directly, §4.8)
- `PATCH /platform/tenants/:id` — update tenant config (name, logo, currency, timezone)
- `PATCH /platform/tenants/:id/suspend` — suspend a tenant
- `PATCH /platform/tenants/:id/plan` — manually change a tenant's plan (comps, manual overrides, support fixes —
  the self-serve path is the payment provider checkout flow in §4.11, this is the escape hatch)
- `GET /platform/subscriptions` — list all subscriptions with status, useful for spotting `past_due` churn risk
- `GET /platform/plans` / `POST /platform/plans` / `PATCH /platform/plans/:id` — manage plan tiers directly
  (§4.11's "data, not code" point — this is the UI for that)
- `GET /platform/communication-providers` / `POST /platform/communication-providers` — list/register available
  SMS and email providers platform-wide (§4.12)
- `GET /platform/tenants/:id/communication-providers` — view a tenant's active provider per channel and SMS wallet
  balance, for support cases
- `POST /platform/auth/login` — platform admin login (separate JWT, separate secret)
- `POST /platform/tenants/:id/impersonate` — issue a scoped token to support a tenant

### 4.11 Billing & Plan Tiers

> **Payment provider decision changed after review.** Not using Stripe, at least for launch — this codebase already
> has a real precedent for the alternative: the finance module's virtual-account feature bills through Paystack and
> Flutterwave today (`VirtualAccountProvider` enum, `member-virtual-account.entity.ts`). Subscription billing follows
> the same instinct: an abstraction with a swappable concrete implementation, not a Stripe-specific integration.

Both tables live in `public`, alongside `tenants` and `platform_admins` — control-plane, never a `search_path`
target, same category as the tenant registry itself.

```sql
CREATE TABLE public.plans (
  id                         VARCHAR PRIMARY KEY,      -- 'free', 'pro'
  name                       VARCHAR NOT NULL,
  price_cents                INT NOT NULL DEFAULT 0,   -- monthly price in the smallest unit of `currency`, 0 for free
  currency                   VARCHAR NOT NULL DEFAULT 'NGN', -- what price_cents is denominated in — Paystack-first, see product paper §5
  billing_provider_price_id  VARCHAR,                  -- provider's own price/plan identifier; null for free
  features                   TEXT[] NOT NULL DEFAULT '{}', -- PlanFeature keys this plan unlocks
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.subscriptions (
  id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                         UUID NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id                           VARCHAR NOT NULL REFERENCES public.plans(id),
  status                            VARCHAR NOT NULL DEFAULT 'active', -- active | past_due | canceled | trialing
  payment_provider                  VARCHAR,           -- 'paystack', 'flutterwave', ... — which provider this tenant is billed through
  billing_provider_customer_id      VARCHAR,           -- that provider's customer identifier
  billing_provider_subscription_id  VARCHAR,           -- that provider's subscription identifier
  current_period_end                TIMESTAMPTZ,
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

`subscriptions.tenant_id` is unique — upgrade/downgrade is a `plan_id` change on the existing row, never a new one.
A free-tier tenant still gets a `subscriptions` row (`plan_id = 'free'`, `payment_provider = null`) so "which plan is
this tenant on" is always one query with no null-tenant special case. `billing_provider_*` fields were already
provider-agnostic names, not renamed — only `payment_provider` is new, recording *which* provider issued them.

**Both price and tier count are data, not code.** `plans.id` is a free-form string and `plans.features` is an array
— nothing here assumes exactly two tiers. Adding a third or fourth tier (see product paper §4/§5 for the business
case) is a row insert, not a deploy. The one real constraint, true of essentially every payment processor's plan
model (not a Stripe-specific quirk): a provider-side price/plan object is typically immutable once created, so
"change a plan's price" means creating a new provider-side price and deciding whether existing subscribers move to
it or stay grandfathered on their original price — a business decision, not an engineering one, but worth deciding
deliberately rather than by accident (see product paper §9).

**`IPaymentProvider` interface — mirrors the `ISmsProvider`/`IEmailProvider` pattern already established in this
codebase** (`src/sms/interface/sms-provider.interface.ts`, `src/utility/email-provider/email-provider.interface.ts`):
a provider-agnostic contract, one concrete class per vendor, swapping vendors means writing a new class and
changing a DI binding — no call site changes.

```typescript
export interface PaymentCustomer {
  providerCustomerId: string;
}

export interface CheckoutSession {
  checkoutUrl: string;
  providerSessionId: string;
}

export interface NormalizedPaymentEvent {
  type: 'subscription.activated' | 'subscription.renewed' | 'subscription.canceled' | 'payment.failed';
  tenantId: string;
  providerSubscriptionId?: string;
  providerCustomerId?: string;
  raw: unknown; // the untouched provider payload, kept for debugging/audit
}

export interface IPaymentProvider {
  readonly providerName: string;
  createCustomer(tenant: { id: string; name: string; email: string }): Promise<PaymentCustomer>;
  createSubscriptionCheckout(params: {
    tenantId: string;
    planId: string;
    providerCustomerId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession>;
  createOneOffCheckout(params: {
    tenantId: string;
    providerCustomerId: string;
    amountCents: number;
    description: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession>; // used by the SMS wallet top-up flow, §4.12
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
  verifyAndParseWebhook(rawBody: Buffer, signatureHeader: string): NormalizedPaymentEvent;
}

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';
```

Every provider's webhook payload shape is different — `verifyAndParseWebhook` is where that gets normalized into
one common `NormalizedPaymentEvent` shape, so the webhook controller and everything downstream of it (updating
`subscriptions.status`, crediting a wallet) never branches on which provider is active. **First concrete
implementation: `PaystackPaymentProvider`** — Paystack already has a working relationship with this codebase (the
virtual-account feature) and standard Nigerian-market support Stripe currently lacks. A second implementation
(Flutterwave, or Stripe later if the product expands beyond its initial market) is a new class implementing the
same interface plus a DI binding change — the same one-line swap `SmsModule` already does for `SMS_PROVIDER`.

**Feature gating follows the exact pattern `AdminPermission`/`@RequiresPermission` already uses in this codebase** —
same shape, different axis (plan tier, not admin role):

```typescript
export enum PlanFeature {
  FINANCE = 'finance',
  SMS = 'sms',
  FACILITY_RENTAL = 'facility_rental',
  GAMES = 'games',
  VOLUNTEER = 'volunteer',
  ASSET_MANAGEMENT = 'asset_management',
  INCIDENT_REPORT = 'incident_report',
  AUDIT = 'audit',
  SERVICE_PROGRAMME = 'service_programme',
  SERVICE_RATING = 'service_rating',
  SERMON = 'sermon',
  BULK_EXPORT = 'bulk_export',
}
```

`PlanGuard` resolves the active tenant's plan (CLS `tenantId` → `subscriptions` → `plans.features`, cached in Redis
under the same `tenant:{tenantId}:...` namespace as §4.5) and checks the requested `PlanFeature` is included; a
`@RequiresPlan(PlanFeature.FINANCE)` decorator on a controller works exactly like `@RequiresPermission` does today.
On failure it returns `403` with a distinct error code (`PLAN_UPGRADE_REQUIRED`) the frontend recognizes and turns
into an upgrade prompt rather than a generic error toast.

**Payment provider touchpoints:**
- Signup (§4.8) creates the tenant on the `free` plan — no provider customer yet, nothing to charge.
- Upgrade flow calls `createCustomer` (first time) then `createSubscriptionCheckout`; on success, the provider's
  webhook (normalized via `verifyAndParseWebhook`) updates `subscriptions.status`/`plan_id`/`current_period_end`.
- The webhook handler reacts to `NormalizedPaymentEvent.type`, not provider-specific event names — `payment.failed`
  maps to `status = 'past_due'`, which does **not** immediately revoke access — see grace period note in the
  product paper §5.

### 4.12 Communication Providers: SMS & Email — Multi-Provider, Tenant-Configurable

Two related but separate asks, both resolved the same way: (1) more than one SMS provider over time, not just
Termii, and (2) tenants configuring their **own** provider credentials — for both SMS and email — from their admin
portal, not just SMS BYOK as originally scoped. Churches have a strong, legitimate preference for their own name as
the sender on both channels, not a shared platform identity.

**This builds on two interfaces that already exist**, not new ones: `ISmsProvider`
(`src/sms/interface/sms-provider.interface.ts`, currently one implementation, `TermiiSmsProvider`) and
`IEmailProvider` (`src/utility/email-provider/email-provider.interface.ts`, currently two, `GmailProvider` and
`ResendProvider`). Both are already provider-agnostic by design — the comment in `SmsModule` says exactly this:
*"Swapping vendors... means writing a new class... no other call site changes."* Multi-provider isn't a new pattern
here, it's already proven with two real implementations on the email side.

**The one real interface change needed:** today, both `ResendProvider` and `TermiiSmsProvider` read their API key
from `ConfigService` **in their constructor** — one fixed credential for the whole platform, decided at boot. That
assumption breaks the moment two different tenants can use the same provider (say, both on Termii) with two
different accounts. Credentials need to move from constructor-injected to **passed into each call**:

```typescript
// Before (current): constructor(private readonly config: ConfigService) { this.client = new Resend(config.get('RESEND_API_KEY')) }
// After: the client is built per-call from whichever credentials the caller resolved for this tenant/send.
sendMail(credentials: EmailProviderCredentials, options: SendMailOptions): Promise<void>;
send(credentials: SmsProviderCredentials, to: string[], message: string, encoding: SmsEncoding): Promise<SmsSendResult>;
```

`SmsProviderCredentials`/`EmailProviderCredentials` are provider-shaped (Termii needs an API key + sender ID; a
future SMTP-based email provider needs host/port/user/pass) — hence storing them as JSONB below rather than fixed
columns.

```sql
-- Which providers exist on the platform at all, per channel. Adding "twilio" or "africas-talking" later is a row
-- insert here, same "data, not code" principle as §4.11's plans.
CREATE TABLE public.communication_providers (
  id        VARCHAR PRIMARY KEY,     -- 'termii', 'twilio', 'gmail', 'resend', ...
  channel   VARCHAR NOT NULL,         -- 'sms' | 'email'
  name      VARCHAR NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE  -- platform can disable a provider platform-wide without deleting config history
);

-- A tenant's own credentials for a given provider, if they've set one up. Not every tenant has a row here — no
-- row means "use the platform default" (§ below).
CREATE TABLE public.tenant_communication_provider_configs (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider_id            VARCHAR NOT NULL REFERENCES public.communication_providers(id),
  credentials_encrypted  JSONB NOT NULL,   -- shape varies per provider — see encryption note below
  sender_identity         VARCHAR,          -- sender ID (SMS) or from-address/name (email)
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, provider_id)
);

-- SMS-specific: the platform-managed prepaid path, for tenants who haven't set up their own provider.
-- No email equivalent — see "Why email doesn't need a wallet" below.
CREATE TABLE public.sms_wallets (
  tenant_id       UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  balance_credits INT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.sms_wallet_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type            VARCHAR NOT NULL,        -- 'TOP_UP' | 'DEBIT' | 'REFUND'
  credits         INT NOT NULL,            -- positive for TOP_UP/REFUND, negative for DEBIT
  balance_after   INT NOT NULL,
  billing_provider_payment_id VARCHAR,     -- the payment provider's one-off payment id (§4.11), for TOP_UP rows
  reference       VARCHAR,                 -- the tenant-schema sms_logs.id this DEBIT corresponds to
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

All four live in `public` — control-plane, billing/credential-adjacent, same category as `subscriptions`. The
actual message/email log (recipients, content, delivery status) stays where it already lives today: inside the
tenant's own schema, via the existing `sms` module and email-log infrastructure. Same control-plane/data-plane
split as §11's `tenant_rollups`: money and credentials are platform concerns, send history is church-operational
data.

**Send path resolution (SMS and email follow the same shape):**
1. Look up `tenant_communication_provider_configs` for this tenant + channel. If an active row exists, that's a
   **BYOK send** — decrypt the credentials, resolve the concrete provider class from the registry by `provider_id`,
   call `.send(credentials, ...)`. No wallet involved, no cost to the platform, sender identity is the church's own.
2. If no row exists, fall back to the **platform default**: for SMS, debit `sms_wallets` and send through the
   platform's own Termii account; for email, just send through the platform's own default provider (Gmail/Resend)
   — see below for why email has no debit step at all.
3. This resolution is offered as a first-class choice the first time a tenant sets up SMS or email (naturally
   gated behind `PlanFeature.SMS` for SMS; email is available regardless of tier), not a fallback or
   later/enterprise-only option.

**Provider registry, not a single DI binding.** `SmsModule`'s current `{ provide: SMS_PROVIDER, useClass:
TermiiSmsProvider }` assumes exactly one active provider for the whole app. That becomes a registry keyed by
`provider_id` (`Map<string, ISmsProvider>` / `Map<string, IEmailProvider>`, or an injection-token-per-provider-id
pattern) holding every registered implementation simultaneously — the send-path resolution above picks which one
by looking up the tenant's config, not by which one NestJS happened to bind at boot.

**Why email doesn't need a wallet and SMS does:** SMS has a real, meaningful per-message cost from Termii regardless
of volume. Email at the volumes a single church sends is a rounding error on most providers' free tiers (Resend:
3,000/mo free; Gmail: effectively free at this scale) — metering it would be solving a cost problem that doesn't
exist yet. If email volume or provider costs ever become material, revisit; building the wallet for it now would be
premature.

**Debit by segment, not by message (SMS only).** A message over ~160 characters is multiple SMS segments, each
billed by Termii separately — debiting a flat 1 credit per send regardless of length silently loses money on
longer messages.

**The debit must be atomic.** A bulk announcement to a whole congregation can trigger many near-simultaneous sends
against the same balance — a read-then-write balance check has a real race condition here. Use a guarded atomic
update or row lock, the same discipline the Finance module's account-balance logic already applies to money moving
between accounts; this is the same class of problem, not a new one.

**`credentials_encrypted` holds a real secret, not just another config column.** It needs actual encryption at rest
(KMS-backed or app-level AES with a key from a secrets manager) — never plaintext, even inside JSONB. Storing a
tenant's third-party API key on their behalf means the settings UI that collects it should say plainly how it's
protected; churches handing over a credential are trusting the platform with it. This applies identically to SMS
and email credentials — no exception for "it's just an email provider key."

**Top-up flow (SMS platform-wallet path only):** tenant buys a credit bundle via `IPaymentProvider.createOneOffCheckout`
(§4.11) — a one-time charge, not a subscription, since credits don't recur on their own — → webhook (normalized via
`verifyAndParseWebhook`) on payment success → `TOP_UP` transaction row → balance increment. Same webhook handler as
the subscription flow, a different `NormalizedPaymentEvent.type`.

**Admin portal surface (`Faithapp-admin`):** a new settings section — "Communication Providers" or similar — where a
tenant admin sees the available providers per channel (from `public.communication_providers`, filtered to
`is_active`), can add/update their own credentials for any of them, and picks which one (if any) is active. Absence
of any active row is a valid, supported state — it just means "use the platform default," not an error state the
UI needs to nag about.

---

## 5. Frontend Migration (`Faithapp-admin`)

### 5.1 Dynamic Tenant Branding

Currently branding is read from build-time env vars (`NEXT_PUBLIC_CHURCH_NAME`, etc.). In the SaaS version these become runtime data fetched from `GET /tenant/info`.

Add a `TenantContext` that fetches on app mount and exposes:
```typescript
interface TenantConfig {
  name: string;
  logoUrl: string | null;
  currency: string;
  timezone: string;
}
```

Every component that currently reads `process.env.NEXT_PUBLIC_CHURCH_NAME` reads from this context instead.

### 5.2 Cookie Scoping

Auth cookies must be scoped to the subdomain so a session on `church-alpha.yourdomain.com` cannot be read by `church-beta.yourdomain.com`.

The backend sets the cookie `Domain` attribute to the specific subdomain (not the root domain) at login time.

### 5.3 What Does Not Change

- All page components, hooks, and API calls — unchanged
- All permission guards and role checks — unchanged
- All forms, tables, and panels — unchanged

---

## 6. PWA Migration

No changes needed beyond what the admin portal requires. The PWA runs in a browser, the subdomain is present on every fetch, and the Web App Manifest `start_url` already contains the correct subdomain at install time.

If a member navigates to `app.church-alpha.yourdomain.com`, they are automatically in church Alpha's tenant. No church code, no custom header, no additional configuration.

---

## 7. Platform SuperAdmin Dashboard (`discovery-hub-platform`)

A separate Next.js application deployed at `platform.yourdomain.com`. Completely isolated from `Faithapp-admin`. Platform admins authenticate against `public.platform_admins`, not against any tenant schema.

### Features

| Section | Capability |
|---|---|
| Tenants | List, search, view health stats (last login, member count, event count) |
| Provisioning | Wizard to create a new tenant (calls the same `TenantProvisioningService` as self-serve signup, §4.8) |
| Tenant detail | Edit name, logo, currency, timezone; suspend/reactivate |
| Billing | View plan, subscription status, `past_due` flags; manual plan override (comps, support fixes) |
| Plans | Create/edit plan tiers and their `features` array (§4.11) — no deploy needed to add a tier or change what a tier unlocks |
| Communication Providers | Register available SMS/email providers platform-wide (§4.12); per-tenant, view which provider each channel is on (BYOK vs. platform default), SMS wallet balances, investigate low-balance or send-failure support cases |
| Impersonation | Issue a scoped support token to log into a church's admin portal |
| Migrations | View migration status per tenant; trigger migration runs |
| Platform admins | Manage platform operator accounts |
| Metrics | Cross-tenant aggregate stats (total churches, total members, per-tier split, MRR) |

### Auth

Separate JWT secret from tenant JWTs. Platform admin tokens carry `{ role: "platform_admin" }` and are validated by a dedicated `PlatformAdminGuard` that is never used on tenant routes.

---

## 8. Existing Client Migration

The current single-tenant deployment's data becomes tenant 1 in the SaaS system.

1. Create schema `church_original` in the SaaS database
2. Dump the existing single-tenant database and restore into `church_original` schema
3. Insert a row into `public.tenants` for this church
4. Point the church's subdomain at the SaaS deployment
5. Verify all data is intact and auth works
6. Decommission the old single-tenant deployment

---

## 9. Build Order

These phases are sequential. Each phase is a prerequisite for the next.

### Phase 1 — Tenant Infrastructure (Backend)
- Add `public.tenants` and `public.platform_admins` tables
- Install and configure `nestjs-cls`
- Build tenant middleware (subdomain → schema resolution)
- Implement `SET LOCAL search_path` inside a per-request transaction wrapper (§4.4 — not session-level `SET`, required
  because `DATABASE_POOL` already defaults to `transaction` mode)
- Add `GET /tenant/info` endpoint
- Write integration tests for schema isolation

### Phase 2 — Cache & Queue Namespacing (Backend)
- Add tenant prefix to all Redis cache keys via `CacheService.key()`
- Add `tenantId`/`schemaName` to all Bull job payloads
- Restore CLS context in all Bull processors

### Phase 3 — Billing & Plan Infrastructure (Backend)

> **`PaystackPaymentProvider` is deliberately deferred — `IPaymentProvider` stays interface-only for now.** Nothing
> below actually needs a working payment integration: `PlanGuard` reads `subscriptions.plan_id`, full stop, and a
> tenant can be moved onto Pro manually via the platform-admin escape hatch (`PATCH /platform/tenants/:id/plan`,
> already scaffolded) for testing and for real comped upgrades alike. The only things that stay blocked are the
> self-serve "pay to upgrade" checkout flow and SMS platform-wallet top-ups specifically — BYOK communication
> providers (below) don't touch money at all and are unaffected. Build the concrete Paystack class whenever a real
> business account is ready; nothing else in this phase, or in Phases 4–7, waits on it.

- Add `public.plans` (with a `currency` column — the drafted "$39/mo" in the product paper doesn't specify one yet)
  and `public.subscriptions` tables (§4.11)
- Define the `IPaymentProvider` interface (§4.11) — same swappable-vendor pattern `ISmsProvider`/`IEmailProvider`
  already use in this codebase. No concrete implementation yet; see note above.
- Build `PlanGuard` + `@RequiresPlan(PlanFeature.X)` decorator (§4.11) — fully buildable and testable today
- Apply plan gates to the modules the product paper marks Pro-only (Finance, SMS, Facility Rental, Games,
  Volunteer, Asset Management, Incident Report, Audit, Service Programme, Service Rating, Sermon, bulk export)
- Frontend: upgrade-prompt modal triggered on a `403` with the plan-gate error code
- Add `public.communication_providers`, `public.tenant_communication_provider_configs`, `public.sms_wallets`,
  `public.sms_wallet_transactions` (§4.12)
- Evolve `ISmsProvider`/`IEmailProvider` to accept credentials per-call instead of constructor-injected (§4.12);
  build the provider registry and the BYOK send path for both channels — none of this needs `IPaymentProvider` either
- SMS platform-wallet debit path (atomic, by-segment) can be built now; wallet **top-up** specifically waits on a
  real `IPaymentProvider` implementation, since it needs `createOneOffCheckout`
- Frontend: "Communication Providers" settings section (add/update credentials per provider, per channel)

### Phase 4 — Self-Serve Provisioning & Migration Tooling (Backend)
- Build the shared provisioning service (schema create → migrate → seed → activate, §4.8)
- Build public `POST /signup` endpoint calling the provisioning service synchronously, assigning plan = `free`
- Build `provision:tenant` CLI script as a thin wrapper over the same service, for platform-admin/support use
- Build `migration:run:all-tenants` script
- Test self-serve signup and CLI provisioning end-to-end

### Phase 5 — Platform Admin Module (Backend)
- `src/platform-admin/` module with its own auth
- Tenant CRUD, suspend, impersonation endpoints
- Platform admin JWT with separate secret

### Phase 6 — Admin Frontend (`Faithapp-admin`)
- Build `TenantContext` with `GET /tenant/info` fetch on mount
- Replace all build-time env var branding reads with context reads
- Scope auth cookies to subdomain
- Public signup page calling `POST /signup`

### Phase 7 — Platform Dashboard (`discovery-hub-platform`)
- New Next.js app
- Tenant list, provisioning wizard, health stats
- Platform admin auth flow
- Impersonation flow

**Shipped.** All four items wired to the real Phase 5 backend — tenant list with live health stats (plan, member
count), a provisioning wizard, rename/suspend/reactivate/plan-change actions, and an impersonation flow that issues
and displays the token (using it against a live tenant request still needs Phase 8's bridging decision, same
caveat as §4.10). Not visually verified in a browser (no browser tooling available when this was built) — typecheck,
lint, production build, and a live boot against the real backend (every route 200) all passed instead.

### Phase 8 — Existing Client Migration
- Migrate existing church's data into tenant schema
- Validate and cut over
- Decommission old deployment

### Phase 9 — Multi-Branch Hierarchy (Future, Post-Cutover)
- Add `parent_tenant_id` to `public.tenants`
- Add `public.tenant_rollups` control-plane table
- Build per-tenant rollup cron job (Bull)
- Build parent-side hierarchy/overview UI in the platform dashboard or admin portal
- See §11 for the full design

---

## 10. What Does Not Change

To be explicit: the following require **zero modification** when this migration is executed:

- All TypeORM entities
- All NestJS services and business logic
- All controllers and route definitions
- All guards (JwtAuthGuard, AdminGuard, RolesGuard)
- All DTOs and validators
- All Bull job definitions (only payloads gain two new fields)
- The `DefaultAdminSeed` (runs per tenant at provisioning time, unchanged)
- All existing migrations (applied per schema at provisioning time)

The multi-tenancy layer is purely infrastructure. It runs before the existing request pipeline and is invisible to it.

---

## 11. Multi-Branch Hierarchy & Cross-Tenant Reporting (Future, Post-Cutover)

> **Status:** Scoped only, not started. Depends on Phases 1–7 above — a branch is a tenant, so this cannot exist before tenancy does.

Many churches plant or oversee branch churches, each with its own workers, finances, and membership, while the parent church wants an oversight view of what's happening across its branches.

### 11.1 Onboarding

A branch is onboarded the same way any tenant is (§4.8), plus a hierarchy link:

1. The parent church's admin sends a branch invite (email) from a hierarchy-management view.
2. The invited church goes through normal tenant provisioning (its own schema, its own admin).
3. On acceptance, the new tenant's `public.tenants` row is stamped with the parent's tenant id.
4. Only after acceptance does any data begin syncing upstream — an unaccepted invite has no data visibility either direction.

```sql
ALTER TABLE public.tenants
  ADD COLUMN parent_tenant_id UUID NULL REFERENCES public.tenants(id) ON DELETE SET NULL;
```

Self-referencing and nullable so a flat parent → branch model costs nothing to represent today even though only one level is used initially. A multi-level hierarchy (branch-of-a-branch) is possible later with zero schema change.

### 11.2 Why Not Direct Cross-Schema Reads

The naive design — a scheduled job that does `SET search_path TO church_branch_x` and reads the branch's tables directly to build the parent's overview — was considered and rejected. It silently assumes every tenant lives in the same PostgreSQL instance. The moment tenants are sharded across multiple database instances (a real possibility at scale — see §2), a connection to shard 1 has zero physical visibility into shard 2. Direct cross-schema SQL reads become simply impossible, not just slow. Any design for this feature has to be shard-safe from the start rather than retrofitted later.

### 11.3 Agreed Design: Local Compute, Pushed Rollups

Each tenant computes its own rollup **locally**, using whichever shard it lives on (which it always has a connection to, regardless of how tenants are distributed), then reports the result outward — it is never queried directly by the parent.

```sql
CREATE TABLE public.tenant_rollups (
  tenant_id         UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  member_count      INT NOT NULL DEFAULT 0,
  attendance_rate   NUMERIC(5,2),
  total_giving      NUMERIC(14,2),
  computed_at       TIMESTAMPTZ NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

`tenant_rollups` lives in `public` alongside `tenants` and `platform_admins` — deliberately **unsharded control plane**, never a target of `SET search_path`. This is the same category as the existing tenant registry, distinct from the sharded **data plane** (actual tenant operational data in each tenant's own schema/shard).

- A scheduled Bull cron job runs inside each tenant's own request/job context (already has `tenantId`/`schemaName` in CLS per §4.6), computes its own aggregates against its own shard, and **upserts its own row only** — `tenant_id = self`.
- The parent's dashboard reads only from `public.tenant_rollups WHERE tenant_id IN (SELECT id FROM public.tenants WHERE parent_tenant_id = :parentId)`. It never reaches into a branch's schema or shard directly — there is no cross-tenant read path to get wrong, because there is no cross-tenant read at all.
- A webhook-push variant (branch tenant `POST`s its rollup to a platform endpoint instead of writing to a shared table) is an equally valid alternative if push semantics are preferred over a shared table — functionally equivalent, pick whichever fits the deployment topology better when this is built.

### 11.4 Known Tradeoffs

- **Eventually consistent, not live.** The parent's view is only as fresh as the last scheduled push. Acceptable — likely desirable — for a leadership rollup dashboard (member counts, attendance %, giving totals); would need rethinking if real-time expectations come up later.
- **Aggregates only, not raw records.** Recommended: sync computed rollups (counts, rates, totals), never raw per-member rows. Simpler, and a branch's individual congregant data probably shouldn't be visible to a parent church's admins by default.
- **Flat vs. multi-level hierarchy.** `parent_tenant_id` supports both; only flat parent→branch is planned for the first build.

---

## 12. Scaling Roadmap (Multi-Cluster Future)

> **Status:** Reference only — names the trigger points for when multi-cluster work becomes necessary. Nothing here is built until a stage's numbers are actually approached.

Every tenant carries a `cluster_id` from day one (§4.1, defaulted to `'default'`), even though only one cluster exists at Stage 1. This costs nothing now and avoids a backfill migration later — every tenant row would otherwise need editing the day a second cluster is introduced.

| Stage | Scale | Infrastructure | What changes |
|---|---|---|---|
| **1** | ~100 churches | 1 PostgreSQL cluster | Current target. Everything in §4 as written. |
| **2** | ~5,000 churches | Multiple PostgreSQL clusters | New tenants provisioned onto whichever cluster has headroom; `cluster_id` starts varying. Tenant Resolver (§3/§7) reads `cluster_id` to pick the connection pool before setting `search_path`. |
| **3** | ~20,000 churches | Tenant relocation, read replicas | A tenant's schema can be dumped/restored onto a different cluster and `cluster_id` updated — the reason cache keys are `tenantId`-based (§4.5) and not `schemaName`-based. Read replicas take reporting/rollup queries (§11) off the primary. |
| **4** | 50,000+ churches | Dedicated clusters for outlier tenants | An exceptionally large single tenant can get a dedicated cluster without any business-logic change — same schema-per-tenant model, just one tenant per cluster instead of many. |

**What does not change across any stage:** business services never read `cluster_id` directly — only the Tenant Resolver (§7) and the connection-acquisition step do. This is the same discipline as §4.4's `search_path` rule, extended to cluster selection.

**Explicitly out of scope for this document** (a real gap, but a separate feature area — not a tenancy-migration concern):
- **Custom domain support** (`tenant_domains` — letting a church map `giving.theirchurch.org` to their tenant instead of only `their-church.yourdomain.com`). Subdomain routing (§3) is sufficient for launch; custom domains add DNS verification and TLS provisioning complexity that isn't justified until a customer actually asks for it.

(Billing/subscriptions was previously listed here as out of scope — it no longer is. See §4.11.)

---

## 13. AI Contributor Guidelines

These rules apply specifically to AI coding agents (including Claude Code sessions) working in `discovery-hub` on this migration:

- **Never introduce tenant-aware business logic.** If a service, controller, or entity needs to know about `tenantId`, `schemaName`, or `clusterId` directly, that's a sign the change belongs in the infrastructure layer (middleware/interceptor/CLS), not business logic. Push back on a request that would add this rather than implementing it as asked.
- **Never bypass the CLS-based tenant context** (§4.2) to "simplify" a one-off script or job — every DB-touching code path, including ad-hoc scripts, must go through the same per-request-transaction + `SET LOCAL search_path` mechanism (§4.4) as normal requests.
- **Never hardcode a schema name** anywhere outside `TenantProvisioningService` (§4.8) and the migration runner (§4.9), which are the only two places that legitimately iterate over schemas by name.
- **Plan-tier gating is a guard concern, not a service concern** — same discipline as `AdminPermission`. A `PlanFeature` check belongs on the controller via `@RequiresPlan` (§4.11), never inline in a service method. If a service needs to branch on the tenant's plan, that's a sign the gate is in the wrong layer.
- **Never store a tenant-provided third-party credential in plaintext.** `tenant_communication_provider_configs.credentials_encrypted` (§4.12) and anything like it must go through actual encryption at rest, never a bare column. This is someone else's secret, held on their behalf — treat it with the same seriousness as this codebase already treats its own JWT secrets and payment credentials.
- **Keep implementations at the complexity level the current stage (§12) actually needs.** Don't build Stage 2+ multi-cluster plumbing while the product is at Stage 1 — carry the cheap forward-compat fields (`cluster_id`, `tenantId`-keyed cache) but don't build the routing logic those fields will eventually need until a second cluster is real.
