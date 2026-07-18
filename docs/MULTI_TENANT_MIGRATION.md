# Multi-Tenant Migration Plan

> **Status:** Deferred — to be executed once the open-source single-tenant version is fully stable and feature-complete.

---

## 1. Business Model & Repo Strategy

The product operates on two tiers:

| Tier | Repo | Audience | Hosting |
|---|---|---|---|
| **Open Source** | `discovery-hub` (public) | Churches that self-host | Church's own infrastructure |
| **SaaS** | `discovery-hub-cloud` (private) | Churches that pay for managed hosting | Platform-operated |

The SaaS version is a private fork of the open-source repo. It starts with an identical codebase and adds a multi-tenancy infrastructure layer and proprietary platform management features on top.

The same pattern applies to the frontends:

| Tier | Repo |
|---|---|
| Open Source Admin | `Faithapp-admin` (public) |
| SaaS Admin | `Faithapp-admin-cloud` (private fork) |
| Platform Dashboard | `discovery-hub-platform` (private, new) |

---

## 2. Upstream Sync Discipline

```
discovery-hub  ──────────────►  discovery-hub-cloud
   (upstream, open source)          (downstream, SaaS)
```

- Bug fixes, security patches, and core feature improvements always land in `discovery-hub` first.
- A sync PR is raised from `discovery-hub` into `discovery-hub-cloud` on a regular cadence (recommended: every sprint or every release tag).
- Proprietary SaaS features (billing, tenant management, platform admin) **never** flow back upstream.
- The same upstream → downstream rule applies to `Faithapp-admin` → `Faithapp-admin-cloud`.

---

## 3. Architecture Decision: Schema-Per-Tenant

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

## 4. How Tenant Resolution Works

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

## 5. Backend Migration (`discovery-hub-cloud`)

All changes are **additive**. No existing entity, service, controller, or guard needs to be modified. The multi-tenant layer sits underneath the existing business logic.

### 5.1 Public Schema — Tenant Registry

Create a migration that adds the following to the `public` schema (outside any tenant schema):

```sql
CREATE TABLE public.tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subdomain   VARCHAR NOT NULL UNIQUE,        -- 'church-alpha'
  schema_name VARCHAR NOT NULL UNIQUE,        -- 'church_alpha'
  cluster_id  VARCHAR NOT NULL DEFAULT 'default', -- see §13; every tenant points at 'default' until multi-cluster is real
  name        VARCHAR NOT NULL,               -- display name
  logo_url    VARCHAR,
  currency    VARCHAR NOT NULL DEFAULT 'USD',
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

### 5.2 CLS — Tenant Context Propagation

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
  clusterId: string; // 'default' until multi-cluster (§13) is real — carried from day one so nothing needs retrofitting later
}
```

### 5.3 Tenant Middleware

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

### 5.4 Schema Switching — search_path Per Request

After the tenant middleware resolves the schema, a TypeORM subscriber or interceptor sets PostgreSQL's `search_path` on the connection for the duration of the request:

```typescript
await dataSource.query(`SET search_path TO ${schemaName}, public`);
```

`search_path` is session-scoped on the PostgreSQL connection. All TypeORM queries on that connection — including joins and subqueries — automatically resolve to the correct schema. No changes to any repository or service.

**Connection pool consideration:** `SET search_path` applies to the connection, not the transaction. Use a per-request interceptor that sets it immediately after acquiring a connection and before any query runs.

**Considered and deliberately rejected: a "Repository Resolver" abstraction layer.** An alternative design wraps every TypeORM repository behind a tenant-aware resolver, so business services request a repository through infrastructure rather than TypeORM resolving the schema implicitly via `search_path`. This was considered and set aside — `search_path` already gives business logic zero awareness of tenancy (the stated goal), so a resolver layer on top would add a real abstraction for a problem that's already solved, contradicting the "no infrastructure overhead beyond what's needed" reasoning behind choosing schema-per-tenant in the first place (§3). Revisit only if a concrete case emerges where `search_path` genuinely can't express what's needed (e.g. a single request legitimately needing two tenants' data at once).

### 5.5 Redis Key Namespacing

Prefix all cache keys with the tenant's **id**, not its schema name, so tenant A's cache never collides with tenant B's:

```
tenant:{tenantId}:...
```

`tenantId` rather than `schemaName` is the deliberate choice — schema name is stable today, but §13's Stage 3 ("tenant relocation") means a tenant could in principle move to a different schema/cluster later, while `tenantId` never changes. Keying cache on the identifier that's guaranteed permanent avoids a future cache-invalidation headache.

