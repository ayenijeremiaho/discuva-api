# Implementation plan: individual admin permissions and assigned forms

Date: 2026-11-14. Based on ADMIN_USER_FORM_ACCESS_DESIGN.md. Implementation is now on `feat/admin-user-form-access` in API/admin, default off; see ADMIN_USER_FORM_ACCESS_VALIDATION.md for checks and release gates. Build separately from Phase 4 and the parked Google Sheets proposal.

## 1. Agreed scope and access rules

- Admin portal only. Keep one existing assigned role per admin; add direct permission grants. Departments and member-app capabilities are unaffected.
- Effective global permissions = deduplicated role permissions + direct grants. No deny overrides. Keep both sources in storage and show their provenance; never write a computed union back into a role.
- A separate form grant supplies View results and optionally Export results. Export requires View. Revoke removes the grant. It does not supply global FORMS_READ, editing, submission creation, templates, attachments upload, publishing, deleting or delegation rights.
- Preserve legacy FORMS_READ behavior, including current all-form results/analytics/CSV access. A scoped grant cannot narrow a broader role/direct global permission. Explain this in the UI.
- First release assigns forms to existing active admin accounts. Support a role with no global permissions for assigned-only users. External guest accounts, multiple roles, department inheritance, Google sync and automatic idle-page push updates are outside scope.
- Result views use current paginated reads on open/refresh. Preserve existing anonymous/public response identity rules, quiz/vote protections and attachment access. Do not return quiz answer keys or full editable form definitions to results-only users.

## 2. Delivery order and completion gates

| Step | Work | Complete when |
| --- | --- | --- |
| 1. Baseline and policy inventory | Start API/admin feature branches from current production master. Inventory role checks, auth/profile DTOs, service policies, notification recipient queries and all form routes. Record baseline failures separately. | Written access matrix and existing behavior tests; feature switch defaults off. No dependency on unreleased Phase 4 files. |
| 2. Schema and indexes | Add a new tenant migration, entities and validated DTOs. Add empty-default direct grants and the form-admin grant table. | Existing admins retain access; migration works on clean and existing synthetic tenant schemas; constraints reject invalid grants. |
| 3. Central global resolver | Resolve role + individual grants once per request where practical; update AdminGuard, profile response, service checks and batch recipient selection. | Additional grants work across UI/API/services, revocation applies next request, and stored roles are unchanged. |
| 4. Permission administration API | Extend admin create/update DTOs; add shared form-grant read/upsert/revoke service and audited endpoints. | Authority, self-edit, owner protection and cross-tenant tests pass before UI integration. |
| 5. Form resource enforcement | Add action-aware result policies, assigned-form listing and a safe results-context DTO. Protect results, analytics, export and indirect reads. | Complete allow/deny matrix passes, including guessed URLs, hidden metadata and view-without-export. |
| 6. Admin UI | Add permission provenance/direct grants, assigned forms, Form → Access and a results-only experience. Update sidebar, route gate and sign-in landing behavior. | A minimal-role user can sign in and use only assigned forms; broader global access is clearly explained. Phone/desktop checks pass. |
| 7. Regression, query plans and documentation | Run full API/admin suites, both builds, SQL plan checks and browser flows. Update technical docs, Postman, admin help and release notes. | No new failures; query budgets and indexes verified; no admin-only member-app release note. |
| 8. Controlled rollout | Deploy additive migrations and code with switch off; test one approved organisation; release more broadly only after approval. | Legacy access verified off, grants verified on, rollback tested, audits reviewed. |

Each step's enforcement tests must pass before the next user-facing step. Do not release a UI that promises scope restrictions before all server routes enforce them.

## 3. Database changes and efficiency

Tenant migration, with a new timestamp; never edit historical migrations:

- `admins.additional_permissions`: text array, NOT NULL, default empty. Validate enum values, uniqueness and request size in DTO/service validation. Do not silently discard direct grants when they overlap role permissions; a role change must not rewrite a user's explicit grant history.
- `form_admin_access`: UUID primary key, form/admin foreign keys, view/export flags and standard timestamps. CHECK prevents export without view. Deleting a form/admin removes its grants; inactive admins remain denied regardless of stored grants.
- UNIQUE `(form_id, admin_id)` serves target checks and form-side access lists. Index `(admin_id, form_id)` serves user-side access lists, assigned-form filtering and admin deletion. Avoid redundant indexes already covered by these keys.

Reuse the existing indexed admin/member lookup and role join for global permission checks; selecting an extra array adds no per-permission query. No GIN index is needed for those key-based reads. Global permission checks must not join form grants unnecessarily.

Compute `hasAssignedForms` at profile/bootstrap using indexed EXISTS, not by loading every assigned ID. Use filtered SQL EXISTS/joins for paginated forms, search, totals and access panels, avoiding per-row checks and unbounded ID arrays. Access-panel user/form lookups return minimal fields and paginate growing lists.

For background recipients, batch-select the effective global permission using role/direct grants with active-admin filtering. Do not query once per admin. Request-local memoisation is acceptable; avoid a cross-request permission cache initially so revocations have no TTL delay. Measure actual PostgreSQL plans with the migration and synthetic data before adding further indexes. No polling, scheduler or recurring database work is introduced.

## 4. Backend policy and API work

### Global resolver and grant authority

Introduce a focused AdminAccessService (final naming may follow repository conventions). Keep its dependencies independent of FormsModule; a grant repository/entity can be registered where needed without making AdminModule and FormsModule import each other.

Authorise from effective permissions, while preserving active-account, owner-only, last-owner and self-edit restrictions. Owner status stays a separate flag/workflow, never an ordinary permission. Only access managers with ADMIN_WRITE can administer grants. Non-owner managers cannot grant a role/direct permission beyond their own effective authority; apply that boundary to relevant existing role-change paths too, so editing a shared role cannot bypass it. Owners still use the existing protected owner workflows.

Form sharing additionally requires global FORMS_READ, so a results-only recipient cannot delegate access they were given. The actor must be authorised for the target tenant and allowed to manage the subject admin. Never trust a submitted tenant/actor ID. Use one transactional grant service for both UI entry points; validate and audit before/after values. Stale client state cannot make a revoked grant succeed.

Migrate current direct `adminRole.permissions` checks, including:

- AdminGuard and admin/profile DTO generation;
- account recovery/delegation authority checks;
- programme planning/session access and service-rating moderation;
- announcement SMS checks, notification-centre visibility and tithe/service operations;
- form-submission admin notifications, incident-report recipients, asset reminders and finance budget alerts.

A scoped results grant does not automatically subscribe someone to submission emails. Preserve existing recipient behavior, while direct global grants are treated consistently with equivalent role permissions.

### Proposed contract

All routes retain existing tenant, module and plan enforcement. Register static routes before `:id`.

| Route | Purpose / policy |
| --- | --- |
| Existing POST/PATCH `/admin/users` | Accept validated additionalPermissions; existing admin-management authority and protections |
| Existing GET `/admin/users/me` and managed-user DTOs | Expose role permissions, direct grants and computed effectivePermissions separately; bootstrap includes hasAssignedForms |
| GET `/forms/access/admin/:adminId` | Access manager sees the subject's paginated form grants |
| GET `/forms/:id/access` | Access manager sees the selected form's paginated grants |
| PUT `/forms/:id/access/:adminId` | Transactional upsert of view/export choices through the shared policy/service |
| DELETE `/forms/:id/access/:adminId` | Revoke; never delete the form or responses |
| GET `/forms/shared` | Active admin; return only explicitly assigned forms, with filtered count/search; no form blueprint |
| GET `/forms/:id/results-context` | Global FORMS_READ OR target form view grant; return only the minimum safe labels/metadata for results |
| Existing results/analytics/CSV routes | Replace the global-only gate with action-specific checks: global permission OR the appropriate target grant |

