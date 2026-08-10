# Multi-Tenant Migration Plan

> **Status:** Active — target: freemium SaaS launch. See [`PRODUCT_STRATEGY.md`](./PRODUCT_STRATEGY.md) for the business
> model this plan implements. This document covers only the technical how; the product paper covers the why and what.

---

## 1. Business Model & Repo Strategy

**Decision (2026-08, supersedes the original open-source + private-fork plan):** Discuva ships as a single
freemium SaaS product, one repo, no self-hosted tier. There is no `discuva-cloud` fork and no upstream/downstream
sync discipline to maintain — `discuva-api` itself becomes the SaaS backend, and multi-tenancy is infrastructure
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
| Admin Portal | `discuva-admin` (formerly `Faithapp-admin`) | Church admins/workers (all tiers) |
| Member PWA | `discuva-member` (formerly `Faithapp`) | Church members (all tiers) |
| Platform Dashboard | `discuva-platform` (new) | Platform operators only — never church-facing |

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

## 4. Backend Migration (`discuva-api`)

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

### 4.3 Tenant Middleware — Also Owns the Transaction

**This section's design changed twice after the first live-wiring attempt (§9 Phase 8) — both corrections came from
real HTTP testing, not the isolated e2e test, and are worth understanding before touching this code.**

The first version split responsibilities: `TenantMiddleware` resolved the tenant and wrote `tenantId`/`schemaName`
into the CLS store; a separate `TenantTransactionInterceptor` opened the transaction and ran `SET LOCAL
search_path`. That split silently failed to scope any **Guard**-level DB access (e.g. the local auth strategy's
credential lookup during login), because NestJS runs Guards before Interceptors — the transaction didn't exist yet
when the guard's query ran. The e2e isolation test didn't catch this because it only exercised route-handler-level
DB access. Fixed by merging both responsibilities into `TenantMiddleware` itself, since middleware runs before
guards, interceptors, and the handler alike:

```typescript
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly config: ConfigService,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    @InjectRepository(Tenant) private readonly tenantRepository: Repository<Tenant>,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const subdomain = extractSubdomain(req.hostname, this.config.get('APP_BASE_DOMAIN'));
    const tenant = await this.tenantRepository.findOneBy({ subdomain, isActive: true });
    if (!tenant) throw new NotFoundException('Tenant not found');

    this.cls.set('tenantId', tenant.id);
    this.cls.set('schemaName', tenant.schemaName);

    // Holds the transaction open for the rest of the request (guards,
    // interceptors, handler) by resolving/rejecting only once the response
    // has actually finished — see the real source for the full res.on('finish')
    // wrapping and the >=400 -> rollback logic.
    await this.txHost.withTransaction(async () => {
      await this.txHost.tx.query(`SET LOCAL search_path TO "${tenant.schemaName}", public`);
      await new Promise<void>((resolve, reject) => { /* res.on('finish'/'close') */ next(); });
    });
  }
}
```

Exempt routes (`TenantModule`'s `MiddlewareConsumer.exclude()`) — **must** include the `v1/` URI-versioning prefix,
confirmed empirically that `exclude()`'s string patterns match the raw incoming path, prefix and all:
`v1/platform/(.*)` (control-plane, always `public`), `v1/signup` (no tenant row exists yet by definition),
`v1/integrations/youtube/callback` (Google's WebSub hub calls this directly with no `Host` header identifying a
tenant — same reasoning as `TenantYoutubeIntegration` living in `public`, §9 Phase 8b: the tenant has to be resolved
*from* the payload, which can't happen if `TenantMiddleware` 404s the request before the handler ever sees it — this
one was caught after the fact as a live regression, not designed in up front, exactly the kind of miss this exclude
list has to be exhaustive about), and the unprefixed `@Version(VERSION_NEUTRAL)` routes `/`, `docs`, `health`.

### 4.4 Schema Switching — search_path Per Request, and Why Plain Repositories Don't See It

**This section's approach changed after review — read the pooling note before implementing.** The original design
set `search_path` at the session/connection level. That's unsafe here: `env.validation.ts` already defines
`DATABASE_POOL` with a default of `'transaction'`, meaning this app is designed to run behind an external pooler
(PgBouncer/Supavisor) in transaction-pooling mode. Under transaction pooling, a physical connection is returned to
the pool at the end of each transaction and can be handed to a **different tenant's** next request without resetting
session state — a session-level `SET search_path` would leak across tenants unless the pooler is explicitly
configured to reset it, which is fragile to depend on.

**Correct approach: `SET LOCAL search_path`, inside an explicit transaction wrapping the whole request** (§4.3).
`SET LOCAL` is transaction-scoped — it auto-resets when the transaction ends, which is safe under transaction-mode
pooling regardless of what the pooler does between transactions.

**A second, more consequential correction, also only caught by live testing (§9 Phase 8):** the original plan for
this section assumed that once the whole request ran inside one transaction, ordinary `@InjectRepository(Entity)`
repositories would transparently resolve against that transaction's `search_path` — "no changes to any repository
or service," as this doc originally claimed. **That's false, and it's not a pooling subtlety — it's how
`@nestjs-cls/transactional-adapter-typeorm` actually works.** Reading its source
(`transactional-adapter-typeorm.js`) confirms it does not patch `DataSource#manager` or anything a plain
`@InjectRepository()` resolves to; it only exposes the active transaction's `EntityManager` via
`TransactionHost#tx` for code that explicitly asks for it. And TypeORM's own `Repository` (`Repository.js`)
captures `manager` once, as a plain constructor property — not a live getter — so a repository built from the
standard DI token is permanently bound to the app-wide default manager and can never see a per-request transaction,
regardless of where or how that transaction was opened. This was proven live: `TenantMiddleware` correctly ran `SET
LOCAL search_path` before a login request's credential lookup, but `MemberService`'s standard
`@InjectRepository(Member)` still queried `public` and missed a row verifiably sitting in the tenant's own schema.

**The fix: `TenantTypeOrmModule.forFeature([...])`** (`src/tenant/utility/tenant-typeorm.module.ts`) is a drop-in
replacement for `TypeOrmModule.forFeature([...])` — same `getRepositoryToken(Entity)` DI token, so every
`@InjectRepository(Entity)` call site is untouched. Instead of a repository built once at bootstrap, it registers a
`Proxy` that re-resolves `txHost.tx.getRepository(Entity)` on **every property access**, which is correct for both
tenant-scoped requests (returns the CLS-scoped transactional manager) and tenant-excluded routes (`tx` falls back to
the plain `dataSource.manager` when no transaction is active — the platform-admin control plane relies on exactly
this fallback). **Every feature module that owns tenant-schema tables uses this instead of `TypeOrmModule.forFeature`
now — this is the standard for any new module**, not just the ones fixed in this pass. The only modules that
correctly keep plain `TypeOrmModule.forFeature()` are the ones registering genuinely global, `public`-only tables:
`TenantModule` (`Tenant` itself), `PlatformAdminModule`, and `BillingModule` (`Plan`/`Subscription` — deliberately
excluded from the tenant schema clone, see `src/migrations/tenant/`'s header comment).

**Superseded by the above — kept here as a record of what was tried and rejected, then found necessary anyway:**
this doc originally rejected a "Repository Resolver" abstraction layer as unneeded overhead, reasoning that
`search_path` already gave business logic zero tenancy-awareness so a resolver on top would solve an
already-solved problem. The premise was wrong — `search_path` alone does *not* reach standard repositories, as
above — so a repository-resolving layer wasn't optional convenience, it was the missing piece. The upside of the
original reasoning still holds in the implementation: `TenantTypeOrmModule.forFeature()` keeps every business
service's `@InjectRepository(Entity)` call site completely unaware of tenancy, exactly as intended — the resolver
lives entirely in module registration, not in service code.

**Implication worth being explicit about:** every request now runs inside one DB transaction by construction, not
just requests that were already transactional. This is a real (if usually invisible) behavior change from typical
NestJS/TypeORM setups where each query is its own implicit auto-commit transaction — long-running requests now hold
a transaction open for their full duration. Keep request handlers reasonably fast; this is a stronger argument than
usual for not doing slow synchronous work (e.g. calling a slow external API) inside a request that also touches the
DB — push that to a Bull job instead, which already gets its own transaction per §4.6.

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
   `AdminRoleService`. As established in §4.4, standard `@InjectRepository()` repositories never see a CLS
   transaction regardless of how it was opened — confirmed empirically here too, they kept resolving against
   `public` regardless of `SET LOCAL search_path`, seeding the live deployment's actual `admins` table instead of
   the new tenant schema. (`AdminModule` now registers via `TenantTypeOrmModule` like every other feature module,
   but this method still uses `txHost.tx` directly rather than the injected repositories, since it runs inside a
   manually-entered `cls.runWith()` block outside the normal request pipeline, before the tenant is even active.)
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

A new NestJS module at `src/platform-admin/`. Its guards check for a `platform_admin` JWT claim. All its services operate directly on `public` schema tables (`tenants`, `platform_admins`, `plans`, `subscriptions`, `communication_providers`, `tenant_communication_provider_configs`) — they never touch tenant schemas.

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
- `GET /platform/tenants/:id/communication-providers` — view a tenant's active provider per channel, for support
  cases
- `POST /platform/auth/login` — platform admin login (separate JWT, separate secret)
- `POST /platform/tenants/:id/impersonate` — issue a scoped token to support a tenant

### 4.11 Billing & Plan Tiers

> **Payment provider decision changed after review.** Not using Stripe, at least for launch — this codebase already
> has a real precedent for the alternative: the finance module's virtual-account feature was scaffolded to bill
> through Paystack and Flutterwave, though it was later deleted unimplemented (§9 Phase 9h) in favor of a tenant-owned
> checkout flow instead. Subscription billing follows
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
  }): Promise<CheckoutSession>; // general-purpose one-off charge; the SMS wallet top-up flow this originally described (§4.12) was removed in §9 Phase 9g — SMS is pure BYOK now
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
  verifyAndParseWebhook(rawBody: Buffer, signatureHeader: string): NormalizedPaymentEvent;
}

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';
```

Every provider's webhook payload shape is different — `verifyAndParseWebhook` is where that gets normalized into
one common `NormalizedPaymentEvent` shape, so the webhook controller and everything downstream of it (updating
`subscriptions.status`) never branches on which provider is active. **First concrete
implementation: `PaystackPaymentProvider`** — Paystack already had a working relationship with this codebase (the
finance module's virtual-account scaffold, since deleted — §9 Phase 9h) and standard Nigerian-market support Stripe
currently lacks. A second implementation (Flutterwave, or Kora/Stripe later — see §9 Phase 9h) is a new class
implementing the same interface plus a registry entry, the same shape `PaymentProviderRegistryService` already uses.

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

**This section is the original design; both SMS and email BYOK have since shipped (§9 Phase 3) — see there for the
actual final method signatures (`sendMail(options, credentials?)`, credentials last and optional, not
`sendMail(credentials, options)` as first sketched below) and real `SmsWalletTransactionType` values (`debit`/`credit`,
not `TOP_UP`/`DEBIT`/`REFUND`). Kept here unedited as the design rationale, since the reasoning below is still exactly
why it was built this way — with one exception: `sms_wallets`/`sms_wallet_transactions` and everything below
describing them (the platform-default Termii fallback, the debit-by-segment logic, the top-up flow) were removed
entirely in §9 Phase 9g — SMS is pure BYOK now, no platform-default path exists for it. Email's platform-default
fallback (no wallet, per "Why email doesn't need a wallet and SMS does" below) is unaffected and still accurate.**

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

**Admin portal surface (`discuva-admin`):** a new settings section — "Communication Providers" or similar — where a
tenant admin sees the available providers per channel (from `public.communication_providers`, filtered to
`is_active`), can add/update their own credentials for any of them, and picks which one (if any) is active. Absence
of any active row is a valid, supported state — it just means "use the platform default," not an error state the
UI needs to nag about.

---

## 5. Frontend Migration (`discuva-admin`)

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

## 6. PWA Migration (`discuva-member`)

**Corrected after auditing the actual codebase (2026-07) — the original claim below ("no changes needed") undercounted the work.** Tenant *resolution* genuinely needs nothing extra: the PWA runs in a browser, the subdomain is present on every fetch, and if a member navigates to `app.church-alpha.yourdomain.com` they're automatically in church Alpha's tenant — no church code, no custom header. But `discuva-member` has the exact same client-side gap as `discuva-admin` (§5), just never enumerated here: build-time branding env vars and a hardcoded non-tenant API base URL. Confirmed by grep, not assumed:

- `NEXT_PUBLIC_API_URL` — same single `baseURL` usage as `discuva-admin` (`utils/auth/axios-client.ts`), same bare-host value with no tenant subdomain. Needs the same fix (§5.1-equivalent: point at a real tenant subdomain).
- Branding env vars (`NEXT_PUBLIC_CHURCH_NAME`, `NEXT_PUBLIC_CHURCH_TAGLINE`, `NEXT_PUBLIC_CHURCH_ADDRESS`, `NEXT_PUBLIC_LOGO_URL`, `NEXT_PUBLIC_CURRENCY_*`) read directly in 8 files: `app/layout.tsx`, `app/account/page.tsx`, `utils/currency.ts`, `components/layout/onboarding-page.tsx`, `components/layout/login-page.tsx`, `components/layout/loading.tsx`, `components/pwa/install-wall.tsx`, and `app/manifest.ts` (see below). Needs the same `TenantContext` + `GET /tenant/info` treatment as §5.1.
- Cookie scoping: not applicable, same reason as `discuva-admin` — auth token lives in an in-memory `token-store.ts` (identical pattern in both apps), not a cookie the frontend manages.
- **`app/manifest.ts` is a genuinely distinct problem, not just another env-var read.** It's a static Next.js route (`MetadataRoute.Manifest`) fetched directly by the browser via `<link rel="manifest">` before any client JS runs — it can't pull from a React context on mount the way the other 7 files can. Making the installed-PWA name/description tenant-aware requires either reading the `Host` header server-side (`next/headers`) inside `manifest.ts` and disabling static optimization for that route, or accepting a generic (non-branded) manifest and leaving per-tenant branding to the in-app UI only. Needs a decision, not just a mechanical swap.

---

## 7. Platform SuperAdmin Dashboard (`discuva-platform`)

A separate Next.js application deployed at `platform.yourdomain.com`. Completely isolated from `discuva-admin`. Platform admins authenticate against `public.platform_admins`, not against any tenant schema.

### Features

| Section | Capability |
|---|---|
| Tenants | List, search, view health stats (last login, member count, event count) |
| Provisioning | Wizard to create a new tenant (calls the same `TenantProvisioningService` as self-serve signup, §4.8) |
| Tenant detail | Edit name, logo, currency, timezone; suspend/reactivate |
| Billing | View plan, subscription status, `past_due` flags; manual plan override (comps, support fixes) |
| Plans | Create/edit plan tiers and their `features` array (§4.11) — no deploy needed to add a tier or change what a tier unlocks |
| Communication Providers | Register available SMS/email providers platform-wide (§4.12); per-tenant, view which provider each channel is on (BYOK, or platform default for email — SMS has no platform default, pure BYOK), investigate send-failure support cases |
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

**Shipped, re-audited 2026-08 against live code (no gaps found).**
- ✅ `public.tenants` / `public.platform_admins` tables — `src/migrations/1790640000000-AddPlatformControlPlaneTables.ts`
- ✅ `nestjs-cls` installed and configured (`src/app.module.ts`)
- ✅ Tenant middleware (subdomain → schema resolution) — `src/tenant/middleware/tenant.middleware.ts`
- ✅ `SET LOCAL search_path` inside a per-request transaction wrapper (§4.4)
- ✅ `GET /tenant/info` endpoint — `src/tenant/controller/tenant-info.controller.ts`
- ✅ Integration tests for schema isolation — `test/tenant-schema-isolation.e2e-spec.ts`

### Phase 2 — Cache & Queue Namespacing (Backend)

**Shipped, re-audited 2026-08 — one naming correction to this doc, no code gap.**
- ✅ Tenant prefix on all Redis cache keys — **correction:** not via a method literally named `CacheService.key()` (that
  method is just a plain namespace/id/suffix concatenator). The actual tenant-scoping happens in a private
  `scopedKey()` (`src/utility/service/cache.service.ts`) that every public method (`get`/`set`/`del`/`incr`/`has`/lock
  methods) routes through, reading `tenantId` off CLS. Functionally correct, this doc's original wording just named
  the wrong method.
- ✅ `tenantId`/`schemaName`/`correlationId` on all Bull job payloads — every producer spreads
  `buildJobEnvelope(cls)` (`src/tenant/utility/job-envelope.ts`)
- ✅ CLS context restored in all Bull processors via `runInTenantContext()` (`src/tenant/utility/run-in-tenant-context.ts`) —
  confirmed present in all 6 processor files (tithe, reconciliation, push-notification, post-event, audit-log, email)

### Phase 3 — Billing & Plan Infrastructure (Backend)

**Partially shipped — re-audited 2026-08, real gaps found.** The schema/guard/plan-gate core is solid; the BYOK
communication-provider write path and the frontend upgrade UX are not built, contrary to this doc's original
checklist just listing them as flat TODOs with no status. Detail below, ordered by what's actually missing.

> **`PaystackPaymentProvider`/`FlutterwavePaymentProvider` were deferred, now built (2026-08).** Nothing in this phase
> ever *needed* a working payment integration to function: `PlanGuard` reads `subscriptions.plan_id`, full stop, and
> a tenant can still be moved onto Pro manually via the platform-admin escape hatch
> (`PATCH /platform/tenants/:id/plan`) for comped upgrades — that path is unaffected and still the fastest way to
> unblock a specific tenant. What real payment providers unlock is the self-serve "pay to upgrade" checkout flow and
> SMS wallet top-up specifically, both now live. See "Shipped, 2026-08 — Payment providers" below.

**Shipped:**
- ✅ `public.plans` / `public.subscriptions` tables (§4.11) — `src/migrations/1790640000000-AddPlatformControlPlaneTables.ts`
- ✅ `IPaymentProvider` interface, correctly interface-only per the note above — `src/billing/interface/payment-provider.interface.ts`
- ✅ `PlanGuard` + `@RequiresPlan(PlanFeature.X)` decorator (§4.11) — `src/billing/guard/plan.guard.ts`,
  `src/billing/decorator/requires-plan.decorator.ts`
- ✅ `public.communication_providers`, `public.tenant_communication_provider_configs` (with `credentials_encrypted
  JSONB`), `public.sms_wallets`, `public.sms_wallet_transactions` (§4.12) — same migration file as above

**Shipped, closed 2026-08:**
- ✅ Plan gates now applied to all 12 Pro-only areas. `ServiceProgrammeController` and `ServiceSessionController`
  gated at the class level with `@UseGuards(PlanGuard)` + `@RequiresPlan(PlanFeature.SERVICE_PROGRAMME)` — NestJS
  composes class-level and method-level `@UseGuards()` rather than one overriding the other, so this applies on top
  of each route's own `AdminGuard`/`JwtAuthGuard`/`ShareTokenGuard` without touching every method individually.
  `attendance.controller.ts`'s `export-email`, `service-headcount.controller.ts`'s `export-email`, and
  `service-session.controller.ts`'s `action-log/csv` all gated at the method level with
  `@RequiresPlan(PlanFeature.BULK_EXPORT)` — on `action-log/csv` specifically this *overrides* (not adds to) the
  class-level `SERVICE_PROGRAMME` requirement, since `Reflector#getAllAndOverride` checks handler metadata before
  falling back to class metadata; accepted as a narrow, low-severity tradeoff (a tenant would need a valid session
  code they have no legitimate way to obtain without `SERVICE_PROGRAMME` in the first place). Verified live against
  a real tenant on both `free` (403 `PLAN_UPGRADE_REQUIRED`) and `pro` (200) — all four gates.
  Also fixed a stale comment on `PlanGuard` itself claiming tenant context wasn't wired in yet (pre-Phase-8 leftover
  — it's been fully active since Phase 8 landed).