Modify `CacheService.key()`:

```typescript
key(suffix: string): string {
  const tenantId = this.cls.get('tenantId') ?? 'global';
  return `tenant:${tenantId}:${suffix}`;
}
```

No other changes needed — all existing `cacheService.get/set/del` calls go through `key()` already.

### 5.6 Bull Queues — Tenant Propagation

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

### 5.7 New Endpoint: GET /tenant/info

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

### 5.8 Tenant Provisioning Script

A script (run once per new church) that:

1. Creates a new PostgreSQL schema: `CREATE SCHEMA church_beta`
2. Runs all existing TypeORM migrations against that schema: `SET search_path TO church_beta`
3. Seeds the default SuperAdmin for that tenant via `DefaultAdminSeed`
4. Inserts a row into `public.tenants`

```bash
npm run provision:tenant -- --subdomain=church-beta --name="Beta Church" --admin-email=admin@betachurch.org
```

**Provisioning must be idempotent.** Insert the `public.tenants` row first with status `PROVISIONING` (not `is_active = true`), then run steps 1–3, then flip to active only on full success. Re-running the script for a tenant already mid-provisioning must detect existing state at each step (schema already created, migrations already applied) and skip forward rather than erroring or double-creating — a crash partway through (e.g. schema created but migrations not yet run) is a real failure mode, not an edge case, and must be safely resumable by just running the script again.

### 5.9 Migration Runner — All Tenants

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

### 5.10 Platform Admin Module

A new NestJS module at `src/platform-admin/`. Its guards check for a `platform_admin` JWT claim. All its services operate directly on `public.tenants` and `public.platform_admins` — they never touch tenant schemas.

Capabilities:
- `GET /platform/tenants` — list all tenants with health stats
- `POST /platform/tenants` — provision a new tenant (triggers provisioning script)
- `PATCH /platform/tenants/:id` — update tenant config (name, logo, currency, timezone)
- `PATCH /platform/tenants/:id/suspend` — suspend a tenant
- `POST /platform/auth/login` — platform admin login (separate JWT, separate secret)
- `POST /platform/tenants/:id/impersonate` — issue a scoped token to support a tenant

---

## 6. Frontend Migration (`Faithapp-admin-cloud`)

### 6.1 Dynamic Tenant Branding

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

### 6.2 Cookie Scoping

Auth cookies must be scoped to the subdomain so a session on `church-alpha.yourdomain.com` cannot be read by `church-beta.yourdomain.com`.

The backend sets the cookie `Domain` attribute to the specific subdomain (not the root domain) at login time.

### 6.3 What Does Not Change

- All page components, hooks, and API calls — unchanged
- All permission guards and role checks — unchanged
- All forms, tables, and panels — unchanged

---

## 7. PWA Migration

No changes needed beyond what the admin portal requires. The PWA runs in a browser, the subdomain is present on every fetch, and the Web App Manifest `start_url` already contains the correct subdomain at install time.

If a member navigates to `app.church-alpha.yourdomain.com`, they are automatically in church Alpha's tenant. No church code, no custom header, no additional configuration.

---

## 8. Platform SuperAdmin Dashboard (`discovery-hub-platform`)

A separate Next.js application deployed at `platform.yourdomain.com`. Completely isolated from `Faithapp-admin`. Platform admins authenticate against `public.platform_admins`, not against any tenant schema.

### Features

| Section | Capability |
|---|---|
| Tenants | List, search, view health stats (last login, member count, event count) |
| Provisioning | Wizard to create a new tenant (sets up schema, runs migrations, seeds admin) |
| Tenant detail | Edit name, logo, currency, timezone; suspend/reactivate |
| Impersonation | Issue a scoped support token to log into a church's admin portal |
| Migrations | View migration status per tenant; trigger migration runs |
| Platform admins | Manage platform operator accounts |
| Metrics | Cross-tenant aggregate stats (total churches, total members, etc.) |

### Auth

Separate JWT secret from tenant JWTs. Platform admin tokens carry `{ role: "platform_admin" }` and are validated by a dedicated `PlatformAdminGuard` that is never used on tenant routes.

---

## 9. Existing Client Migration

The current single-tenant deployment's data becomes tenant 1 in the SaaS system.

1. Create schema `church_original` in the SaaS database
2. Dump the existing single-tenant database and restore into `church_original` schema
3. Insert a row into `public.tenants` for this church
4. Point the church's subdomain at the SaaS deployment
5. Verify all data is intact and auth works
6. Decommission the old single-tenant deployment