Keep existing form-builder GET/PATCH, create/clone/delete, templates, options for embedding, audience-group lookup and upload routes globally protected. If any lookup is reused in the results-only UI, provide a separately scoped/minimal response instead of weakening its global guard. Do not reuse a full getById entity response that includes configuration or answer keys. Return a consistent non-disclosing response for inaccessible IDs.

The exact endpoint names and response shapes must be documented and tested before the UI consumes them.

## 5. Admin UI work

Reuse the existing permission catalogue/groups and admin editor in `app/admin-management/page.tsx` and `hooks/use-admin-management.ts`. Show role-derived and additional grants separately, with source badges and a combined access summary. Removing a direct grant explains when role access still remains.

Add Assigned forms to the admin editor and an Access panel to Forms. Both use the same APIs. Default to view-only; export is a deliberate additional choice. Warn visibly when the target already has all-form global access: selecting one form does not restrict it.

Provide `/forms/shared` (or an equivalently explicit results-only route) for assigned-only users. Keep builder routes protected. Update AuthContext, `loadAdminMe`, sidebar routing, `withAuth`/route gates and `getFirstAccessibleRoute`: do not add a fake FORMS_READ permission just to make navigation work. Refresh the profile after permission edits and recover gracefully from 403/revocation without introducing polling. Use effectivePermissions with a role-permission fallback while API/admin versions roll out in sequence.

Result views reuse the response table, pagination and analytics components where safe, with no builder controls or exports unless allowed. Browser checks cover empty, loading, error, view-only and export-enabled states at 320px, 390px and 1280px, using portal theme variables.

Phase 4 integration is a later local merge/check: preserve its overseer/closed-branch read-only constraints without importing its unreleased helpers into this production-based feature branch.

## 6. Required access matrix

- Unchanged role with no additions: same global access with feature on/off.
- Role plus direct grant: union works in HTTP, services, profile/navigation and batch recipients.
- Same permission from role and direct grant: removing the direct grant leaves role access.
- Active minimal-role admin assigned Form A, view only: sees A's current permitted results/context/analytics; cannot export A, access B, edit A, add responses or share access.
- Same user with export enabled: A export succeeds; B export remains denied.
- User with global FORMS_READ plus an A grant: legacy all-form read/export remains; UI explains breadth.
- Inactive/revoked admin, wrong tenant, changed IDs, disabled module or insufficient plan: denied consistently.
- Revoked form/direct grant: next request denied; stale sidebar/page cannot bypass the server.
- Access manager: cannot self-escalate, alter owner status, bypass last-owner safeguards or delegate beyond authority.
- Quiz/vote/public responses: no new identity, answer-key or attachment disclosure through results context, analytics, CSV or counts.
- List/search/options/metadata: no unassigned records, counts or configuration leak.
- Feature off: legacy role behavior remains; new grant editing/routes are unavailable and grant-derived access is ignored.
- Across the codebase, search for injected code that downloads and executes remote scripts, with particular attention to production Next.js and Tailwind configurations. Review any matches and record findings before release.

## 7. Release and rollback

Add a platform-controlled 0/1/2 rollout setting (off / designated test organisations / all), with a dedicated test allow-list rather than reusing unrelated sign-in settings. No pricing/plan changes. Deploy API migrations/code before the admin UI, default off. Use synthetic accounts/forms for a local end-to-end run; production testing uses only an explicitly approved test organisation.

Record test/build results, reviewed query plans, screenshots, TECH_DOC, Postman, help/FAQ and admin release notes. Commit on stacked feature branches with no co-author attribution. No merge, push, production-data reads or deployment without the user's release instruction.

Rollback first disables grant-derived access and new editing controls. Retain additive schema/grants/audit history for review; do not rewrite roles or revert applied migrations. Verify that ordinary admin access still works with the switch off before rollout.
