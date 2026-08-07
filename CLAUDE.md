# Discuva — Standing Rules

## Definition of Done (MANDATORY — every task)

Every code change is **not complete** until all three are done:

1. **Code** — implementation + tests pass (`npm test`)
2. **Tech doc** — `docs/TECH_DOC.md` updated for any API, entity, env var, or behaviour change
3. **Postman** — `docs/postman_collection.json` updated for any endpoint change (new route, removed param, added query param, changed method)

Do not report a task as done without completing all three. Use `/sync-docs` if unsure what needs updating.

---

## Project Context
NestJS church management backend. Stack: PostgreSQL · TypeORM · Redis (ioredis) · Bull queue · Argon2 · JWT. Church-specific values (name, address, logo, currency, timezone) are driven by environment variables — configurable for any congregation.

## Church-Agnostic Rule
- Never hardcode a specific church name, address, or branding in source code, comments, docs, email templates, or generated descriptions.
- Use env var references (`CHURCH_NAME`, `CHURCH_ADDRESS`, `LOGO_URL`) or generic language ("your church", "the congregation") everywhere.
- Default values in `env.validation.ts` may reference a real church as a convenience default — that is the only permitted location.

## Migration Rules (CRITICAL)
- **Never edit an existing migration file.** Once a migration has been committed or run, it is immutable history.
- All schema changes (new table, new column, new index, seed data) require a **new file** with a fresh timestamp.
- File format: `src/migrations/{13-digit-unix-ms}-{PascalCaseName}.ts`
- Class name format: `{PascalCaseName}{13-digit-unix-ms}` — timestamp at the END, matching TypeORM CLI output.
- **Never use 14-digit date strings** (e.g. `20260614120000`) as timestamps. TypeORM extracts the timestamp via `substr(-13)`; a 14-digit suffix produces a truncated, out-of-order value that breaks migration execution order.
- Use `/new-migration` to scaffold a new migration correctly.

## Redis / Cache Conventions
- `cacheService.get()` — always `await` (need the value)
- `cacheService.set()` — fire-and-forget after DB read; no `await` needed
- `cacheService.del()` — fire-and-forget after mutations; no `await` needed
- Rate-limit `get()` calls that gate request flow must be `await`-ed

## Test Mock Pattern
All `CacheService` methods are async. In specs use:
```typescript
const mockCacheService = {
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
  key: jest.fn().mockReturnValue('cache-key'),
};
```
Per-test overrides: `mockCacheService.get.mockResolvedValue(value)` (not `mockReturnValue`).

## Guard / Auth Patterns
- Admin-only routes: `@UseGuards(AdminGuard)` + `@RequiresPermission(AdminPermission.X)`
- Worker-only routes: `@UseGuards(RolesGuard)` + `@Roles(MemberRoleEnum.WORKER)`
- Member + Worker routes: `@UseGuards(JwtAuthGuard)`
- Never use `@Roles(MemberRoleEnum.ADMIN)` — there is no ADMIN role; admin access is via the `Admin` entity.

## Entity Conventions
- All entities extend `BaseEntity` from `../../utility/entity/base.entity` (provides `createdAt`, `updatedAt`).
- UUIDs: `@PrimaryGeneratedColumn('uuid')` only on root entities.
- Enums stored as `character varying`, never native PG enum type.
- Nullable FKs use `{nullable: true, onDelete: 'SET NULL'}`.
- Non-nullable FKs use `{nullable: false, onDelete: 'CASCADE'}` or `'RESTRICT'` depending on intent.

## Pagination Policy
- **Apply pagination** to lists that grow unboundedly: members, workers, attendance, audit logs.
- **No pagination** on reference data controlled by admins: departments, venues, event configs. Return the full list.
- Workers-by-department remains paginated (can be large).

## Member Deletion Policy
- Member deletion is **not exposed** anywhere in the API. The `PATCH /:id/status` endpoint is the only way to deactivate a member (`INACTIVE`).
- Never add a `DELETE /members/:id` endpoint.

## Code Style
- No comments unless the WHY is non-obvious (hidden constraint, workaround, subtle invariant).
- No trailing `// end of X` or block comments describing WHAT the code does.
- No `async/await` on fire-and-forget calls — just call without `await`.

## API Versioning
All routes are prefixed with `/v1/` via NestJS URI versioning (`defaultVersion: '1'`).