**Shipped, 2026-08 — BYOK write path, full send-path wiring, wallet debit (SMS only):**
- ✅ **Tenant-facing write path** — `src/communication-provider/` (new module): `TenantCommunicationProviderController`
  (`AdminGuard`, new `COMMUNICATION_PROVIDERS_READ`/`WRITE` permissions — existing tenants' `SuperAdmin` roles
  backfilled via a new tenant-schema migration, `GrantCommunicationProviderPermissions`, same class of fix as
  `feedback_permission_rename_needs_data_migration`) + `TenantCommunicationProviderService`. `GET
  /communication-providers`, `PUT /communication-providers/:channel`, `PATCH
  /communication-providers/:channel/:providerId`. Deliberately separate from `PlatformCommunicationProviderService`
  (platform-admin-only, catalog + read-only) rather than extending it — different guard, different tenant, same
  underlying (public-schema) entities.
- ✅ **Encryption at rest** — `EncryptionService` (`src/utility/service/encryption.service.ts`), AES-256-GCM keyed by
  new required env var `CREDENTIALS_ENCRYPTION_KEY` (hashed to 32 bytes, same `min(32)` convention as `JWT_SECRET`).
  Verified live: raw DB read of `credentials_encrypted` after a real `PUT` shows genuine ciphertext, not the
  plaintext submitted.
- ✅ **`ISmsProvider` evolved to accept credentials per-call** — `send()`/`getBalance()`/`getMessageHistory()` all
  take an optional `SmsProviderCredentials` (flat string map), `TermiiSmsProvider` resolves per-call credentials
  over its own constructor-injected default. `IEmailProvider` deliberately NOT evolved this pass — see below.
- ✅ **`SmsCredentialResolverService`** — `resolveCredentials()` (cached 300s per tenant+channel, decrypts on read,
  returns `undefined` meaning "use platform default") and `debitForSend()` (atomic, row-locked `SmsWallet` update +
  `SmsWalletTransaction` audit row, throws `403 INSUFFICIENT_SMS_BALANCE` if the tenant can't cover it). `SmsService`
  resolves once per `send()` call, debits per-batch only when no BYOK config exists — a tenant with their own Termii
  account never touches the wallet.
- ✅ **`HttpExceptionFilter` fixed** — previously only ever read `.message` off an exception body, silently dropping
  `PlanGuard`'s `code`/`requiredFeature` server-side (no frontend fix could have surfaced them regardless). Now
  passes through any fields beyond the standard NestJS `{statusCode, message, error}` shape. Verified a plain
  string-message exception is byte-for-byte unaffected.
- ✅ **Upgrade-prompt modal, both frontends** — `discuva-member`'s `ApiError` class (`.status`/`.code`, `.message` unchanged
  from before) and a new `planGateStore` (mirrors the existing `tokenStore` pattern) opened from exactly one place —
  the axios response interceptor — the instant *any* API call anywhere returns `PLAN_UPGRADE_REQUIRED`. One modal
  per app, mounted once at the root layout; no screen/call site ever checks for this error itself. Member wording
  (`discuva-member`) points at the admin ("ask your admin about upgrading"); admin wording (`discuva-admin`) doesn't link
  anywhere since no billing page exists yet.
- ✅ **Verified end-to-end**: typecheck/lint/build clean across all 3 repos; backend suite 1251 tests
  (13 new: `SmsService`, `TermiiSmsProvider`, `EncryptionService`); live — real `PUT`/`GET
  /communication-providers` round-trip against a provisioned tenant, DB-level encryption confirmed, `PlanGuard` 403
  → 200 transition re-confirmed after the exception-filter change. **Deliberately not** live-tested against the real
  Termii API — `TERMII_API_KEY` in this environment is the pilot church's actual production credential; the
  send/debit logic is covered by mocked unit tests instead, which is the correct way to test something with a real
  paid third-party side effect.