---

## 10. Build Order

These phases are sequential. Each phase is a prerequisite for the next.

### Phase 1 — Tenant Infrastructure (Backend)
- Fork `discovery-hub` → `discovery-hub-cloud`
- Add `public.tenants` and `public.platform_admins` tables
- Install and configure `nestjs-cls`
- Build tenant middleware (subdomain → schema resolution)
- Implement `SET search_path` per request
- Add `GET /tenant/info` endpoint
- Write integration tests for schema isolation

### Phase 2 — Cache & Queue Namespacing (Backend)
- Add tenant prefix to all Redis cache keys via `CacheService.key()`
- Add `tenantId`/`schemaName` to all Bull job payloads
- Restore CLS context in all Bull processors

### Phase 3 — Provisioning & Migration Tooling (Backend)
- Build `provision:tenant` script
- Build `migration:run:all-tenants` script
- Test provisioning a new tenant end-to-end

### Phase 4 — Platform Admin Module (Backend)
- `src/platform-admin/` module with its own auth
- Tenant CRUD, suspend, impersonation endpoints
- Platform admin JWT with separate secret

### Phase 5 — Admin Frontend (`Faithapp-admin-cloud`)
- Fork `Faithapp-admin` → `Faithapp-admin-cloud`
- Build `TenantContext` with `GET /tenant/info` fetch on mount
- Replace all build-time env var branding reads with context reads
- Scope auth cookies to subdomain

### Phase 6 — Platform Dashboard (`discovery-hub-platform`)
- New Next.js app
- Tenant list, provisioning wizard, health stats
- Platform admin auth flow
- Impersonation flow

### Phase 7 — Existing Client Migration
- Migrate existing church's data into tenant schema
- Validate and cut over
- Decommission old deployment

### Phase 8 — Multi-Branch Hierarchy (Future, Post-Cutover)
- Add `parent_tenant_id` to `public.tenants`
- Add `public.tenant_rollups` control-plane table
- Build per-tenant rollup cron job (Bull)
- Build parent-side hierarchy/overview UI in the platform dashboard or admin portal
- See §12 for the full design

---

## 11. What Does Not Change

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

## 12. Multi-Branch Hierarchy & Cross-Tenant Reporting (Future, Post-Cutover)

> **Status:** Scoped only, not started. Depends on Phases 1–7 above — a branch is a tenant, so this cannot exist before tenancy does.

Many churches plant or oversee branch churches, each with its own workers, finances, and membership, while the parent church wants an oversight view of what's happening across its branches.

### 12.1 Onboarding

A branch is onboarded the same way any tenant is (§5.8), plus a hierarchy link:

1. The parent church's admin sends a branch invite (email) from a hierarchy-management view.
2. The invited church goes through normal tenant provisioning (its own schema, its own admin).
3. On acceptance, the new tenant's `public.tenants` row is stamped with the parent's tenant id.
4. Only after acceptance does any data begin syncing upstream — an unaccepted invite has no data visibility either direction.

```sql
ALTER TABLE public.tenants
  ADD COLUMN parent_tenant_id UUID NULL REFERENCES public.tenants(id) ON DELETE SET NULL;
```

Self-referencing and nullable so a flat parent → branch model costs nothing to represent today even though only one level is used initially. A multi-level hierarchy (branch-of-a-branch) is possible later with zero schema change.

### 12.2 Why Not Direct Cross-Schema Reads

The naive design — a scheduled job that does `SET search_path TO church_branch_x` and reads the branch's tables directly to build the parent's overview — was considered and rejected. It silently assumes every tenant lives in the same PostgreSQL instance. The moment tenants are sharded across multiple database instances (a real possibility at scale — see §3), a connection to shard 1 has zero physical visibility into shard 2. Direct cross-schema SQL reads become simply impossible, not just slow. Any design for this feature has to be shard-safe from the start rather than retrofitted later.

### 12.3 Agreed Design: Local Compute, Pushed Rollups

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

- A scheduled Bull cron job runs inside each tenant's own request/job context (already has `tenantId`/`schemaName` in CLS per §5.6), computes its own aggregates against its own shard, and **upserts its own row only** — `tenant_id = self`.
- The parent's dashboard reads only from `public.tenant_rollups WHERE tenant_id IN (SELECT id FROM public.tenants WHERE parent_tenant_id = :parentId)`. It never reaches into a branch's schema or shard directly — there is no cross-tenant read path to get wrong, because there is no cross-tenant read at all.
- A webhook-push variant (branch tenant `POST`s its rollup to a platform endpoint instead of writing to a shared table) is an equally valid alternative if push semantics are preferred over a shared table — functionally equivalent, pick whichever fits the deployment topology better when this is built.

