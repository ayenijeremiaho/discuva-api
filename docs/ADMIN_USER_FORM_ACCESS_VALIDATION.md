# Admin permissions and form access: implementation checks

2026-11-14. API/admin branch: `feat/admin-user-form-access`. Feature default **off**. No push, merge, production-data reads or deployment performed. Phase 4 and Google Sheets remain separate.

## Implemented

- Separate role and individual permission sources, shared effective-permission resolver, service/recovery/notification checks, and bounded delegation authority.
- Tenant-local view/export form grants, audited upsert/revoke, safe results metadata, assigned-form listing and minimal paginated/searchable access pickers. Full builder and write routes remain globally gated.
- Admin Users individual permissions and assigned forms; the same grant panel under a form's submissions/results; results-only navigation, landing, responses and analytics. Export is server-authorised separately.
- Platform rollout mode 0/1/2; test mode uses `ADMIN_ACCESS_TEST_TENANTS` tenant UUIDs. Turning off ignores new grants while preserving roles, grant data and audits.
- Technical documentation, Postman contracts, contextual help/questions, and switch-filtered admin release note. No member-app release note.

## Automated checks

- Full API regression run: **378 suites / 5,242 tests passed**. Additional guard/DTO/recovery tests were added afterward and covered by focused checks; see final focused result below.
- Focused permission/form/recovery/validation regressions: **12 suites / 219 tests passed**, including existing form and admin services. Subsequent query-reuse/permission-preservation and role fast-path checks passed (8 suites / 81 tests); these overlap the earlier focused run.
- Admin suite: **105 suites passed / 620 tests passed**; one unchanged failure in `utils/__tests__/wording.test.ts` identifies five existing strings in `components/follow-up/card-fields-tab.tsx` and `components/follow-up/monthly-report.tsx`. Those files are unchanged by this feature. New results UI tests: **4 passed**, including view-only/export visibility, refresh revocation and denied-context behavior.
- API and admin production builds passed. API lint has no errors and retains one pre-existing unused-type warning in programme planning; admin changes have no lint errors.
- HTTP boundary tests use the real AdminGuard and form-access policy with synthetic repositories. Module/plan guards are overridden for isolation; their existing guard suites are part of the full regression run. All four HTTP boundary tests passed. They cover assigned A versus unassigned B, export opt-in/revocation, builder/options/templates/write/delegation denial and safe context/UUID validation.

## Database verification

Executed both new tenant migrations with PostgreSQL via PGlite against two synthetic schemas: one with an existing admin, one empty. Empty-default permissions preserved the existing row. Constraint checks rejected export without view (23514), duplicate assignments (23505) and a missing/foreign form (23503). A second schema saw no grants; migration rollback passed there.

EXPLAIN ANALYZE used **20,000 grants**, **1,000 admins/forms** and **50,000 submissions**. Scoped lookups and assigned lists used `IDX_form_admin_access_admin_form`; form-side lists used `UQ_form_admin_access_form_admin`. Recent results used `IDX_form_submissions_results_recent`; leaderboard order used `IDX_form_submissions_results_score`. The form-side list used an indexed bitmap scan plus a small sort, not a grant-table sequential scan. These are synthetic plan checks, not production performance guarantees.

Cost: the existing admin/role lookup reads one extra array. Role-authorised checks return immediately without reading the rollout setting. Cached rollout setting read, request-local mode memoisation, one indexed grant read for a scoped results request, and one profile EXISTS when enabled. Results context reuses the grant read to derive export authority. Paginated lists use data/count queries and SQL filtering, with no per-row permission query. Manager writes add bounded authority/subject checks and existing audit writes. Four new secondary/unique indexes support grants and result ordering, plus the new grant table's primary key. No scheduler, background synchronisation or polling. Existing whole-form CSV/analytics retain their on-demand submission reads.

## Browser review

Synthetic API browser checks passed at **320×640**, **390×844** and **1280×900**: no page overflow or browser errors. Checked individual permission editing, assigned forms and results-only responses, with builder navigation/export absent for the scoped viewer. Existing portal components and theme variables are reused. Screenshots: `/private/tmp/discuva-access-screens/` (`admin-access-*`, `assigned-forms-*`, `results-*`). These browser checks use mocked API data; they are not an approved-tenant production smoke test.

## Requested remote-script scan

Searched source/configuration across API, admin, member, platform, web and deploy. Inspected all four Next.js configs and all four PostCSS configs (Tailwind 4 uses PostCSS here; no root Tailwind config files were present). No injected download-and-execute code was found in those configs. Broader matches reviewed were Redis Lua evaluation, local-data/test script evaluation, local HTTP Docker health checks, base64 data/auth handling, documentation and Bible-data generation scripts. The latter download text/ZIP data and invoke local `unzip` with argument arrays; they do not execute downloaded scripts.

Scope: current local source checkouts, excluding dependencies, generated build output, environment secrets and Git internals. This is not an audit of deployed containers, dependency supply chains or Git history. No suspicious code was executed.

## Release gates

- Review these feature branches and the known admin baseline failure.
- Index creation scans existing submissions and can block writes during migration; account for this in the approved release window.
- Deploy API migrations/code before the UI, switch off; no migration reversions on production rollback.
- Enable only an explicitly approved test organisation, verify live API/UI with limited/global accounts and revoke access, then approve broader activation separately.
- Phase 4 compatibility remains a later local integration check; this feature does not import unreleased Phase 4 code.