**Shipped, 2026-08 — Payment providers (Paystack + Flutterwave), email BYOK, wallet top-up, tenant profile write side:**
- ✅ **`PaystackPaymentProvider` / `FlutterwavePaymentProvider`** — `src/billing/provider/` — both real, concrete
  `IPaymentProvider` implementations, registered simultaneously (not one-platform-default-at-a-time like SMS/email)
  via `PaymentProviderRegistryService`, which resolves by name (`?provider=paystack|flutterwave`) or
  `DEFAULT_PAYMENT_PROVIDER`. Both lazily create (and persist onto `Plan.billingProviderPriceId`) a matching
  provider-side plan/payment-plan the first time a `planId` is checked out against. Paystack's Initialize Transaction
  takes `amount` in kobo (matches this codebase's existing cents/kobo convention); Flutterwave's Standard Payment
  takes major currency units, so `FlutterwavePaymentProvider` divides by 100 at every boundary — the one
  provider-specific gotcha worth knowing before touching either class.
- ✅ **`BillingCheckoutSession`** (`public.billing_checkout_sessions`, `src/migrations/1790899200000-AddBillingCheckoutSessions.ts`)
  — recorded at checkout-initiation time, primary-keyed by the provider's own reference/session id. This is the
  source of truth CheckoutService's webhook handler resolves tenant/amount/intent from — a webhook payload is never
  trusted for any of those three, only for "did this specific, already-recorded session succeed or fail."
- ✅ **`CheckoutService`** (`src/billing/service/checkout.service.ts`) — `initiateSubscriptionCheckout()`,
  `initiateWalletTopupCheckout()` (rejects with a clean 403 if `SMS_CREDIT_PRICE_KOBO` isn't configured — same
  "pricing is data, not decided here yet" posture as `plans.priceCents` being 0 at launch, `docs/PRODUCT_STRATEGY.md`
  §5), and `handleWebhookEvent()` — idempotent (row-locked, only applies a `charge.succeeded` once per session,
  status-guarded against redelivery), activates a 30-day subscription period or credits the `SmsWallet` accordingly.
- ✅ **Tenant-facing routes** — `GET /billing/summary`, `POST /billing/checkout/subscribe`,
  `POST /billing/checkout/wallet-topup` (`AdminGuard`, new `BILLING_READ`/`BILLING_WRITE` permissions) —
  `src/billing/controller/billing.controller.ts`.
- ✅ **`POST /webhooks/billing`** — `@Public()`, dispatches to Paystack or Flutterwave by which of their two very
  different signature headers is present (`x-paystack-signature` HMAC vs `verif-hash` shared-secret) — same
  dispatch shape as the pre-existing (unimplemented) `VirtualAccountWebhookController`. Added to `TenantMiddleware`'s
  exclude list proactively this time, having already been burned once by forgetting the equivalent YouTube entry.
- ✅ **Email-side BYOK, shipped.** `IEmailProvider.sendMail()` now takes an optional `EmailProviderCredentials`
  (mirrors `ISmsProvider`'s per-call-credentials shape). `EmailCredentialResolverService`
  (`src/communication-provider/service/`) is the email counterpart to `SmsCredentialResolverService` — the one real
  difference is it also returns *which* provider (`gmail` or `resend`) a tenant configured, since email has two
  incompatible-credential-shape providers where SMS only ever has one. `EmailProcessor.handleSend` now wraps its
  entire body in `runInTenantContext()` (previously only `onCompleted`/`onFailed` did) — resolving a tenant's BYOK
  config has to happen *before* the send, not just before logging it afterward, which is exactly the "genuinely more
  involved to wire safely" cost this doc originally flagged. `TenantCommunicationProviderConfig.senderIdentity` is
  reused as the email "from" address for a BYOK tenant.
- ✅ **Wallet top-up, shipped.** `POST /billing/checkout/wallet-topup` + the `charge.succeeded` webhook path above —
  `SmsWalletTransactionType.CREDIT` (previously defined, unused) now has a real writer.
- ✅ **Tenant profile self-service write side, shipped** (§Phase 6c's other deferred item) — `PATCH /tenant/info`
  (`AdminGuard`, new `CHURCH_PROFILE_WRITE` permission) — `src/tenant/controller/tenant-info.controller.ts`. A church
  admin can now edit their own `name`/`logoUrl`/`tagline`/`address`/`supportEmail`/`currency`/`timezone` without
  going through platform support. The `discuva-platform` tenant-panel gap (rename-only field) is unrelated to
  this endpoint's existence and still open.
- ✅ **Verified live** against the `frontend-test` tenant and a throwaway provisioned branch tenant: real DB reads
  confirming `BillingCheckoutSession`/`Subscription`/`SmsWallet` rows after a simulated `charge.succeeded`,
  `getBillingSummary()` defaulting correctly, full branch invite → provision → accept → rollup round-trip (below).
  **Deliberately not** live-tested against the real Paystack/Flutterwave/Resend/Gmail APIs — no sandbox credentials
  in this environment, and `RESEND_API_KEY`/`EMAIL_USER` here are real production credentials; provider HTTP calls
  and email sends are covered by mocked unit tests instead, the same discipline already applied to Termii.

**Shipped, 2026-08 — self-serve cancel/downgrade, dunning safety net, branch plan sponsorship, refunds:**
- ✅ **`POST /billing/cancel`** (`CheckoutService.cancelSubscription`) — the tenant-facing counterpart to the
  platform-admin escape hatch. Still within a paid period: sets `cancelAtPeriodEnd`, tenant keeps access until it
  ends. No period left: downgrades immediately. Best-effort calls the provider's own `cancelSubscription()` first —
  a provider API failure never blocks the local downgrade, the tenant's intent wins regardless.
- ✅ **`SubscriptionLapseScheduler`** (daily 04:00, distributed-lock guarded) — the dunning/failed-renewal safety net.
  A voluntary `cancelAtPeriodEnd` lapse downgrades cleanly; any other lapse flips `status` to `PAST_DUE` (a real
  value now, not just an unused enum member), emails the tenant, and gives a 7-day grace period before downgrading
  to Free. **Known limitation, not silently accepted:** this only fully works once
  `Subscription.billingProviderSubscriptionId` capture (below) is wired up — until then, a tenant whose real
  provider auto-renewal webhook isn't recognized will also lapse here. Documented explicitly rather than pretending
  it's solved; "retrying" a charge is the provider's own job, not this scheduler's.
- ✅ **Branch plan sponsorship** (`TenantBranchInvite.sponsorPlan`, `Subscription.sponsoredByTenantId`) — answers the
  plan-inheritance question this doc previously left open (§11.1): a parent can optionally comp a branch's plan at
  invite time. Resolved at signup (`BranchInviteService.resolveInvite`), falls back to normal independent Free
  signup if the parent is itself on Free. Excluded from `PlatformAnalyticsService`'s MRR (no real money backs it)
  and blocks the branch from self-cancelling a plan that isn't theirs to cancel.
- ✅ **Refunds** (platform-admin only) — `IPaymentProvider.refund()` on both providers (Flutterwave needs an extra
  lookup step to resolve `tx_ref` to its own transaction id first), `POST /platform/billing-sessions/:sessionId/refund`.
  Deliberately does not auto-reverse the tenant-facing effect (wallet credit, plan upgrade) — that needs a product
  decision (can a wallet go negative?) this pass didn't take on.
- ✅ **Verified live** — full app boot smoke test (caught nothing new this time, unlike the analytics pass, which
  did), migration applied, 29 new tests, mocked provider HTTP calls (same no-real-external-side-effects discipline
  as everywhere else).

**Deliberately still not built — scope boundaries, not oversights:**
- ❌ **No billing/plan settings UI anywhere.** A church admin still can't see their current plan, what Pro unlocks,
  or request an upgrade/cancel through a screen — the modal tells them a feature is locked, it doesn't show them the
  bigger picture, and there's no UI yet to call the checkout/cancel endpoints either. Backend is fully ready for this.
- ❌ **`Subscription.billingProviderSubscriptionId` capture.** Set only by a provider's own subscription-lifecycle
  webhook (Paystack `subscription.create`, Flutterwave's equivalent) — deliberately not wired this pass pending live
  sandbox testing to confirm the exact payload shape rather than guessing at undocumented-to-this-session fields.
  Until it's populated, `subscription.canceled` events are a safe no-op (nothing to look up), provider-portal-
  initiated cancellations still need the platform-admin escape hatch to reflect manually, and
  `SubscriptionLapseScheduler` (above) can't distinguish "genuinely lapsed" from "renewing fine, we just don't
  recognize the webhook" — its documented known limitation. Renewal itself isn't otherwise affected — a fresh
  `charge.succeeded` extends the period regardless of this field.
- ❌ **True recurring-billing reconciliation.** Still a flat 30-day period per successful `charge.succeeded`, not
  driven by the provider's own renewal/invoice lifecycle events.

### Phase 4 — Self-Serve Provisioning & Migration Tooling (Backend)

**Shipped, re-audited 2026-08 (no gaps found).**
- ✅ Shared provisioning service (schema create → migrate → seed → activate, §4.8) — `TenantProvisioningService.provision()`
- ✅ Public `POST /signup` endpoint, plan = `free` — `src/tenant/controller/signup.controller.ts`
- ✅ `provision:tenant` CLI script, thin wrapper over the same service — `src/provision-tenant.ts`
- ✅ `migration:run:all-tenants` script, bounded-concurrency runner — `src/migrate-all-tenants.ts`
- ✅ End-to-end test covering full provisioning, re-provisioning rejection, and resuming a stalled provision —
  `test/tenant-provisioning.e2e-spec.ts`

### Phase 5 — Platform Admin Module (Backend)

**Shipped, re-audited 2026-08 (no gaps found).** All 13 controller routes have real service implementations (no
stubs), `PlatformAdminGuard` + its own `platform-admin-jwt` Passport strategy are wired with a genuinely separate
secret, and every route matches TECH_DOC.md's documented table 1:1. One stale in-code comment on
`PlatformTenantService.impersonateTenant` (claiming the token wasn't yet routable pre-Phase-8) has been corrected.
- ✅ `src/platform-admin/` module with its own auth
- ✅ Tenant CRUD, suspend, impersonation endpoints
- ✅ Platform admin JWT with separate secret

### Phase 6 — Admin Frontend (`discuva-admin`)
- Point `NEXT_PUBLIC_API_URL` at a real tenant subdomain (`utils/auth/axios-client.ts`'s single `baseURL` — currently a bare host, 404s under live `TenantMiddleware`)
- Build `TenantContext` with `GET /tenant/info` fetch on mount
- Replace build-time env var branding reads in `app/layout.tsx`, `app/change-password/page.tsx`, `utils/currency.ts`, `components/layout/side-bar.tsx`, `components/layout/login-page.tsx` with context reads
- ~~Scope auth cookies to subdomain~~ — not applicable; access token lives in an in-memory `token-store.ts`, not a cookie, and the backend's `httpOnly` refresh cookie already has no `domain` attribute set (defaults to exact-host scoping, confirmed in `auth.controller.ts`)
- Public signup page calling `POST /signup`

### Phase 6b — Member PWA (`discuva-member`)
- Same `NEXT_PUBLIC_API_URL` fix as Phase 6, in `utils/auth/axios-client.ts`
- Same `TenantContext` + `GET /tenant/info`, replacing branding env-var reads in `app/layout.tsx`, `app/account/page.tsx`, `utils/currency.ts`, `components/layout/onboarding-page.tsx`, `components/layout/login-page.tsx`, `components/layout/loading.tsx`, `components/pwa/install-wall.tsx`
- `app/manifest.ts` needs its own decision — static route fetched pre-JS by the browser, can't read a React context; either make it dynamic via `next/headers` or accept a generic (non-branded) install manifest
- No cookie work, same reasoning as Phase 6

**Shipped, re-audited 2026-08:** all of the above landed exactly as scoped. `app/manifest.ts` went with the dynamic option — `export const dynamic = "force-dynamic"` + `next/headers` reads the incoming `Host` header server-side and fetches the tenant's name directly (3s timeout, falls back to "Your Church" on any failure so a backend hiccup never breaks PWA installability). Verified live: `GET /manifest.webmanifest` with a tenant `Host` header returns that tenant's real name; a non-tenant host falls back cleanly. `currencySymbol`/`currencyLocale` in both `utils/currency.ts` files went from `const` to live, mutable ES-module bindings updated by `TenantProvider` — every existing `import { currencySymbol }` call site (7+ finance pages in `discuva-admin`) needed zero changes.

### Phase 6c — Tenant Profile Field Completeness (Backend + Both Frontends)

**Caught during Phase 6/6b review** — `CHURCH_TAGLINE`, `CHURCH_ADDRESS`, and `SUPPORT_EMAIL` were still being read from build-time env vars in `discuva-member` even after Phase 6b, because the `Tenant` entity itself never had columns for them — `GET /tenant/info` could only ever return what §4.1's original schema defined (`name`/`logoUrl`/`currency`/`timezone`). This was flagged as a "known gap, not an oversight" in the first pass of this doc; on reconsideration that framing was wrong — there was no reason these three couldn't be tenant data too, the schema had just never been extended to carry them.

**Read side — shipped:**
- `src/migrations/1790726400000-AddTenantProfileFields.ts` — adds nullable `tagline`, `address`, `support_email` to `tenants`
- `Tenant` entity, `TenantInfoController`'s `GET /tenant/info` response, and both frontends' `TenantInfo` type all updated
- `discuva-member`'s `login-page.tsx` (tagline, address) and `app/account/page.tsx` (support email) now read from `useTenant()` instead of env vars
- **Deliberately no generic fallback for tagline/address** — every tenant provisioned so far has both `null` (signup doesn't collect them yet), and the old single-tenant hardcoded strings would now be actively wrong for every *other* tenant, not just generic. Both are hidden entirely in the UI when unset, rather than shown with a misleading default.
- `NEXT_PUBLIC_SUPPORT_EMAIL` is the one exception that keeps a real fallback — "tenant hasn't set their own support contact yet, route to the platform's shared inbox" is a legitimate behavior, not misleading tenant-specific data
- `UpdateTenantDto` (platform-admin) extended with all three fields, so there's at least an API-level way to populate them today — `Object.assign(tenant, dto)` in `PlatformTenantService.updateTenant` needed no changes to pick them up
- Verified live: direct DB update of a real tenant's `tagline`/`address`/`support_email` immediately reflected correctly in `GET /tenant/info`

**Write side — deliberately deferred, tracked here as a pending task, not built this pass:**
- **No self-service editing exists for *any* tenant profile field** — not just these three, but the pre-existing `name`/`logoUrl`/`currency`/`timezone` too. The only way to change any of it today is `PATCH /platform/tenants/:id`, platform-admin-only, via the separate `discuva-platform` operator tool. A church admin has no way to rename their own church, upload their own logo, or set a tagline without going through platform support.
- **Needed:** a tenant-facing write endpoint (e.g. `PATCH /tenant/info` or under a new church-profile controller, `AdminGuard`-protected so any church admin can use it, not just platform admins) that lets a tenant update their own `name`/`logoUrl`/`tagline`/`address`/`supportEmail`/`currency`/`timezone`.
- **Also needed:** the actual settings UI in `discuva-admin` to call it — doesn't exist yet either.
- **Also missing (smaller):** the `discuva-platform` tenant panel only exposes a rename field today (`app/tenants/tenant-detail-panel.tsx`) — `logoUrl`/`currency`/`timezone` were already backend-supported but never exposed there, and the same is now true of `tagline`/`address`/`supportEmail`. Worth extending alongside the self-service work above rather than as its own separate task, since it's the same category of "give someone an editing surface for these fields."

### Phase 7 — Platform Dashboard (`discuva-platform`)
- New Next.js app
- Tenant list, provisioning wizard, health stats
- Platform admin auth flow
- Impersonation flow

**Shipped, re-audited 2026-08.** All four items wired to the real Phase 5 backend via `utils/api/platform-admin.ts` —
tenant list with live health stats (plan, member count), a provisioning wizard, rename/suspend/reactivate/plan-change
actions, and an impersonation flow that issues and displays the token. That token is now genuinely usable end-to-end
(Phase 8's bridging landed) — the stale "not yet routable" caveat has been removed from the UI. Login flow confirmed
real (`POST /platform/auth/login` → in-memory token store → axios bearer interceptor → 401 auto-clears + redirect).
No TODOs, no mock data, one piece of dead code found (`components/layout/coming-soon.tsx`, unused, harmless). Not
visually verified in a browser (no browser tooling available when this was built) — typecheck, lint, production
build, and a live boot against the real backend (every route 200) all passed instead.

### Phase 7b — Platform Analytics Backend (Shipped, 2026-08)

Before this, `discuva-platform` had **zero cross-tenant analytics** — `GET /platform/tenants` returns a flat
per-tenant list (name, plan, member/event count), nothing ever summed across tenants, no landing dashboard (the root
route just redirects straight into the tenant table). Confirmed by reading the actual frontend source directly, not
assumed. This phase is the backend half of closing that gap — a real business-owner view of the whole platform, not
just a per-church table.

- ✅ **`PlatformAnalyticsService`** (`src/platform-admin/service/platform-analytics.service.ts`) + six new
  `GET /platform/analytics/*` routes (`overview`, `growth`, `revenue`, `engagement`, `churn`, `adoption`) — see
  TECH_DOC.md's "Platform Analytics" section for the full response shapes and query params.
- ✅ **No new aggregation infrastructure** — every metric is a live query over data that already exists and is
  already small: `tenant_rollups` (one row per tenant, already computed daily by `BranchRollupScheduler` for the
  branch-hierarchy feature — engagement analytics reuses it directly rather than recomputing anything),
  `subscriptions`, and `billing_checkout_sessions`. This was the single biggest design decision of this phase:
  resist standing up a parallel analytics pipeline when the numbers a business owner actually wants (member counts,
  attendance, giving) are already being computed for a different feature.
- ✅ **`Subscription.canceledAt`** (`src/migrations/1791072000000-AddSubscriptionCanceledAt.ts`) — a small but
  necessary addition: churn analytics needs a real "when was this canceled" timestamp, and `updatedAt` can't serve
  that purpose (it moves on any field change, not just a cancellation). Set once, in
  `CheckoutService.applySubscriptionCanceled()`.
- ✅ **Verified live** — real DB round-trip against actual `tenants`/`subscriptions`/`billing_checkout_sessions`/
  `tenant_rollups` rows, migrations applied to the dev DB, full test suite (15 new tests) green.
- ❌ **Not built this pass:** the actual dashboard UI in `discuva-platform` — headline stat cards, growth/
  revenue/churn charts, adoption breakdown. Backend is fully ready; see the project todo list for the frontend item.

### Phase 8 — Live Bridging (Existing Client Migration Section Retired)
- ~~Migrate existing church's data into tenant schema~~ — **not applicable.** There is no existing production
  church: this is a fresh rollout, the production domain isn't finalized (`APP_BASE_DOMAIN` is just an env var,
  `localhost` for now — `*.localhost` resolves to `127.0.0.1` in every modern browser/Node with no `/etc/hosts`
  changes), and the current test frontend already reaches the API through a Vercel subdomain. No dump/restore
  ceremony was needed.
- Wire `TenantMiddleware` into the live request pipeline — deferred since Phase 1 as "the bridging step." This
  turned out to be where two genuine architectural bugs surfaced, both only via real HTTP testing against a freshly
  provisioned tenant (the isolated e2e test passed throughout and caught neither):
  1. **Guards run before Interceptors.** The original split (`TenantMiddleware` resolves the tenant;
     `TenantTransactionInterceptor` opens the transaction) never scoped Guard-level DB access — e.g. the local auth
     strategy's credential lookup during login. Fixed by merging both responsibilities into `TenantMiddleware`
     itself (§4.3), which runs before guards, interceptors, and the handler alike. Deleted
     `TenantTransactionInterceptor` entirely.
  2. **Plain `@InjectRepository()` never saw the tenant transaction at all**, regardless of guard/interceptor
     ordering — a deeper issue than (1), affecting virtually every feature module. See §4.4 for the full mechanism
     and the fix: `TenantTypeOrmModule.forFeature()`, now standard for every module owning tenant-schema tables.
- Added a regression test to `test/tenant-schema-isolation.e2e-spec.ts` specifically for bug (1) — a Guard
  (`GuardNotesCheckGuard`) doing its own DB read, proven to see the correct tenant's data.
- Verified live end-to-end against a real provisioned tenant: `POST /v1/signup`, then `POST /v1/auth/admin-login`
  with the tenant's `Host` header (previously 401'd even with correct credentials — bug (2)), then an authenticated
  `GET /v1/members` confirmed the returned data was scoped to that tenant alone.
- Full verification pass: typecheck, full unit suite (1242 tests), the e2e isolation suite, and lint all clean
  after both fixes.
- Decommissioning an old deployment doesn't apply for the same fresh-rollout reason as above.

### Phase 8b — Tenant-Owned Integrations (Communication Provider BYOK + YouTube Live Detection)
Follow-up to Phase 8: two features that were built tenant-blind before multi-tenancy existed and stayed that way
through the cutover — each tenant needs its own credentials/config, not the platform's single set.

- **Communication Providers (`src/communication-provider/`):** tenant self-service BYOK for SMS/email provider
  credentials, encrypted at rest (`EncryptionService`, AES-256-GCM, `CREDENTIALS_ENCRYPTION_KEY`). See TECH_DOC.md
  §"Communication Providers (Tenant Self-Service BYOK)" for the full route/entity breakdown. `SmsService` resolves a
  tenant's own credentials first, falling back to the platform's default Termii credentials (with a wallet-credit
  debit) when the tenant has none configured — same fallback shape as YouTube below.
- **YouTube Live Detection (`src/integrations/youtube/`):** the deeper redesign of the two. Before this phase, the
  channel id, API key, and WebSub subscription state were all single global values (`YOUTUBE_CHANNEL_ID` env var,
  `OnModuleInit` boot-time subscribe, a singleton `youtube_integration_state` row in **every** tenant schema even
  though only one config could ever be live platform-wide). Redesigned so channel id (required) and API key
  (optional BYOK, falls back to the platform's `YOUTUBE_API_KEY`) are per-tenant, set via `PUT /v1/youtube-integration`.
  - **Why the new state table (`tenant_youtube_integrations`) lives in `public`, not the tenant schema it replaced:**
    a WebSub notification arrives from Google's hub with no `Host` header or any other tenant-identifying context —
    only a channel id inside the Atom XML payload. "Which tenant does this channel belong to" has to be answerable
    *before* the tenant is known, which per-tenant-schema data structurally can't support (same reasoning as
    `TenantCommunicationProviderConfig`, §4.12). `channel_id` is `UNIQUE` across the whole table, which is exactly
    what makes the webhook's tenant lookup a single indexed query.
  - **Live regression caught during this phase, not designed in up front:** the webhook callback route
    (`v1/integrations/youtube/callback`) had never been added to `TenantMiddleware`'s exclude list (§4.3) — a real
    WebSub notification would have 404'd before reaching the handler, entirely silently, since the feature had never
    actually been configured in any environment this code had run in. Fixed alongside the redesign.
  - `YoutubeLiveDetectionService.handleNotification()` now resolves the owning tenant from the notified channel id,
    then manually enters that tenant's CLS/transaction context (the same `cls.runWith(...) → txHost.withTransaction(...)
    → SET LOCAL search_path` pattern `PlatformTenantService.impersonateTenant` already uses) before calling
    `AnnouncementService.createSystemAnnouncement()` — a webhook has no request-scoped `TenantMiddleware` run to
    inherit tenant context from, so it has to open one itself.
  - `YoutubeSubscriptionScheduler`'s daily re-subscription now iterates every `isActive` tenant integration instead
    of renewing one global subscription.
  - See TECH_DOC.md §"YouTube Live Detection" for the full route/entity/flow breakdown.
- Both were verified live against the `frontend-test` tenant: DB-level confirmation that credentials are actually
  encrypted at rest (not just typed as encrypted), full read/write/toggle round-trip through the service layer, no
  real external API calls triggered (WebSub env vars intentionally left unset locally; Termii's real API key was
  never exercised against a live send).
- Full verification pass: typecheck, full unit suite, lint all clean after both features.

### Phase 9 — Multi-Branch Hierarchy Backend (Shipped, 2026-08)
- ✅ `parent_tenant_id` added to `public.tenants` (nullable, self-referencing, `ON DELETE SET NULL`) —
  `src/migrations/1790985600000-AddBranchHierarchy.ts` — same migration also adds `public.tenant_branch_invites`
  and `public.tenant_rollups`.
- ✅ **Branch invite flow** (`src/branch/service/branch-invite.service.ts`, §11.1) — parent admin
  `POST /branch/invites` (email) generates a 32-byte opaque token (not a signed JWT — has to be looked up by value
  later, not decoded), emails it (`EmailQueueService`, no template file — a short inline HTML message, proportionate
  to a one-off transactional email), and records a `pending` row. `POST /signup` accepts an optional
  `branchInviteToken`; `SignupController` resolves+validates it (pending, unexpired) *before* provisioning so a
  bad/expired code fails fast without creating a tenant row, passes `parentTenantId` into
  `TenantProvisioningService.provision()`, and only marks the invite `accepted` *after* provisioning actually
  succeeds — a subdomain collision leaves the invite still usable for a retry, not burned.
- ✅ **Rollup computation** (`src/branch/service/branch-rollup.service.ts`, §11.3) — `computeAndUpsertOne(tenant)`
  manually enters that tenant's CLS/transaction context (identical mechanism to
  `YoutubeLiveDetectionService`/`PlatformTenantService.impersonateTenant`), computes `memberCount` (active members),
  `attendanceRate` (same PRESENT/LATE/ATTENDED_ONLINE-over-30-days definition `AttendanceService.getMyAttendanceSummary`
  already uses per-member, aggregated church-wide here), and `totalGiving` (sum of `tithe_records.amount`) — all
  three purely from that tenant's own schema — then upserts the public `tenant_rollups` row *outside* the tenant
  context block, same convention as YouTube's own public-row update. `BranchRollupScheduler` runs this daily
  (03:00 church time, distributed-lock guarded) for **every** active tenant, not just ones with a parent — a branch
  invited later still needs history once linked.
- ✅ **Parent-side overview** — `GET /branch/overview` (`BranchRollupService.getOverview()`) reads only
  `tenants WHERE parent_tenant_id = :self` joined against `tenant_rollups` — no cross-schema/cross-shard read
  anywhere, exactly as designed in §11.2. New `BRANCH_READ`/`BRANCH_WRITE` permissions
  (`GET/POST/DELETE /branch/invites`, `GET /branch/overview`, `AdminGuard`).
- ✅ **Verified live** against the `frontend-test` tenant: full round-trip — invite created, token resolved,
  a throwaway tenant provisioned with `parentTenantId` set via `TenantProvisioningService.provision()` directly (not
  real HTTP signup, since this was a verification script), invite marked accepted, rollup computed and correctly
  reflecting the branch's actual member count, overview correctly joining the branch with its rollup. Email send
  stubbed out for the run (real `RESEND_API_KEY` configured in this environment) — same discipline as Termii/Paystack.
- ❌ **Not built this pass:** parent-side overview *UI* (platform dashboard or admin portal — undecided which, per
  the original Phase 9 note) and any branch-invite-sending UI. Backend is fully ready for both.
- See §11 for the full design this implements.

### Phase 9b — Branch Trust: Sharing Consent & Un-linking (Shipped, 2026-08)

A real gap flagged during product review: the instant a branch accepted an invite, its rollup (member count,
attendance, **giving**) became visible to its parent via `GET /branch/overview` — no notice, no consent, no opt-out.
Given how sensitive individual church finances are treated everywhere else in this codebase (dedicated `TITHE_READ`
permission, PII-scrubbing conventions), silently exposing giving totals cross-tenant the moment an invite was
accepted was worth fixing before this shipped any further.

- ✅ **`tenants.share_data_with_parent`** (default `true`) / **`tenants.share_giving_with_parent`** (default
  `false`, independent of the first) — `src/migrations/1791244800000-AddBranchSharingConsent.ts`. Self-service,
  settable only by the branch's own admin (`GET`/`PATCH /branch/sharing-consent`), never the parent. Gates
  *visibility* at `getOverview()`, not *computation* — `computeAndUpsertOne` still computes and stores every
  branch's real numbers regardless, same as before; a branch's own rollup is its own data either way.
  `shareDataWithParent` defaults on (being a branch structurally implies a reporting relationship); giving
  specifically defaults off even when general sharing is on.
- ✅ **Un-linking, either direction** — `DELETE /branch/:branchTenantId` (parent detaches one of its own branches)
  and `POST /branch/leave` (branch leaves its own parent). Neither side of the relationship is permanently locked
  into it. Both revoke a sponsored plan on the way out if the departing tenant was sponsored by the specific parent
  being severed from (`revokeSponsorshipIfSponsoredBy`) — continuing free access sponsored by a parent it's no
  longer affiliated with wouldn't make sense; a subscription sponsored by some *other* tenant is left alone.
- ✅ **Verified live** — migration applied, full app boot smoke test, 23 new tests (`BranchRollupService`,
  `BranchController`), lint/typecheck/full-suite clean (1408 tests).
- See TECH_DOC.md's "Branch Hierarchy" section for the full route table and response shape.

### Phase 9c — Email BYOK Expansion: Custom Domains + SendGrid + Mailgun (Shipped, 2026-08)

Product question: can a tenant use their own email domain rather than being locked to the platform's Gmail
mailbox, and could two more popular providers be added? Answered both without a migration to `communication_providers`'
FK shape — `gmail`'s catalog id/class stayed unchanged, its BYOK credential handling was generalized instead.

- ✅ **`GmailProvider` accepts optional `host`/`port`/`secure` overrides** in a tenant's BYOK credentials, on top of
  the existing required `user`/`password`. Omitting them keeps the platform's own host/port/secure/service (just a
  different mailbox); supplying `host` routes an entirely different mail server (Outlook/Office365, Zoho, a
  tenant's own company server) and drops the `service` preset (a nodemailer shorthand a custom host wouldn't want
  silently overriding explicit settings).
- ✅ **`SmtpProvider`** (`providerId: 'smtp'`) — new, deliberately BYOK-only. Unlike every other provider there's no
  sensible platform default for "arbitrary custom SMTP server"; choosing this provider *is* the tenant bringing
  their own. Throws a clean error if called without full `{host, user, password}` credentials.
- ✅ **`SendGridProvider`** (`providerId: 'sendgrid'`) and **`MailgunProvider`** (`providerId: 'mailgun'`) — new,
  both call their REST APIs directly via native `fetch`, no SDK dependency. SendGrid: Bearer auth, JSON body.
  Mailgun: HTTP Basic auth (`api:{key}` base64), `FormData` body, needs `{apiKey, domain}` — `MAILGUN_BASE_URL`
  lets the EU region be selected without a code change.
- ✅ **`src/migrations/1791331200000-AddEmailProviderCatalogEntries.ts`** — row-insert only (`smtp`, `sendgrid`,
  `mailgun` into `communication_providers`), no schema change — exactly the "adding a provider is a row insert, not
  a migration" pattern §4.12 already established for the original `termii`/`gmail`/`resend` seed.
  `EmailProcessor.resolveProvider(providerId)` dispatches across all five by a switch, falling back to
  `GmailProvider` for `gmail` or any unrecognized id.
- ✅ **No controller/DTO/route changes anywhere** — the existing generic `/communication-providers` BYOK endpoints
  (`UpsertProviderConfigDto.credentials: Record<string,string>`) already handle any catalog-registered provider
  with any credential shape; this is purely new provider classes plus new catalog rows.
- ✅ **Verified live** — migration applied, full app-boot smoke test, throwaway script round-tripped a real
  `upsertConfig` → `resolveConfig` cycle for all three new providers against a real tenant (encrypted storage,
  decrypted resolution, correct `providerId` routing — all confirmed, then rolled back with zero residue). 17 new
  tests across `GmailProvider`/`SmtpProvider`/`SendGridProvider`/`MailgunProvider`/`EmailProcessor` specs,
  lint/typecheck/full-suite clean (1425 tests). No real SendGrid/Mailgun/SMTP send was ever attempted — no sandbox
  credentials exist for them, same discipline used for Paystack/Flutterwave/Termii throughout this project.
- See TECH_DOC.md's "Communication Providers" section for the full provider/credential-shape table.

### Phase 9d — Platform Admin RBAC + Onboarding (Shipped, 2026-08)

§4.10's `PlatformAdmin` had no permission system at all since it was first built — `isActive: true` meant full
access to every `/platform/*` route, `false` meant none, and the *only* way to create one was a hand-written SQL
insert (there was never a CRUD surface for it). Fixed both gaps together, mirroring tenant-side `AdminRole`/`Admin`
as closely as the two disjoint identity systems allow.

- ✅ **`PlatformAdminRole`** (new entity + `platform_admin_roles` table) — `name`, `description`,
  `permissions: string[]`, same shape as tenant `AdminRole`. `PlatformAdmin` gained a required
  `platformAdminRoleId` FK (`onDelete: RESTRICT`).
- ✅ **`PlatformAdminPermission`** (new enum, `src/platform-admin/enum/`) — twelve permissions across six groups
  (tenants read/write/impersonate, plans, communication providers, billing, analytics, platform-admins), disjoint
  from tenant-side `AdminPermission` even where a string value looks similar — the two guards/JWTs must never be
  able to satisfy each other.
- ✅ **`PlatformAdminGuard` now does double duty** — JWT validation (unchanged, via the `platform-admin-jwt`
  Passport strategy) *and* permission checking, combined into one guard rather than split across a global guard +
  a per-route guard the way tenant-side does it — `/platform/*` has no global-guard equivalent to lean on, since
  every platform controller applies `PlatformAdminGuard` explicitly already. Permissions are loaded once, at JWT
  validation time (`PlatformAdminAuthService.validateById` eager-loads the role relation), not a second DB
  round-trip per request the way tenant-side `AdminGuard` does it.
- ✅ **Every existing `/platform/*` route retrofitted** with `@RequiresPlatformPermission(...)` —
  `PlatformAdminController`'s 15 routes individually, `PlatformAnalyticsController`'s 6 routes via one class-level
  decorator (uniform permission across all of them).
- ✅ **`PlatformAdminManagementController`/`PlatformAdminRoleController`** — full CRUD to onboard and manage
  platform admins and the roles assigned to them (`/platform/admins`, `/platform/admin-roles`). No audit-log
  tie-in (no tenant-scoped `audit_logs` table to write into from the control plane, and platform-admin actions
  aren't audited anywhere else in this codebase either). `PATCH /platform/admins/:id` blocks an admin from
  modifying their own record entirely — stricter than tenant-side, whose equivalent split this across two
  endpoints (`update()` self-blocks, `revoke()` doesn't).
- ✅ **`DefaultPlatformAdminSeed`** (`npm run seed:platform-admin`) — mirrors `src/seed.ts`/`DefaultAdminSeed`
  exactly: `DEFAULT_PLATFORM_ADMIN_EMAIL`/`DEFAULT_PLATFORM_ADMIN_PASSWORD_HASH` env vars, same
  `npm run hash:password` to generate the hash, idempotent (skips if any `platform_admins` row already exists).
  This is the answer to "how do you create the very first platform admin without a SQL console" — there was
  genuinely no other way before this.
- ✅ **Migration backfill** — `AddPlatformAdminRoles` seeds a `SuperAdmin` role with every permission and backfills
  any pre-migration `platform_admins` row onto it (nullable column → backfill → `NOT NULL`, the standard safe
  shape), so a hand-created admin from before this system existed keeps working with full access, not locked out.
- ✅ **Tenant response shape tightened** (`PlatformTenantService`) — `createTenant`/`updateTenant`/`suspendTenant`
  previously returned the raw `Tenant` entity, leaking `schemaName`/`clusterId`/`parentTenantId`/sharing-consent
  columns that have no business being visible outside the service. All four tenant-returning methods now go
  through one `toHealthShape()` builder, identical to what `GET /platform/tenants` already returned.
- ✅ **Verified live** — migration applied (confirmed the existing hand-created `dev@platform.local` admin
  correctly backfilled onto `SuperAdmin` with all 12 permissions), full app-boot smoke test, and a real
  permission-denial round-trip against the live backend: created a role with only `tenants:read`, created an admin
  with it, confirmed `GET /platform/tenants` succeeded while `PATCH /platform/tenants/:id`,
  `GET /platform/analytics/overview`, and `POST /platform/admins` all correctly 403'd with
  `"Missing required permission: ..."` — then confirmed the self-modification block on the SuperAdmin's own
  record. 35 new tests (guard, both new services, both new controllers, the seed script) — a real test of the
  guard's `canActivate()` logic itself, not just a controller method call bypassing it, since that exact class of
  gap (controller-level unit tests never exercising the actual guard) is what let two real bugs ship silently
  earlier in this same project. Full suite clean (1484 tests).
- ✅ **discuva-platform frontend built** — `/admins` and `/admin-roles` pages (onboard/edit-role/deactivate
  admins; create/edit/delete roles with a grouped permission-checkbox picker). `AuthProvider` now fetches
  `/platform/admins/me` and exposes `permissions`/`hasPermission()`; the sidebar and `withAuth()` (new
  `requiredPermission` option) both read from it, so nav items and whole pages hide/403 for admins missing the
  relevant permission instead of just the API silently rejecting the request underneath a rendered page.

---

### Phase 9e — Tenant Welcome / Set-Password Flow (Shipped, 2026-08)

Provisioning a tenant via `POST /platform/tenants` previously required the platform admin to type in the new
church's first admin password directly (`CreateTenantDto` extended `SignupDto`, so it inherited `adminPassword`) —
and sent no email at all, leaving the platform admin to communicate that password to the church out-of-band
themselves. Fixed both:

- ✅ **`CreateTenantDto` rewritten**, no longer extending `SignupDto` — has no `adminPassword` field. The two DTOs
  diverged enough (one collects a password from someone present to choose it, the other doesn't) that sharing a base
  class meant fighting inherited required-field validators rather than benefiting from them.
- ✅ **`TenantProvisioningService.provision()`** — `adminPasswordHash` is now optional on `ProvisionTenantParams`.
  Self-serve `/signup` and branch-invite signup are unchanged (still supply their own hash, `changedPassword: true`,
  no email). When omitted, `seedTenantAdmin()` generates a random password via
  `UtilityService.generateRandomPassword()` (never revealed to anyone) with `changedPassword: false`, and generates a
  6-digit OTP stored in `password_reset_otps` — the *same table and verification logic* the forgot-password flow
  already uses (`AuthService.resetPassword`), just seeded at provisioning time instead of via a user-initiated
  request. Deliberately reused rather than building a parallel token mechanism.
- ✅ **48-hour OTP expiry** (`WELCOME_OTP_TTL_HOURS`), not the normal 15-minute forgot-password window — a new
  tenant's first admin may not check email the same day. A 6-digit code living for two days is more brute-forceable
  than one living for minutes, so `POST /auth/reset-password` picked up the same `@Throttle({5/min})` `forgot-password`
  already had — it had none before this, a pre-existing gap this surfaced and closed for both flows.
- ✅ **`tenant-welcome.html`** (new template) — warm, first-person "welcome to your new workspace" copy distinct
  from the existing plain `welcome-admin.html` (which shows the admin's actual password in cleartext — a different,
  pre-existing pattern, not reused here on purpose). Shows the OTP in a styled box (mirrors
  `forgot-password-otp.html`) *and* a "Set My Password" button linking to
  `{ADMIN_LOGIN_URL}/set-password?email=...&otp=...`, so the admin can either click through or type the code
  manually.
- ✅ **discuva-admin `/set-password` page** (new, unauthenticated) — reads `email`/`otp` from the URL, pre-fills
  them, and calls the existing `POST /auth/reset-password` via `authService.resetPassword()` — no new backend
  verification endpoint needed, this is the same call `ForgotPasswordModal`'s verify step already makes. On success,
  routes to `/` to sign in.
- ✅ **discuva-platform's Add Tenant form** — password field removed; a short note now explains the new admin
  gets a welcome email instead.
- ✅ **Verified live** — provisioned a real test tenant with no `adminPassword` in the request, confirmed the welcome
  email queued with a correctly-formed set-password link and a 6-digit OTP whose hash matched a fresh
  `password_reset_otps` row, walked the `/set-password` link end-to-end to set a real password, then logged in with
  it — full round trip, not just unit coverage. 1490 backend tests clean (was 1484 — 6 new, covering the
  `adminPasswordHash`-omitted/-supplied/resuming branches of `seedTenantAdmin` and the welcome email's content).

---

### Phase 9f — Platform Admin Onboarding Follows the Same Welcome-Email Flow (Shipped, 2026-08)

`POST /platform/admins` had the identical gap Phase 9e just closed for tenants — an existing platform admin typed a
password directly into the "onboard admin" form on the new admin's behalf, no email sent, out-of-band communication
left to whoever ran it. Closed the same way, adapted to platform admins having no underlying `Member`/tenant schema:

- ✅ **New migration** (`AddPlatformAdminPasswordReset`) — `platform_admins.changed_password` (default `true`, so
  every pre-existing row — bootstrap-seeded or human-password-typed — is unaffected; only the new onboarding path
  sets it `false`) and a new `platform_admin_password_reset_otps` table (`public` schema, `platform_admin_id` FK
  `ON DELETE CASCADE`) — kept separate from tenant-side's `password_reset_otps` rather than shared, consistent with
  `PlatformAdmin`/`Member` being deliberately disjoint identity systems throughout this project.
- ✅ **`CreatePlatformAdminDto`** — no `password` field. `PlatformAdminManagementService.create()` generates one via
  `UtilityService.generateRandomPassword()` (never revealed), a 6-digit OTP (48h TTL — matches
  `WELCOME_OTP_TTL_HOURS`'s tenant-side reasoning exactly), and fire-and-forgets a `platform-admin-welcome` email
  with a `{PLATFORM_LOGIN_URL}/set-password?email=...&otp=...` link.
- ✅ **`PlatformAdminAuthService` gained `forgotPassword`/`resetPassword`** — platform admins had *no* self-service
  password reset at all before this (only login existed). Mirrors `AuthService`'s member-facing flow exactly: silent
  on an unknown email, OTP hashed with argon2, 15-minute TTL for a self-requested reset (vs. the 48-hour welcome
  one). `resetPassword` is the same endpoint for both a self-requested reset and a new admin's first-time setup.
  `login()` now also returns `requiresPasswordChange: !admin.changedPassword`, matching the tenant-side login
  response shape — informational only today, since a random unrevealed password can't practically be logged in
  with, so nothing enforces it in the frontend the way discuva-admin's `/change-password` does for a *known*
  temporary password.
- ✅ **`POST /platform/auth/reset-password` rate-limited** (5/min) — new endpoint, added the throttle from day one
  rather than retrofitting it the way tenant-side's equivalent needed to be.
- ✅ **New `platform-admin-welcome.html` template** — same design system as `tenant-welcome.html`, but framed as
  internal team onboarding ("You've been added as a platform admin") rather than a church's new workspace — no
  `church_name`/`church_address` branding, since this is the vendor's own operator console, not tenant-facing.
- ✅ **New `PLATFORM_LOGIN_URL` env var** — discuva-platform's own base URL, the platform-side equivalent of
  `ADMIN_LOGIN_URL`.
- ✅ **discuva-platform's Onboard Admin form** — password field removed, same explanatory note pattern as the
  Add Tenant form. New `/set-password` page, styled to match this app's existing single-card `/login` page (not
  discuva-admin's dark-panel split layout — the two apps have different login page designs).
- ✅ **Verified live** — onboarded a real test platform admin with no password in the request, confirmed
  `changedPassword: false`, a 48-hour OTP row, and the welcome email queued with the right subject/template;
  completed the exact `POST /platform/auth/reset-password` call the new page makes, confirmed `changedPassword`
  flipped to `true` and login returned `requiresPasswordChange: false`; also exercised `forgot-password` for both a
  known admin (new unused OTP added, prior used one untouched) and an unknown email (identical generic response, no
  leak); confirmed the OTP row cascade-deletes with its admin. 1498 backend tests clean (was 1490 — 8 new).

---

### Phase 9g — SMS Pure BYOK: Wallet Removal + Twilio (Shipped, 2026-08)

The platform-run `SmsWallet` (prepaid credit balance, billed in kobo, fallback to a platform-default Termii account)
made SMS feel Nigeria-specific even though the rest of the platform is built for churches "across Africa and
beyond." Removed entirely in favor of pure BYOK — every tenant configures and activates their own SMS provider, no
platform fallback exists. Added Twilio as a second SMS vendor to prove the provider abstraction actually supports
more than one, and seeded `sendgrid` (Twilio's real email product — separately credentialed from Twilio's SMS API,
so two catalog rows, not one shared "Twilio" entry) into the communication-providers catalog, since
`SendGridProvider` already existed in code but was never seeded and so was never tenant-selectable.

- ✅ **`SmsWallet`/`SmsWalletTransaction` dropped** — entities deleted, `debitForSend()` removed from
  `SmsCredentialResolverService`, `initiateWalletTopupCheckout()`/`POST /billing/checkout/wallet-topup` removed from
  `CheckoutService`/`BillingController`, `BillingCheckoutType.WALLET_TOPUP` removed (`BillingCheckoutType` is just
  `SUBSCRIPTION` now), `BillingSummary.walletBalanceCredits` removed. New migration
  (`RemoveSmsWalletAndSeedTwilioProviders`) drops `sms_wallets`/`sms_wallet_transactions` and
  `billing_checkout_sessions.credits_amount` (dead once `WALLET_TOPUP` was the only writer of it).
- ✅ **`SmsService.send()`/`getBalance()`/`getLogs()` now throw `403 SMS_PROVIDER_NOT_CONFIGURED`** when a tenant has
  no active SMS provider — no more silent fallback to a platform default. `SmsCredentialResolverService.resolveConfig()`
  returns `{ providerId, credentials }` (previously just credentials) so the caller knows *which* vendor to dispatch
  to, not just that BYOK credentials exist — matching the shape `EmailCredentialResolverService` already used.
- ✅ **`SmsProviderRegistryService`** (`src/sms/service/`) — same shape as `PaymentProviderRegistryService`: every
  registered `ISmsProvider` (`termii`, `twilio`) live simultaneously in a `Map`, `SmsService` resolves by the
  tenant's active `providerId`. Replaces the old single-class `SMS_PROVIDER` DI token binding in `SmsModule`.
- ✅ **`TwilioSmsProvider`** — Twilio's Messages API has no bulk-send endpoint (unlike Termii's true bulk request),
  so it issues one `POST` per recipient via `Promise.all`, joining the returned `sid`s for `messageId`.
  `ISmsProvider` gained `maxRecipientsPerRequest` (Termii 100, Twilio 20 — a concurrency cap, not a vendor limit)
  so `SmsService`'s batching uses the resolved provider's own value instead of a hardcoded Termii constant.
- ✅ **One active provider per channel, enforced server-side** — `TenantCommunicationProviderService.upsertConfig()`/
  `setActive()` (when activating) now run inside a transaction that also deactivates every other provider already
  active on that same channel for the tenant. Previously nothing stopped a tenant from having two `isActive: true`
  rows for the same channel, which made `SmsCredentialResolverService`/`EmailCredentialResolverService`'s
  single-row `.getOne()` pick arbitrary.
- ✅ **`sendgrid` seeded into `communication_providers`** (`email` channel, catalog name `SendGrid (Twilio)`) —
  `SendGridProvider` was already a complete `IEmailProvider` implementation but had no catalog row, so no tenant
  could actually select it via `PUT /communication-providers/email`.
- ✅ **`TERMII_API_KEY`/`TERMII_SENDER_ID`/`SMS_CREDIT_PRICE_KOBO` env vars removed** — no platform-default SMS
  credentials exist anymore, and there's no wallet left to price credits for. `TERMII_BASE_URL` stays (Termii's API
  host is infrastructure, not a secret, and every tenant's Termii account — BYOK — talks to the same host).
- ✅ **discuva-admin's `/billing` page** — SMS Wallet card and top-up form removed; **discuva-platform**'s tenant
  detail panel and analytics dashboard — `smsWalletBalance`/`walletTopupRevenueCents` removed, revenue chart is a
  single-series `BarChart` now (subscriptions only) instead of a two-segment `StackedBarChart`.
- ✅ **Verified live** — 144 backend test suites / 1722 tests clean, `tsc --noEmit` and `nest build` clean;
  discuva-admin and discuva-platform both `tsc --noEmit` and `next build` clean.

---

### Phase 9h — Virtual-Account Giving Scaffold Deleted (Shipped, 2026-08)

The dedicated-bank-account-per-member giving mechanism (entity, service, webhook controller) referenced throughout
this doc as design precedent was never actually implemented — every `VirtualAccountService` method threw
`NotImplementedException`, and the member app's card was labeled "Coming Soon." Deleted entirely rather than
finished, in favor of a tenant-owned checkout flow instead: the member is redirected to the church's own hosted
checkout page (BYOK Paystack/Flutterwave/Kora/Stripe credentials, same shape as Communication Providers' BYOK
pattern) rather than being issued a dedicated account number to transfer into. Every checkout session will record
which member initiated it (mirroring how `BillingCheckoutSession` already records which tenant did) so giving can be
tied back to a member the same "the webhook only ever confirms a row we already wrote" way tenant billing already
is — not yet built, this phase is the deletion only.

- ✅ **Deleted:** `MemberVirtualAccount` entity, `VirtualAccountService` (stub), `VirtualAccountWebhookController`,
  `RequestVirtualAccountDto`, `VirtualAccountProvider` enum. `TitheSource.VIRTUAL_ACCOUNT` and
  `JournalEntrySource.VIRTUAL_ACCOUNT` removed (their `PAYMENT_GATEWAY` siblings remain — the value the checkout
  flow will use once built). `TitheRecord.virtualAccount` relation removed. Member/admin routes removed
  (`POST/GET tithes/me/virtual-account(s)`, `PATCH admin/tithes/virtual-accounts/:id/deactivate`,
  `POST webhooks/virtual-account-credit`).
- ✅ **New tenant migration** (`DropMemberVirtualAccounts`) drops `member_virtual_accounts` and
  `tithe_records.virtual_account_id` — the table never held a real row in any environment this migrated through, so
  there's nothing to carry forward (same "never configured beyond scaffolding" situation as
  `DropYoutubeIntegrationState` earlier in this phase list).
- ✅ **discuva-member:** `VirtualAccountCard` and its "Coming Soon" BVN form deleted from the Give tab;
  `useTithes()` no longer exposes `virtualAccount`/`createVirtualAccount`; the FAQ entry explaining the
  not-yet-available dedicated account number removed. **discuva-admin:** `TitheSource`/`JournalEntrySource` type
  unions and the tithe-source badge label updated to match.
- ✅ **Verified live** — full backend suite, `tsc --noEmit`, and `nest build` clean; discuva-member and
  discuva-admin both `tsc --noEmit` and `next build` clean.

---

### Phase 9i — Giving Checkout: Tenant-Owned Paystack/Flutterwave/Kora/Stripe (Shipped, 2026-08)

The tenant-owned checkout flow promised in Phase 9h's deletion note, now built — a member pays the church directly
via a hosted checkout page, using the church's *own* Paystack/Flutterwave/Korapay/Stripe merchant account, never a
platform one. New top-level module (`src/giving-checkout/`), same shape as Communication Providers' BYOK pattern
throughout: pure BYOK, no platform-default credentials, "one active provider at a time" enforced identically. Full
design/route/entity breakdown in TECH_DOC.md § "Giving Checkout (Tenant-Owned, BYOK)".

- ✅ **`IGivingProvider` + `GivingProviderRegistryService`** — same registry shape as
  `PaymentProviderRegistryService`/`SmsProviderRegistryService`, all four vendors live simultaneously,
  credentials always passed per call (never `ConfigService`-injected, since every tenant brings their own account).
- ✅ **Four real provider classes**, one `fetch`-based `IGivingProvider` implementation each: `PaystackGivingProvider`,
  `FlutterwaveGivingProvider` (both BYOK counterparts of billing's existing platform-keyed classes — same API
  shapes), plus two genuinely new integrations written against each vendor's documented API — `KoraGivingProvider`
  (Korapay's Initialize Charge, major-unit amount, HMAC-SHA256 webhook signature over the `data` object only) and
  `StripeGivingProvider` (Checkout Sessions, form-urlencoded body — Stripe's API is the one vendor in this codebase
  that isn't JSON — smallest-unit amount, HMAC-SHA256 `t=…,v1=…` timestamped webhook signature over a distinct
  webhook-signing secret). Kora/Stripe haven't been exercised against live sandbox credentials yet — written to
  match documented API shape, same "verify before a tenant relies on it in production" caveat as Paystack/
  Flutterwave's own deferred subscription-webhook gaps elsewhere in this doc.
- ✅ **Three new control-plane entities** — `GivingProvider` (catalog), `TenantGivingProviderConfig` (BYOK
  credentials, `EncryptionService` AES-256-GCM, `select: false`), `GivingCheckoutSession` (mirrors
  `BillingCheckoutSession` exactly — primary keyed by the provider's own reference, recorded at
  checkout-*initiation* time, the only thing a webhook payload is ever trusted for identity/amount against).
  Deliberately `public` schema, not `finance_*`/tenant-scoped — the inbound webhook has zero tenant (schema)
  context, only a `:tenantId` path param, so these must be resolvable before any tenant context exists at all.
- ✅ **The one genuinely new piece of infrastructure** (flagged as such before building started, not just another
  BYOK-rows repeat): tenant-scoped webhook routing. `POST /webhooks/giving/:tenantId/:provider` — unlike billing's
  single shared platform-wide route (one Paystack secret, one Flutterwave secret to check against), this resolves a
  *specific tenant's own* stored credentials from the `:tenantId` path param before verifying anything, then
  manually enters that tenant's schema (`Tenant.schemaName` lookup + `runInTenantContext()`, the same mechanism Bull
  processors use, applied here to a public HTTP request for the first time) purely to write the resulting
  `TitheRecord`. Excluded from `TenantMiddleware` (`v1/webhooks/giving/(.*)`) — same no-Host-header reasoning as the
  billing webhook and YouTube callback before it.
- ✅ **Member tied to every checkout, as promised in Phase 9h** — `GivingCheckoutSession.memberId` recorded at
  initiation, read back off that row (never the webhook payload) when the resulting `TitheRecord` is created —
  `source: PAYMENT_GATEWAY`, `externalReference` = the session id, `paymentChannel` = the provider id.
- ✅ **discuva-admin: new `/giving-providers` settings page** (`TITHE_READ`/`TITHE_WRITE`, added to the System nav
  group, module-gated on `tithe`) — same generic catalog + BYOK credential form + active-toggle UI as Communication
  Providers, provider-specific credential fields (Paystack/Kora: secret key only; Flutterwave: secret key + webhook
  hash; Stripe: secret key + webhook signing secret).
- ✅ **discuva-member: "Give via Checkout" card** in the Give tab, above the existing static-account transfer
  instructions — entirely absent (not just disabled) unless a tenant has an active giving provider configured;
  amount + optional fund/account picker, redirects to the provider's hosted checkout page. Return handling
  (`?checkout=success|cancelled`) shows an optimistic confirmation and schedules a refetch a few seconds out, since
  the checkout session only flips to `COMPLETED` (and the `TitheRecord` only exists) once the provider's own webhook
  actually lands, which may lag the redirect.
- ✅ **Verified live** — 150 backend test suites / 1758 tests clean (was 143/1718 — 7 new suites, 40 new tests),
  `tsc --noEmit` and `nest build` clean; discuva-admin and discuva-member both `tsc --noEmit` and `next build` clean.

### Phase 9i addendum — Webhook URL surfaced in the Giving Providers UI (Shipped, 2026-08)

Prompted by a direct question: a tenant configuring BYOK credentials had no way to know the callback URL to paste
into their own Paystack/Flutterwave/Kora/Stripe dashboard — `GET /finance/giving-providers` didn't return the
tenant's own id, and nothing on the page displayed the `/webhooks/giving/:tenantId/:provider` URL at all.

- ✅ **`TenantGivingProviderService.listProviders()`** now also returns `tenantId` (`this.cls.get('tenantId')`,
  already resolved every call — no new query) alongside `catalog`/`ownConfigs`.
- ✅ **discuva-admin:** each provider's Configure/Edit Credentials panel gained a read-only, copyable "Webhook URL"
  field, built client-side as `buildGivingWebhookUrl(tenantId, providerId)` = `NEXT_PUBLIC_API_URL +
  /webhooks/giving/{tenantId}/{providerId}` — deliberately the bare `NEXT_PUBLIC_API_URL`, not
  `getTenantApiBaseUrl()`'s subdomain-prefixed variant, since the webhook route is excluded from `TenantMiddleware`
  and has no subdomain to resolve a tenant from.
- ✅ **Verified live** — full backend suite (152/1792) clean, `tsc --noEmit`/`nest build` clean; discuva-admin
  `tsc --noEmit`, `eslint`, `next build`, and full Jest suite (204 tests) all clean.

---

### Phase 9j — Platform-Admin Giving Overview (Shipped, 2026-08)

The "full overview" half of Phase 9i's promise — platform support needed visibility across every tenant's
giving-checkout activity, not just each church's own. Mirrors the existing Communication Providers/Billing
platform-support surfaces exactly: a per-tenant support lookup plus a cross-tenant analytics endpoint.

- ✅ **`PlatformGivingProviderService`** (new, `src/platform-admin/service/`) — `getTenantGivingProviders(tenantId)`,
  same shape as `PlatformCommunicationProviderService.getTenantProviders()`. Wired to
  `GET /platform/tenants/:id/giving-providers` (`BILLING_READ` — reused rather than adding a dedicated permission
  for one lookup, since giving-checkout is a money concern from the platform's perspective).
- ✅ **`PlatformAnalyticsService.getGiving(period, months)`** — new `GET /platform/analytics/giving` route. Every
  breakdown (`totals`, `byProvider`, `byTenant`, `trend`) is grouped by `currency`, never blended — a completed
  Stripe (USD) session summed against a completed Paystack (NGN) one into one number would be a real, easy-to-miss
  correctness bug in a money-adjacent feature, so this was treated with the same rigor as the per-vendor
  amount-unit handling in Phase 9i itself. `totals`/`byProvider`/`byTenant` are all-time; `trend` is windowed by
  `months` (same split as `getRevenue`'s `mrrCents` vs. `trend`). `byTenant` is the literal "every tenant, full
  overview" ask — sorted by volume descending, joined to `Tenant.name`.
- ✅ **`AdoptionAnalytics` gained `givingAdoption`** — distinct-tenant count with an active
  `TenantGivingProviderConfig`, same `ChannelAdoption` shape as `smsAdoption`/`emailAdoption` (no `channel` filter
  needed — giving-checkout has only the one implicit channel).
- ✅ **discuva-platform:** tenant detail panel gained a "Giving Provider" section (mirrors "Communication
  Providers" exactly — lazy-loaded on demand, never shows credentials); analytics page gained a "Giving Checkout"
  Section (currency-grouped totals, by-provider and by-tenant breakdowns) and a third `ChannelAdoption` bar in the
  existing "BYOK Adoption" panel.
- ✅ **Default module display label reconsidered, then kept as-is.** Briefly renamed `KNOWN_MODULES`'s `tithe` key's
  `moduleName` (and two discuva-admin nav/page labels) from "Tithe & Giving" to "Giving" over a concern that not
  every congregation uses "tithe" terminology — reverted after noting the `TITHE_READ`/`TITHE_WRITE` permission
  labels ("View Tithe & Giving Records" etc.) already say "Tithe," so a nav/module label saying something different
  for the same capability would be its own new inconsistency. A per-tenant override already exists
  (`church_module_settings.displayName`, discuva-admin's Module Settings page) for a church that wants different
  wording — that's the intended mechanism for this, not changing the platform default.
- ✅ **Verified live** — full backend suite, `tsc --noEmit`, and `nest build` clean; discuva-admin and
  discuva-platform both `tsc --noEmit` and `next build` clean.

### Phase 9k — Link an Existing Tenant as a Branch (Shipped, 2026-08)

Closes a real gap Phase 9/9b's invite flow couldn't cover: two churches that are **already** separate, fully-onboarded
tenants had no way to become parent/branch after the fact — the invite flow only works for a church that doesn't have
a tenant yet, since it's built around a signup-time token. Prompted by a direct question ("can a church connect to
another sub church after it has been onboarding?") — answer at the time was no, this phase is the fix.

- ✅ **`TenantBranchLinkRequest`** (new, `public` schema, `tenant_branch_link_requests`) — sibling control-plane table
  to `tenant_branch_invites`, keyed on `targetTenantId` instead of an email+token pair since the target tenant
  already exists to be looked up directly by subdomain. Status: `pending`/`accepted`/`declined`/`revoked`.
- ✅ **`BranchLinkRequestService`** (new) — `createLinkRequest(targetSubdomain, sponsorPlan?)` (parent-side),
  `listOutgoing()`/`listIncoming()` (both enriched with tenant names/subdomain, not raw entities),
  `revokeLinkRequest(id)` (parent-side), `acceptLinkRequest(id)`/`declineLinkRequest(id)` (**target-side only** — the
  parent cannot accept on the target's behalf, same "write intent first, mutate state only on confirmed action"
  discipline as everywhere else BYOK/checkout-shaped in this codebase). Wired onto the existing `BranchController`
  (`AdminGuard` + `BRANCH_READ`/`BRANCH_WRITE`, no new permission needed) under `/branch/link-requests/*`.
- ✅ **Sponsorship reused, not reinvented.** `sponsorPlan` on the request has the exact same semantics as
  `TenantBranchInvite.sponsorPlan` (Phase 9), just applied at accept time instead of signup time — if the parent
  currently has a paid plan, the target's *existing* `Subscription` row is switched onto it
  (`planId`/`status: ACTIVE`/`sponsoredByTenantId`); if the parent is on Free, sponsorship is silently skipped (not
  an error) rather than blocking the link itself. Unlink/leave (`unlinkBranch`/`leaveParent`,
  `revokeSponsorshipIfSponsoredBy`) already handle reversal correctly regardless of whether the branch was linked via
  invite or link request — neither method cares how `parentTenantId` got set.
- ✅ **Notification pattern reused from `SubscriptionLapseScheduler`.** Both flows need to email an admin in a tenant
  this service has no ambient CLS context for (the target on request creation, the parent on accept/decline) — reused
  `SubscriptionLapseScheduler.findAdminEmail`'s "oldest active `Admin`, ordered by `createdAt`" query shape, but
  through the shared `runInTenantContext` helper (Phase 9i's convention) rather than duplicating the inline
  `cls.runWith`/`SET LOCAL search_path` pattern a third time.
- ✅ **Confirmed, no change needed: a parent can have any number of branches.** `getOverview()`/`listOutgoing()` were
  already plain unbounded `WHERE parentTenantId = :self` queries — nothing in this codebase caps branch count.
- ✅ **Migration:** `1792368000000-AddTenantBranchLinkRequests.ts` — new table + two indexes
  (`parent_tenant_id`, `target_tenant_id`).
- ✅ **discuva-admin:** `/branch-hierarchy` gained "Link an Existing Church" (subdomain + sponsor-plan checkbox),
  "Sent Link Requests" (with revoke), and "Incoming Link Requests" (accept/decline) sections in `useBranch`/`page.tsx`.
- ✅ **Verified live** — full backend suite, `tsc --noEmit`, and `nest build` clean; discuva-admin `tsc --noEmit` and
  `next build` clean.

### Phase 9l — discuva-admin on a Fixed Host: JWT-Based Tenant Resolution (Shipped, 2026-08)

Surfaced while planning production DNS: discuva-admin and discuva-member both resolve the current tenant entirely
client-side from `window.location.hostname`, which only works when the hostname itself carries a tenant subdomain.
That's fine for discuva-member (a real per-tenant wildcard, `{tenant}.discuva.org`) but structurally impossible for
discuva-admin at a single shared production host (`admin.discuva.org`) — `extractSubdomain()` would return `null`
there every time (`admin` is a reserved word specifically so no tenant could collide with it), and
`TenantMiddleware` hard-404s the instant that happens, *before* any guard or controller runs — so even
`POST /auth/admin-login` itself was Host-header-dependent, not just routes past login.

- ✅ **`JwtPayload` gains optional `tenantId`/`schemaName`** (`src/auth/interface/auth.interface.ts`) — populated
  only for `SessionSurface.ADMIN` tokens, read from CLS (`AuthService.generateTokens()`) at sign time, where it's
  already correct regardless of how tenant was resolved for that request. Member tokens never carry this — member's
  Host-header flow is completely untouched.
- ✅ **`TenantMiddleware` fallback resolution**, only reached when Host-header resolution fails: (1) a verified JWT
  claim, checked against the `Authorization: Bearer` header then the `refresh_token` cookie (own secret,
  `REFRESH_JWT_SECRET`) — covers every authenticated request including a bare `/v1/auth/refresh` call; (2) an
  explicit `X-Tenant-Subdomain` header, sent only on the login request itself (no token exists yet) — untrusted the
  way the JWT claim is, but safe: a wrong value only ever fails login against the wrong schema, never grants access.
  `TenantModule` now independently registers `JwtModule`/`refreshJwtConfig` (same secrets `AuthModule` already
  uses) rather than importing `AuthModule` wholesale, avoiding a circular dependency for no benefit.
- ✅ **discuva-admin:** login form gained a required "Church Subdomain" field (remembered in `localStorage` for
  returning users), sent as `X-Tenant-Subdomain` on `POST /auth/admin-login` only. No other request needed a
  change — the existing `Authorization: Bearer` header on every authenticated call is exactly what
  `TenantMiddleware`'s new fallback needs; `getTenantApiBaseUrl()`'s existing subdomain-prepending logic is left
  in place (harmless no-op on a fixed host, still works for local dev against a real subdomain).
- ✅ **Verified live against the real dev database** (not just mocks) — self-signed JWTs matching the app's own
  `JWT_SECRET`, sent against a Host header resolving to nothing: a `tenantId`-carrying token correctly loaded that
  tenant's real admin profile (200, correct data); a wrong-secret or nonexistent-tenant token correctly 404'd; a
  valid token for one tenant plus a forged `X-Tenant-Subdomain` for another correctly used the JWT claim, ignoring
  the header entirely (proves the untrusted header can never override an authenticated session's real tenant).
  152 backend suites / 1799 tests, `tsc --noEmit`, `nest build`, and discuva-admin's `tsc --noEmit`/`eslint`/
  `next build`/full Jest suite (204 tests) all clean.
- ✅ **Production DNS simplified as a result** — `admin.discuva.org` no longer needs a wildcard (`*.admin.discuva.org`)
  the way an earlier draft of this deployment assumed; it's a single, plain host, same as `platform.discuva.org` and
  `api.discuva.org`. Only `*.discuva.org` (discuva-member) still needs wildcard DNS/TLS coverage. See
  `docs/TECH_DOC.md`'s "Domain map" for the corrected table.

### Phase 9l addendum — Branding Fetch, Email Links, and forgot/reset-password (Shipped, 2026-08)

Two follow-on gaps surfaced by direct questions after Phase 9l shipped, both stemming from the same root fact
(discuva-admin has no Host-header tenant of its own before login) but not covered by the JWT-claim fix, which only
applies once a token exists:

- ✅ **`TenantProvider` (discuva-admin) never attempts `GET /tenant/info` while unauthenticated.** It used to fire
  unconditionally on every mount — including the login and set-password screens — which always 404'd on the fixed
  host (no Host-header tenant, no JWT yet either) and left `tenant` silently `null`. Now gated on
  `tokenStore.get()?.accessToken`, and subscribed to `tokenStore`'s existing pub/sub so it re-fetches on login/a
  successful silent refresh and clears on logout, not just once on mount. **discuva-admin's login page was
  simplified to match** — no longer reads `useTenant()` at all; it's unconditionally generic (product name only, no
  church name/logo), rather than a dynamic value that was always going to resolve to the same fallback anyway.
- ✅ **`admin_login_url` fixed everywhere it's used, not just re-pointed.** `buildTenantUrl()` (subdomain-prepended
  host) is correct for `login_url` (discuva-member's real wildcard) but was *also* being used for `admin_login_url`
  in `EmailQueueService.resolveBrandingData()`/`resolveTenantUrl()` and
  `TenantProvisioningService.sendWelcomeEmail()` — producing a `{subdomain}.admin.discuva.org` link in every admin
  welcome email, session-security alert, and five other notification templates (incident reports, budget alerts,
  asset maintenance/warranty/vehicle-expiry reminders) that would never have resolved once the wildcard was
  dropped. New `buildAdminUrl()` (`src/tenant/utility/tenant-url.ts`) adds the subdomain as a `?subdomain=` query
  param instead of a host label, and replaces (rather than appends onto) the base path when one is given — the
  latter also fixed a pre-existing `/login/set-password` double-path bug in the old string-concatenation version of
  the welcome email link, unrelated to this phase but caught while rewriting it properly.
- ✅ **`POST /auth/forgot-password`/`reset-password` gained the same `X-Tenant-Subdomain` fallback as admin-login**
  — both are `@Public()`, not excluded from `TenantMiddleware`, and hit `PasswordResetOtp` (tenant-schema-scoped,
  same as `Member`/`Admin`), so both needed it for the exact same reason login did. discuva-admin's login-page
  "Forgot Password" modal now takes the church subdomain from the login form's own field (already in scope, no
  second prompt); the standalone `/set-password` page (reached from the welcome email, genuinely pre-auth, no
  login form in scope) gets its own field, pre-filled from the email link's new `?subdomain=` param — same pattern
  `email`/`otp` already used — falling back to the same `localStorage`-remembered value login uses if that param is
  ever missing.
- ✅ **Verified** — full backend suite (152 suites / 1803 tests, up from 1799 — 4 new: `buildAdminUrl` direct
  coverage plus the three call-site tests updated for the new URL shape), `tsc --noEmit`, `nest build`; discuva-admin
  `tsc --noEmit`, `eslint`, full Jest suite (204 tests), `next build` all clean.

### Phase 9m — Extend JWT-Based Tenant Resolution to discuva-member (Shipped, 2026-08)

Raised while evaluating hosting platforms whose per-app routing can't replicate a Caddy-style path-split on a
shared wildcard host: discuva-member's *own* hosting was never the problem (it's a real per-tenant wildcard,
`{tenant}.discuva.org`, and `TenantMiddleware` resolves that from the Host header exactly as before) — the problem
was that its *API calls* were tied to sharing that same wildcard host with the backend. Removing that coupling
means discuva-member's API traffic can move to the same dedicated `api.discuva.org` every other app already calls,
with no router in front of it splitting by path.

- ✅ **The `SessionSurface.ADMIN`-only gate on JWT tenant claims is removed.** `AuthService.generateTokens()`
  (`src/auth/service/auth.service.ts`) now embeds `tenantId`/`schemaName` on every token, member and admin alike —
  both were already correct in CLS at sign time, the gate was only ever there because admin was the sole
  fixed-host case at the time. `JwtPayload`'s doc comment (`src/auth/interface/auth.interface.ts`) updated to
  match.
- ✅ **`TenantMiddleware`'s Bearer-header fallback now tries both JWT secrets, not just the access one.**
  discuva-admin's refresh flow sends its refresh token via an httpOnly cookie; discuva-member's sends it via the
  `Authorization: Bearer` header instead (`RefreshJwtStrategy` already accepted both transports — this was an
  existing, unrelated design decision, not something added for this phase). A Bearer header can therefore
  legitimately carry either token type, each signed with a different secret, so
  `resolveTenantIdFromAuthorizationHeader` now verifies against the access secret first, then
  `jwtRefreshConfig.secret`, before giving up — needed specifically for a bare `POST /auth/refresh` call from
  discuva-member, which carries no Host-header subdomain and (being the refresh call itself) no cookie either.
- ✅ **discuva-member:** `utils/tenant/api-base-url.ts` — `getTenantApiBaseUrl()` (host-rewriting, prepended the
  subdomain onto `NEXT_PUBLIC_API_URL`'s hostname) replaced with `getCurrentTenantSubdomain()`, which just returns
  the subdomain string via the same unchanged `extractSubdomain()`. `utils/auth/axios-client.ts` — `baseURL` stays
  the bare `NEXT_PUBLIC_API_URL` from `axios.create()` for every request (no more per-request host rewrite); the
  request interceptor, `doRefresh()`, and `notifyLogoutBestEffort()` all now attach `X-Tenant-Subdomain` (when
  derivable) alongside the existing `Authorization: Bearer` header — belt-and-suspenders for `doRefresh()`
  specifically, since that call's own Bearer header is the refresh token the dual-secret fix above exists to
  handle. `app/manifest.ts`'s `fetchTenantBranding()` (a server-side, pre-auth call with no JWT available yet) —
  no more manual `{subdomain}.{host}` URL construction; calls the bare API host and sends the derived subdomain as
  `X-Tenant-Subdomain` instead, the same pre-auth fallback login already relies on. No other discuva-member file
  needed changes — everything else goes through the shared `api` axios client and inherits this transitively.
- ✅ **The giving-webhook callback URL tenants configure at Paystack/Flutterwave needed no change.**
  `GivingWebhookController` (`src/giving-checkout/controller/giving-webhook.controller.ts`) was already excluded
  from `TenantMiddleware` entirely and resolves tenant from a `:tenantId` path segment, not the Host header or any
  token — external payment providers can't send either. `buildGivingWebhookUrl()` (discuva-admin) already built
  off the bare `NEXT_PUBLIC_API_URL` with `tenantId` in the path.
- ✅ **Verified** — full backend suite (152 suites / 1804 tests, up from 1803 — 1 new: dual-secret Bearer-header
  fallback), `tsc --noEmit`, `eslint`, `nest build` all clean. discuva-member `tsc --noEmit`, `eslint`, `next
  build`, and full Jest suite (271 tests, 5 pre-existing failures in `parse-local-time.test.ts` unrelated to this
  change — timezone-offset-dependent assertions that don't hold outside UTC) all clean.

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

## 11. Multi-Branch Hierarchy & Cross-Tenant Reporting

> **Status:** Backend shipped 2026-08 (§9 Phase 9). Parent-side overview/invite-sending UI is the only piece still
> outstanding — everything below describes what was actually built, not a forward-looking plan.

Many churches plant or oversee branch churches, each with its own workers, finances, and membership, while the parent church wants an oversight view of what's happening across its branches.

### 11.1 Onboarding

A branch is onboarded the same way any tenant is (§4.8), plus a hierarchy link:

1. The parent church's admin sends a branch invite (email) — `POST /branch/invites`
   (`src/branch/controller/branch.controller.ts`). No dedicated hierarchy-management UI exists yet; the endpoint is
   ready for one.
2. The invited church goes through normal tenant provisioning (its own schema, its own admin) — `POST /signup` with
   the emailed invite code attached as `branchInviteToken`.
3. On acceptance, the new tenant's `public.tenants` row is stamped with the parent's tenant id.
4. Only after acceptance does any data begin syncing upstream — an unaccepted invite has no data visibility either direction.

```sql
ALTER TABLE public.tenants
  ADD COLUMN parent_tenant_id UUID NULL REFERENCES public.tenants(id) ON DELETE SET NULL;
```

Shipped exactly as designed here, plus two additions not originally scoped in this section:
- A `public.tenant_branch_invites` table (id, `parent_tenant_id`, email, opaque `token`, `status`, `expires_at`,
  `accepted_tenant_id`, `sponsor_plan`) — needed because the invited church has no tenant/schema of its own yet at
  invite-creation time, the very thing the invite exists to eventually create, so it can't live anywhere but `public`.
- **Plan sponsorship** (`sponsor_plan` on the invite, resolved to `Subscription.sponsoredByTenantId` at signup) —
  this section originally left "does a branch inherit the parent's plan?" unanswered. Resolved as: the parent
  chooses, per invite, via an optional `sponsorPlan` flag — not a platform-wide policy. `true` plus the parent
  currently being on a paid plan means the branch is provisioned directly onto that plan, no checkout, sponsored by
  the parent; anything else (flag omitted, or parent itself on Free) falls back to the normal independent Free-tier
  signup. See §9 Phase 3's billing section for how sponsorship interacts with cancellation and MRR.

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
- A webhook-push variant (branch tenant `POST`s its rollup to a platform endpoint instead of writing to a shared table) is an equally valid alternative if push semantics are preferred over a shared table — functionally equivalent. **Shipped with the shared-table variant** (`BranchRollupScheduler` + `BranchRollupService.computeAndUpsertOne`/`getOverview`, §9 Phase 9) — the push variant remains a documented alternative, not something built.

### 11.4 Known Tradeoffs

- **Eventually consistent, not live.** The parent's view is only as fresh as the last scheduled push. Acceptable — likely desirable — for a leadership rollup dashboard (member counts, attendance %, giving totals); would need rethinking if real-time expectations come up later.
- **Aggregates only, not raw records.** Recommended: sync computed rollups (counts, rates, totals), never raw per-member rows. Simpler, and a branch's individual congregant data probably shouldn't be visible to a parent church's admins by default.
- **Visibility is consent-gated, not automatic** (§9 Phase 9b, resolved — this bullet originally just flagged the concern speculatively). A branch's rollup is only visible to its parent if that branch's own admin has left `shareDataWithParent` on (default true) — and giving specifically is opt-in separately from everything else (default false), regardless of the main flag.
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

These rules apply specifically to AI coding agents (including Claude Code sessions) working in `discuva-api` on this migration:

- **Never introduce tenant-aware business logic.** If a service, controller, or entity needs to know about `tenantId`, `schemaName`, or `clusterId` directly, that's a sign the change belongs in the infrastructure layer (middleware/interceptor/CLS), not business logic. Push back on a request that would add this rather than implementing it as asked.
- **Never bypass the CLS-based tenant context** (§4.2) to "simplify" a one-off script or job — every DB-touching code path, including ad-hoc scripts, must go through the same per-request-transaction + `SET LOCAL search_path` mechanism (§4.4) as normal requests.
- **Never hardcode a schema name** anywhere outside `TenantProvisioningService` (§4.8) and the migration runner (§4.9), which are the only two places that legitimately iterate over schemas by name.
- **Plan-tier gating is a guard concern, not a service concern** — same discipline as `AdminPermission`. A `PlanFeature` check belongs on the controller via `@RequiresPlan` (§4.11), never inline in a service method. If a service needs to branch on the tenant's plan, that's a sign the gate is in the wrong layer.
- **Never store a tenant-provided third-party credential in plaintext.** `tenant_communication_provider_configs.credentials_encrypted` (§4.12) and anything like it must go through actual encryption at rest, never a bare column. This is someone else's secret, held on their behalf — treat it with the same seriousness as this codebase already treats its own JWT secrets and payment credentials.
- **Keep implementations at the complexity level the current stage (§12) actually needs.** Don't build Stage 2+ multi-cluster plumbing while the product is at Stage 1 — carry the cheap forward-compat fields (`cluster_id`, `tenantId`-keyed cache) but don't build the routing logic those fields will eventually need until a second cluster is real.