### 12.4 Known Tradeoffs

- **Eventually consistent, not live.** The parent's view is only as fresh as the last scheduled push. Acceptable — likely desirable — for a leadership rollup dashboard (member counts, attendance %, giving totals); would need rethinking if real-time expectations come up later.
- **Aggregates only, not raw records.** Recommended: sync computed rollups (counts, rates, totals), never raw per-member rows. Simpler, and a branch's individual congregant data probably shouldn't be visible to a parent church's admins by default.
- **Flat vs. multi-level hierarchy.** `parent_tenant_id` supports both; only flat parent→branch is planned for the first build.

---

## 13. Scaling Roadmap (Multi-Cluster Future)

> **Status:** Reference only — names the trigger points for when multi-cluster work becomes necessary. Nothing here is built until a stage's numbers are actually approached.

Every tenant carries a `cluster_id` from day one (§5.1, defaulted to `'default'`), even though only one cluster exists at Stage 1. This costs nothing now and avoids a backfill migration later — every tenant row would otherwise need editing the day a second cluster is introduced.

| Stage | Scale | Infrastructure | What changes |
|---|---|---|---|
| **1** | ~100 churches | 1 PostgreSQL cluster | Current target. Everything in §5 as written. |
| **2** | ~5,000 churches | Multiple PostgreSQL clusters | New tenants provisioned onto whichever cluster has headroom; `cluster_id` starts varying. Tenant Resolver (§4/§8) reads `cluster_id` to pick the connection pool before setting `search_path`. |
| **3** | ~20,000 churches | Tenant relocation, read replicas | A tenant's schema can be dumped/restored onto a different cluster and `cluster_id` updated — the reason cache keys are `tenantId`-based (§5.5) and not `schemaName`-based. Read replicas take reporting/rollup queries (§12) off the primary. |
| **4** | 50,000+ churches | Dedicated clusters for outlier tenants | An exceptionally large single tenant can get a dedicated cluster without any business-logic change — same schema-per-tenant model, just one tenant per cluster instead of many. |

**What does not change across any stage:** business services never read `cluster_id` directly — only the Tenant Resolver (§8) and the connection-acquisition step do. This is the same discipline as §5.4's `search_path` rule, extended to cluster selection.

**Explicitly out of scope for this document** (real gaps, but separate feature areas — not tenancy-migration concerns):
- **Billing / subscriptions** (`plans`, `subscriptions` tables, payment provider integration, invoicing). Needed before Discovery Hub Cloud can actually charge anyone, but it's a payments-and-billing feature, not part of how tenancy itself works — track it as its own initiative when SaaS launch gets closer.
- **Custom domain support** (`tenant_domains` — letting a church map `giving.theirchurch.org` to their tenant instead of only `their-church.yourdomain.com`). Subdomain routing (§4) is sufficient for launch; custom domains add DNS verification and TLS provisioning complexity that isn't justified until a customer actually asks for it.

---

## 14. AI Contributor Guidelines

These rules apply specifically to AI coding agents (including Claude Code sessions) working in `discovery-hub-cloud` or advising on this migration:

- **Never introduce tenant-aware business logic.** If a service, controller, or entity needs to know about `tenantId`, `schemaName`, or `clusterId` directly, that's a sign the change belongs in the infrastructure layer (middleware/interceptor/CLS), not business logic. Push back on a request that would add this rather than implementing it as asked.
- **Never bypass the CLS-based tenant context** (§5.2) to "simplify" a one-off script or job — every DB-touching code path, including ad-hoc scripts, must go through the same `search_path`-setting mechanism as normal requests.
- **Never hardcode a schema name** anywhere outside the provisioning script (§5.8) and migration runner (§5.9), which are the only two places that legitimately iterate over schemas by name.
- **Never duplicate an OSS business feature inside the Cloud fork.** If a feature isn't tenancy/billing/platform-admin infrastructure, it belongs in `discovery-hub` (open-source) first, then flows downstream per §2 — not built directly in `discovery-hub-cloud`.
- **Keep implementations at the complexity level the current stage (§13) actually needs.** Don't build Stage 2+ multi-cluster plumbing while the product is at Stage 1 — carry the cheap forward-compat fields (`cluster_id`, `tenantId`-keyed cache) but don't build the routing logic those fields will eventually need until a second cluster is real.
