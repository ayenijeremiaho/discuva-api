# Admin roles, individual permissions and assigned forms

Status: accepted as the basis for implementation planning, 2026-11-14. Admin portal only. Department membership and member-app worker capabilities do not grant access through this design. Google Sheets sync remains a separate, parked proposal. No permission implementation or schema changes yet.

## Access model

1. Keep the existing assigned admin role.
2. Add `additionalPermissions: AdminPermission[]` to each admin, default empty, excluding forms permissions (forms access is through a role or an assigned form only). Effective global permissions are the deduplicated union of role permissions and individual additions. This version has no per-user deny overrides or multiple-role assignments.
3. Add per-form grants for an active admin: View results, with optional Export results. Export requires View. This grant authorises only that form's response table, approved response-field labels, analytics and optionally CSV. It does not authorise form editing, creating responses, cloning, publishing, deleting, templates, uploads, sharing or other forms.

Example: an Event Coordinator role grants event access; one user additionally gets View Attendance and read-only results for Volunteer Registration. They can see that form's current responses, but not other forms or download its results unless export is granted.

Global permissions and scoped grants stay distinct. Existing FORMS_READ deliberately continues its current all-form read/analytics/export access for compatibility; FORMS_WRITE continues its existing global management scope. A per-form grant never inserts FORMS_READ into a person's global permission array. Scoped grants add access; they cannot narrow access already supplied by a global role or individual permission. The UI must identify existing all-form access rather than suggesting a scoped selection restricts it.

## Admin workflow

Under Admin Users & Roles → user, show Assigned role, read-only Permissions from role, editable Additional permissions, combined Effective global access, and Assigned forms with view/export choices. Explain why each permission is available and why removing a direct grant does not remove inherited role access.

On a form, add an Access panel with the same authorised admin-user selector and view/export choices. Both editors use one grant table/API; there is no second copy of access settings. First release shares with existing active admin accounts only. A limited-access admin role can have no global module permissions and rely on assigned forms; inviting external guests without an admin account is later work.

Assigned-only users get a scoped Forms / Shared with me entry and a read-only results screen. Their landing route works even with no global permissions. Lists, search, totals, form options and URLs reveal only assigned resources. The results table loads current submissions through the normal paginated read; it is not a downloaded snapshot and does not imply live push updates while the page is idle.

## Authority and enforcement

Only authorised admin-access managers can change direct permissions or form grants, within their own authority. Preserve owner-only actions, last-owner safeguards, self-edit restrictions, inactive-account checks and existing read-only overseer/closed-branch constraints. Audit grant/update/revoke actions with actor, subject, target form and before/after values. Module availability and subscription checks continue to apply.

Use one permission resolver across guards, DTOs/navigation, service-level checks, account recovery/delegation checks and batch notification-recipient selection. Keep stored role permissions separate from computed effective permissions; never mutate a role entity to add a user's grants.

Forms need explicit action-aware checks: global access to that action OR the matching per-form grant. Standard global Forms guards cannot remain the only gate, and an unprotected bypass is unacceptable. Cover results, analytics, CSV, form summaries/field metadata, list/options/search and indirect lookups. Unassigned IDs must not reveal resource metadata. Existing member/public form submission routes keep their current audience rules. Preserve anonymous vote identities, quiz-result restrictions and attachment access when displaying or exporting assigned results.

## Data and efficiency

New tenant migration only: empty-default permission array on admins, plus form-admin grants with form/admin FKs and view/export flags. Unique (form_id, admin_id) supports scoped checks and form access panels; reverse (admin_id, form_id) supports assigned-form lists and admin removal. Use the existing admin/role lookup to read individual grants, with request-local memoisation. No GIN index is needed for arrays read by the existing admin primary-key/member lookup.

Filter form lists using indexed EXISTS/joins, not per-row permission queries or unbounded ID arrays. Derive hasAssignedForms alongside the admin/profile response, without promoting it to global FORMS_READ. Do not introduce a cross-request permission cache initially; server checks must observe revocation on the next request. Refresh frontend effective access after permission changes. No polling or scheduled jobs. Grants add small indexed checks/writes and existing audit records; quantify query plans in implementation.

## Checks and rollout

Test unchanged legacy roles, additive grants/removal, inherited permission provenance, disabled users, owner/self-edit protection, cross-tenant and guessed-form IDs, view-without-export, export dependency, hidden metadata/attachments, quiz/vote privacy, revoke-on-next-request, minimal-role sign-in/navigation and batch notifications. Verify list filtering/counts and query plans with real migrations. Check desktop/phone UI and update help, API docs, Postman and admin release notes. No admin-only member-app release note.

Roll out separately from Phase 4, behind two independent switches defaulting off: `admin_access_mode` for individual permissions and `form_access_mode` for assigned forms. Either can be on without the other. With a switch off, preserve legacy roles and ignore that feature's grants. Turning it off revokes grant-derived access while preserving data for review. Migrations are additive and immutable; no production data reads or deployment without release instructions.

Implementation sequence, proposed API contract, test gates and rollout: [ADMIN_USER_FORM_ACCESS_IMPLEMENTATION_PLAN.md](ADMIN_USER_FORM_ACCESS_IMPLEMENTATION_PLAN.md). Implementation is on the API/admin feature branches, default off; see [validation record](ADMIN_USER_FORM_ACCESS_VALIDATION.md).
