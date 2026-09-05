# Discuva — Technical Documentation

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Data Models](#3-data-models)
4. [Authentication & Authorization](#4-authentication--authorization)
5. [Module Reference](#5-module-reference)
6. [API Endpoints Quick Reference](#6-api-endpoints-quick-reference)
7. [Check-In Flow](#7-check-in-flow)
8. [Automated Absence Marking](#8-automated-absence-marking)
9. [Role & Permission Matrix](#9-role--permission-matrix)
10. [Environment Variables](#10-environment-variables)
11. [Enum Reference](#11-enum-reference)

---

## 1. System Overview

A NestJS REST API that manages church membership, service attendance, workforce scheduling, class enrolment, Sunday
School sessions, Children Church security check-in, internal announcements, tithe records, internal finance
requests, and prayer meeting roster management for a local church.

**Core design principles:**

- Every church member has one account. Workers are members with an optional `WorkerProfile` attached.
- A single JWT login endpoint serves all member roles: MEMBER and WORKER. Admin portal access is controlled separately
  via the `admins` table.
- There are two distinct frontends: a **mobile app** for members and workers, and an **admin web portal** managed via
  the Admin RBAC system.
- Attendance is tracked per **Event**, not per slot. One event can have multiple slots but each member gets exactly one attendance record per event.
- Members are PRESENT or ABSENT. Workers can also be LATE (arrived after threshold) or ON_LEAVE (approved leave covering the event date). ON_LEAVE is neutral — it neither contributes to nor breaks the attendance streak.
- Absentees are marked automatically by a background cron job, not by user action.
- **Sunday School** tracks session-based attendance for permanent class assignments. Both teachers and enrolled students
  can mark attendance; self-mark requires an open window set by staff.
- **Children Church** provides a full security check-in/check-out system for 1000+ children, with per-session
  6-character pickup codes, multiple guardians per child, automatic age-group assignment by date of birth, and pickup
  email notifications to guardians.
- **Follow-Up** tracks first-time visitors and online non-responders. A FollowUpTask is auto-created on every first-timer registration and assigned to a FOLLOW_UP-department worker via round-robin (fewest open tasks wins). After every event, thank-you emails are sent to all attendees and online-confirm requests are sent to absent members if `onlineAttendanceEnabled` is set. Members who don't confirm online attendance within `ONLINE_CHECKIN_WINDOW_HOURS` get a follow-up task.

---

## 2. Architecture

```
src/
├── auth/             Single login, JWT strategy, refresh tokens
├── member/           Universal identity: Member + WorkerProfile
├── event/            Event + ServiceSlot + EventConfig
├── venue/            Named, reusable venue entities (lat/lon)
├── attendance/       Check-in, history, leaderboard, cron job
├── department/       Departments + leads
├── request-leave/    Worker leave requests
├── classes/          ChurchClass + ClassEnrollment
├── announcement/     Announcements with audience targeting
├── birthday/         Birthday greetings, wish wall (BirthdayWish entity)
├── notes/            Pastoral notes (naming, dedication, marriage)
├── dashboard/        Aggregated dashboards per role
├── sunday-school/    Session-based SS classes, members, sessions, attendance
├── children-church/  Age groups, class groups, child profiles, guardians, check-in/out
├── admin/            Admin RBAC: AdminRole + Admin entities, AdminGuard, seed (@Global module)
├── tithe/            Batch tithe upload (Excel), queue-based processing, dispute resolution, member PDF statements
├── finance-request/  Department expense requests lifecycle (submit → approve/reject → proof)
├── follow-up/        First-timer registration, follow-up task management, post-event email jobs, online attendance
├── service-programme/ Service programme authoring, live session control, analytics, PDF reports
├── service-headcount/ Physical attendance headcounts per service slot, trends by period
├── prayer/           Prayer meeting roster: schedule config, day configs, rules, self-selection, auto-assignment, reminders
└── utility/          Email queue, cache, hashing, pagination, email delivery log, Cloudinary file uploads, PDF generation
```

**Stack:** NestJS · TypeORM · PostgreSQL · Redis · Bull · ioredis · Argon2 · Passport (JWT + Local) · class-validator · nestjs-schedule ·
@nestjs/throttler · Handlebars · DOMPurify · ExcelJS · PDFKit · Cloudinary · Nodemailer (Gmail SMTP) · Resend SDK · libphonenumber-js

---

## 3. Data Models

### Member

The universal identity for every person in the system.

| Field                 | Type              | Notes                                                                                                     |
|-----------------------|-------------------|-----------------------------------------------------------------------------------------------------------|
| id                    | UUID              | PK                                                                                                        |
| firstname, lastname   | string            |                                                                                                           |
| email                 | string            | Unique                                                                                                    |
| password              | string            | Argon2 hashed                                                                                             |
| changedPassword       | boolean           | `false` on signup and admin password reset; set to `true` after first change                              |
| deviceId              | string \| null    | Mobile device fingerprint registered on first login; `null` until first mobile login or after admin purge |
| role                  | MemberRoleEnum    | MEMBER \| WORKER (no ADMIN role — admin access is a separate entity)                                      |
| status                | MemberStatusEnum  | ACTIVE \| INACTIVE                                                                                        |
| gender                | GenderEnum        | Optional                                                                                                  |
| birthDay              | smallint \| null  | Day of birth (1–31); optional                                                                             |
| birthMonth            | smallint \| null  | Month of birth (1–12); optional                                                                           |
| birthYear             | smallint \| null  | Year of birth (1900–2100); optional — may be omitted when unknown                                        |
| maritalStatus         | MaritalStatusEnum | Optional                                                                                                  |
| yearBornAgain         | Date              | Stored as Jan 1 of given year                                                                             |
| yearBaptized          | Date              | Optional                                                                                                  |
| baptizedWithHolyGhost | boolean           | Optional                                                                                                  |
| dateJoinedChurch      | Date (date only)  | Optional; full YYYY-MM-DD date, stored in `date_joined_church` column                                     |
| photoUrl              | string \| null    | Cloudinary `secure_url` of the member's self-uploaded profile picture. `null` until first upload.         |
| photoPublicId         | string \| null    | Internal — Cloudinary public_id, used to delete the old asset on replace/remove. Not exposed on `MemberDto`. |
| workerProfile         | WorkerProfile     | OneToOne, null for plain members                                                                          |
| clergy                | Clergy \| null    | OneToOne, null unless the member carries a clergy designation — see Clergy table below                    |
| attendances           | Attendance[]      | OneToMany                                                                                                 |
| enrollments           | ClassEnrollment[] | OneToMany                                                                                                 |

**Profile picture:** self-service via `POST/DELETE members/me/photo` (`JwtAuthGuard`), uploaded to Cloudinary folder `profile-pictures` (3MB limit, image mimetypes only). Replacing a photo uploads the new one first, saves it, then deletes the previous Cloudinary asset by `photoPublicId` (fire-and-forget). Admins can also clear a member's photo via `DELETE members/:id/photo` (`AdminGuard` + `MEMBERS_WRITE`) for moderation. `GET /birthday/today`'s `BirthdayCelebrant` shape also carries `photoUrl`, alongside the existing role/department/clergyTitleName disambiguation for same-named celebrants (see Birthday Module).

### WorkerProfile

Created when a member is promoted to WORKER. **Never deleted by any revocation path** — `revokeWorker` and `demoteTraineeToMember` both deactivate the row (`status = INACTIVE`) rather than removing it, so a member's worker history (department, profession, `completedSOD`/`completedBibleCollege`, `isTrainee`) survives and is picked back up if they're later re-promoted.

| Field                 | Type               | Notes                                                                                            |
|-----------------------|--------------------|--------------------------------------------------------------------------------------------------|
| id                    | UUID               | PK                                                                                               |
| member                | Member             | OneToOne                                                                                         |
| department            | Department         | ManyToOne — primary department                                                                   |
| secondaryDepartment   | Department \| null | ManyToOne, nullable — secondary department; HOD/D-HOD can be assigned from primary OR secondary department |
| status                | WorkerStatusEnum   | ACTIVE \| INACTIVE                                                                               |
| profession            | string             | Optional                                                                                         |
| yearJoinedWorkforce   | Date               | Optional                                                                                         |
| completedSOD          | boolean            | School of Disciples                                                                              |
| completedBibleCollege | boolean            |                                                                                                  |
| isTrainee             | boolean            | Default `false`. Marks a worker as still in training/probation — has full worker access (role stays `WORKER`, `RolesGuard` only checks `role`) but is flagged in the UI (mobile "Training" badge, admin "Trainee" badge). Toggled via `PATCH members/:id/worker-profile`. |

**Deactivation (`revokeWorker` / `demoteTraineeToMember`) — shared, non-destructive:** both go through a private `deactivateWorkerAccess()` helper that removes `DepartmentLead` rows and any Sunday School teacher assignment (no cascade on those FKs), sets `workerProfile.status = INACTIVE`, and resets `member.role = MEMBER`. Access is fully revoked immediately — `RolesGuard` does an exact match on `role` alone, so a `MEMBER`-role account can't reach worker routes regardless of what its (inactive) `WorkerProfile` looks like. The two differ only in guard + what they touch on `isTrainee`:
- `revokeWorker` — any active worker, `POST members/:id/revoke-worker`. Leaves `isTrainee` untouched (so reinstatement resumes exactly as they left off, trainee or not).
- `demoteTraineeToMember` — `isTrainee = true` profiles only (400 otherwise — "use revoke-worker instead"), `POST members/:id/demote-trainee`. Explicitly clears `isTrainee`, since ending trainee status is the point of this action.

Both use `AdminGuard` + `MEMBERS_WRITE`.

**Reinstatement (`promoteToWorker`):** now checks `workerProfile?.status === ACTIVE` (not mere existence) before rejecting with "already registered as a worker" — a member with an `INACTIVE` profile is eligible again. `buildOrReactivateWorkerProfile()` reuses the existing row instead of creating a new one: `department` and `status` are always set from the call, but `profession`/`yearJoinedWorkforce` are only overwritten if explicitly supplied this time (otherwise the prior values are kept), and `completedSOD`/`completedBibleCollege`/`isTrainee` are never touched by this path at all — they simply carry over. Audit-logged as `WORKER_REINSTATED` (vs `WORKER_PROMOTED` for a genuinely new profile) so the trail distinguishes the two. `bulkPromoteToWorker` uses the same helper and ACTIVE-only guard for consistency.

**Login/refresh gating (`auth.service.ts`):** the "worker account suspended" check is scoped to `member.role === WORKER` — it used to fire whenever *any* `workerProfile` existed with a non-`ACTIVE` status, which would have wrongly blocked login for a plain `MEMBER` carrying a leftover `INACTIVE` profile from a prior revoke/demotion. Applied identically in `validateMember`, `validateRefreshToken`, and its rotated-token-replay path.

### Clergy

A clergy designation on a member (renamed from "Pastor" 2026-08 — the container was still called "Pastor"
everywhere even though the whole point of the title catalog is that a tenant isn't locked into Pentecostal/
Protestant terms; "Clergy" is the denomination-neutral standard term for ordained/formal ministry office).
Independent of `WorkerProfile`/`Department` — a clergy member may have no department (e.g. a Lead Pastor) or may
separately also be an HOD. At most one row per member (`OneToOne` on `member`).

| Field             | Type        | Notes                                              |
|-------------------|-------------|-----------------------------------------------------|
| id                | UUID        | PK                                                   |
| member            | Member      | OneToOne, `onDelete: CASCADE`                        |
| title             | ClergyTitle | ManyToOne, `onDelete: RESTRICT` — see ClergyTitle below |
| canReviewFeedback | boolean     | Default `true`. Independent of `title` — holding a title (a promotion/recognition) does NOT by itself grant the ability to see and respond to every department's Pastor Feedback reports. Set explicitly via `PATCH /members/:id/clergy/review-access`, never as a side effect of a title change. See Pastor Feedback Module below. |

Managed via `POST/PATCH/DELETE /members/:id/clergy` (see Member Module). Surfaced on `MemberDto` as
`clergy: { title: {id, name}, canReviewFeedback: boolean } | null`, computed from the `clergy` relation.

### ClergyTitle

Tenant-configurable clergy title catalog (added 2026-08, replacing the old hardcoded `PastorTypeEnum`). A tenant
defines its own titles instead of being locked into Pentecostal/Protestant terms like "Lead Pastor" — a Catholic
tenant can use Priest/Bishop/Deacon, a Methodist tenant Minister/Elder/District Superintendent, etc. Every
existing tenant was seeded with the 3 legacy labels ("Lead Pastor"/"Parish Pastor"/"Associate Pastor") at migration
time so nothing broke on rollout; tenants are free to rename/delete/add from there.

| Field       | Notes                                                                          |
|-------------|---------------------------------------------------------------------------------|
| id          | UUID PK                                                                          |
| name        | Unique, max 40 characters                                                        |
| description | Nullable                                                                         |
| clergy      | OneToMany → Clergy                                                               |

Same CRUD shape as Department (`src/clergy-title/`, mirrors `src/department/` structurally): `create`/`update`
enforce name uniqueness, `delete` is blocked (`400`) if any `Clergy` row still references the title — the DB-level
backstop is `clergy.clergy_title_id`'s `onDelete: RESTRICT`. `GET /clergy-titles`/`GET /clergy-titles/:id` are
public (mirrors `GET /departments`); `POST`/`PATCH`/`DELETE` reuse `AdminGuard` + `MEMBERS_WRITE` rather than a new
permission pair — same precedent already established for `/members/:id/clergy` itself.

**`name`'s 40-char cap (added 2026-08)** exists to keep the title from distorting the small badge UI it renders in
(the member detail panel and the member's own account-page header, both `flex-wrap` pill rows) — not an arbitrary
DB constraint. Enforced via `@MaxLength(40)` on `CreateClergyTitleDto`. `UpdateClergyTitleDto` is a real class
extending `PartialType(CreateClergyTitleDto)`, not the `type X = Partial<Y>` alias pattern used elsewhere in this
codebase — the latter compiles to `Object` for reflection purposes, so `main.ts`'s global `ValidationPipe` silently
skips validating it entirely (confirmed by testing: no whitelist stripping, no `@MaxLength` enforcement) since it
can't resolve a real class to instantiate against. `PartialType` was needed here specifically so `PATCH
/clergy-titles/:id` enforces the same cap as `POST` does, not just create.

**Routes** (`src/clergy-title/controller/clergy-title.controller.ts`):

| Method | Path                 | Permission                | Description |
|--------|----------------------|----------------------------|--------------|
| GET    | /clergy-titles       | Public                     | Full catalog, ordered by `createdAt DESC` |
| GET    | /clergy-titles/:id   | Public                     | Single title |
| POST   | /clergy-titles       | AdminGuard (MEMBERS_WRITE) | `{ name, description? }`; `400` if name already exists |
| PATCH  | /clergy-titles/:id   | AdminGuard (MEMBERS_WRITE) | Partial update of the same fields |
| DELETE | /clergy-titles/:id   | AdminGuard (MEMBERS_WRITE) | `400` if any clergy member is still assigned to it |

### MemberImportJob

Tracks a single bulk-import spreadsheet upload from preview through commit.

| Field             | Type                  | Notes                                                                 |
|-------------------|-----------------------|------------------------------------------------------------------------|
| id                | UUID                  | PK                                                                      |
| originalFilename  | string                | Filename as uploaded                                                    |
| status            | MemberImportJobStatus | READY_FOR_REVIEW \| COMMITTED                                          |
| totalRows         | int                   | Total data rows parsed from the sheet                                   |
| validRows         | int                   | Rows with zero validation errors at preview time                        |
| createdCount      | int                   | Members actually created on commit                                      |
| failedCommitCount | int                   | Rows that still failed at commit time despite passing preview           |
| createdBy         | Admin                 | ManyToOne, `onDelete: RESTRICT`                                          |

### MemberImportRow

One row of a `MemberImportJob`'s source spreadsheet.

| Field           | Type                  | Notes                                                                          |
|-----------------|-----------------------|-----------------------------------------------------------------------------------|
| id              | UUID                  | PK                                                                                 |
| job             | MemberImportJob       | ManyToOne, `onDelete: CASCADE`                                                     |
| rowNumber       | int                   | 1-based spreadsheet row number (header is row 1)                                   |
| data            | jsonb                 | Parsed row fields — see `MemberImportRowData` interface                            |
| errors          | jsonb (string[])      | Validation errors found at preview time; empty array = eligible to commit          |
| status          | MemberImportRowStatus | PENDING \| CREATED \| FAILED                                                       |
| createdMemberId | UUID \| null          | Set once the row's member is created                                              |
| commitError     | string \| null        | Set only if the row passed preview validation but still failed at commit time      |

### Event

A church gathering on a specific date.

| Field             | Type             | Notes                                                                                                   |
|-------------------|------------------|---------------------------------------------------------------------------------------------------------|
| id                | UUID             | PK                                                                                                      |
| name              | string           |                                                                                                         |
| description       | string           | Optional                                                                                                |
| eventDate         | Date (date only) | Derived, not user-entered: the earliest `serviceSlots[].startTime` (UTC date). Recomputed whenever slots are (re)created via `EventService`. Date-level only — use for date-range filtering, not "is this event over" checks. |
| endDate           | Date (date only) | Derived: the latest `serviceSlots[].endTime` (UTC date). Recomputed alongside `eventDate`. Same date-only caveat as `eventDate`.               |
| startTime         | timestamptz      | Derived: the precise instant of the earliest slot's `startTime` (not truncated). Recomputed alongside `eventDate`.                              |
| endTime           | timestamptz      | Derived: the precise instant of the latest slot's `endTime` (not truncated). Use this — not `endDate` — for "is this event past/live" checks, since `endDate` only has day-level granularity. |
| attendanceMarked           | boolean          | Set to `true` by the cron job after absence records are created. Guards against double-processing.      |
| onlineAttendanceEnabled    | boolean          | Default `false`. When `true`, absent members receive an online-confirm email after the event ends.      |
| onlineNotificationSentAt   | timestamptz \| null | Set when the online-confirm emails are dispatched. Used to calculate the confirmation window.        |
| thankYouSentAt             | timestamptz \| null | Set after thank-you emails are queued for the event; guards against resending on re-trigger.        |
| recurringEventId           | UUID             | Groups events in a recurring series                                                                     |
| serviceSlots      | ServiceSlot[]    | OneToMany — at least one slot is required at creation                                                   |
| attendances       | Attendance[]     | OneToMany                                                                                               |

### Venue

A named, reusable physical location. Referenced by `EventConfig.defaultVenue` and optionally overridden per slot via
`ServiceSlot.venueOverride`; also optionally referenced by `SmallGroup.venue` (see Small Group Module).

| Field     | Type   | Notes           |
|-----------|--------|-----------------|
| id        | UUID   | PK              |
| name      | string | Unique          |
| address   | string | Optional        |
| latitude  | float  | WGS84 latitude  |
| longitude | float  | WGS84 longitude |

Deleting a venue that is set as `defaultVenue` on any `EventConfig` is rejected by the DB FK constraint. Deleting a
venue that is a slot-level `venueOverride` sets that field to `null` (SET NULL).

### ServiceSlot

The actual check-in target within an event. One event can have multiple slots.

| Field             | Type        | Notes                                                             |
|-------------------|-------------|--------------------------------------------------------------------|
| id                | UUID        | PK                                                                |
| event             | Event       | ManyToOne                                                         |
| name              | string      | Default: "Service"                                                |
| startTime         | timestamptz |                                                                   |
| endTime           | timestamptz |                                                                   |
| config            | EventConfig | ManyToOne, nullable                                               |
| venueOverride     | Venue \| null | ManyToOne, nullable — overrides config.defaultVenue for this slot |
| formatOverride    | MeetingFormatEnum \| null | Nullable — overrides config.defaultFormat for this slot (`IN_PERSON` \| `ONLINE`) |
| *Override columns | int         | Per-slot overrides that take priority over EventConfig            |

Override columns: `workerCheckinStartOverride`, `workerLateOverride`, `memberCheckinStartOverride`,
`checkinStopOverride`, `allowedDistanceOverride`

**Resolution (`EventService.resolveSlotConfig`):** `format = slot.formatOverride ?? config.defaultFormat`;
`venue = slot.venueOverride ?? config.defaultVenue`. Throws 400 only when the resolved `format` is `IN_PERSON` and
`venue` is still null — an `ONLINE`-resolved slot never requires a venue. A slot overriding an `ONLINE` config back
to `IN_PERSON` must supply its own `venueOverride`; enforced at save time (`EventService.buildSlotFromDto`), not
just at first check-in.

### EventConfig

A reusable timing template assigned to service slots. Venue is a first-class relation rather than raw lat/lon.

| Field                           | Type   | Description                                                                                 |
|---------------------------------|--------|-----------------------------------------------------------------------------------------------|
| name                            | string | Unique                                                                                      |
| defaultVenue                    | Venue \| null | ManyToOne, nullable, RESTRICT on delete — required when `defaultFormat` is `IN_PERSON`, forbidden when `ONLINE` (enforced in `EventConfigService`, not a DB constraint) |
| defaultFormat                   | MeetingFormatEnum | `IN_PERSON` \| `ONLINE`. Default `IN_PERSON` — every pre-existing config keeps its behavior unchanged |
| onlineMeetingUrl                | string \| null | Optional join link shown to members/workers when the resolved format is `ONLINE` |
| workerCheckinStartOffsetSeconds | int    | Seconds relative to `startTime` when workers can start checking in. Negative = before start |
| workerLateOffsetSeconds         | int    | Seconds after `startTime` after which workers are LATE                                      |
| memberCheckinStartOffsetSeconds | int    | When members can start checking in                                                          |
| checkinStopOffsetSeconds        | int    | When check-in closes for everyone                                                           |
| allowedDistanceInMeters         | int    | Max distance from the resolved venue for location validation (ignored for `ONLINE`)          |
| autoStartSession                | bool   | Default `false`. See `ProgrammeAutoStartScheduler` (Service Programme section) below         |

**Constraint:** `workerLateOffset > workerCheckinStartOffset` and `checkinStopOffset > workerLateOffset`

**MeetingFormatEnum** (`src/utility/enum/meeting-format.enum.ts`, shared with `SmallGroup`): `IN_PERSON` | `ONLINE`.
Deliberately two values, no `HYBRID`.

**Check-in behavior for ONLINE slots:** `AttendanceService.checkin` skips the "workers must provide location"
requirement when the resolved slot format is `ONLINE`, and never runs distance validation against a null venue.

### Attendance

One record per member per **event**. Workers and members both receive one attendance record per event; workers are distinguished by a LATE status if they arrive after the threshold.

| Field         | Type                 | Notes                                                             |
|---------------|----------------------|-------------------------------------------------------------------|
| id            | UUID                 | PK                                                                |
| member        | Member               | ManyToOne, CASCADE on delete                                      |
| event         | Event                | ManyToOne, CASCADE on delete — the event being attended           |
| serviceSlot   | ServiceSlot          | ManyToOne, nullable, SET NULL on delete — which slot they entered. Indexed. |
| status        | AttendanceStatusEnum | PRESENT \| LATE \| ABSENT \| ON_LEAVE \| ATTENDED_ONLINE          |
| checkinTime   | timestamptz          | Null for cron-created ABSENT/ON_LEAVE records                     |
| roleAtCheckin | MemberRoleEnum       | Snapshot of role at check-in time                                 |
| location      | JSON                 | `{latitude, longitude}` or null; mandatory for workers at check-in |

**Unique constraint:** `(member, event)` — one record per person per event.

**Streak rules:**
- PRESENT, LATE, and ATTENDED_ONLINE all count as present and increment the streak.
- ON_LEAVE is neutral — it neither increments nor breaks the streak.
- ABSENT breaks the streak.

### Department

| Field          | Notes                                                                                                                                                  |
|----------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|
| id             | UUID PK                                                                                                                                                |
| name           | Unique                                                                                                                                                 |
| description    |                                                                                                                                                        |
| capabilities   | `DepartmentCapability[]` (`text[]`, default `{}`) — fixed, code-defined feature flags this department grants to its workers (both primary and secondary). Validated against the `DepartmentCapability` enum (`src/department/enums/department-capability.enum.ts`) — unlike the `key` column it replaced, a capability only exists if a real feature is gated on it, and a single department can hold more than one. |
| workerProfiles | OneToMany → WorkerProfile                                                                                                                              |

### DepartmentLead

Joins a WorkerProfile to a Department as head or assistant lead.

### PastorFeedback

Weekly structured feedback a department's HOD or Assistant HOD (D_HOD) submits, which a pastor can read and respond to — from both the admin portal and the mobile app.

| Field                  | Notes                                                                                          |
|------------------------|--------------------------------------------------------------------------------------------------|
| department             | ManyToOne → Department (`onDelete: CASCADE` — historical feedback for a deleted department is meaningless to retain) |
| submittedBy            | ManyToOne → WorkerProfile, nullable (`onDelete: SET NULL` — a later worker revocation shouldn't be blocked by old feedback) |
| submittedByName        | Snapshotted at submit time (mirrors `AuditLog`'s `targetName` pattern) so history survives regardless of the live FK |
| weekOf                 | date — the Monday of the week being reported on (canonical anchor, unambiguous)                 |
| attendanceNotes        | text, required                                                                                   |
| highlights             | text, required                                                                                   |
| challenges             | text, required                                                                                   |
| prayerRequests         | text, nullable                                                                                   |
| additionalNotes        | text, nullable                                                                                   |
| submittedAt            | auto timestamp                                                                                   |
| respondedByClergy      | ManyToOne → Clergy, nullable (`onDelete: SET NULL`)                                              |
| respondedByClergyName  | Snapshotted at response time, same rationale as `submittedByName`                                |
| pastorResponse         | text, nullable                                                                                   |
| pastorRespondedAt      | timestamp, nullable                                                                              |

**Unique constraint:** (department, weekOf) — one submission per department per week. Editing after submission is a `PATCH` on the same row; there's no draft/submitted status or read-receipt lock.

**Ownership check (submission/edit):** the caller must be an HOD or Assistant HOD (`DepartmentLead` row) of the target department — checked via `DepartmentLead.exists({ workerProfile, department })`, mirroring the `isHod` check in `auth.service.ts:getProfile()`. Not gated by `RolesGuard`/`@Roles(WORKER)` alone, since being a worker isn't sufficient — must specifically lead that department.

**Ownership check (feedback response, added 2026-08 — now stricter than mere Clergy existence):** the caller must have a `Clergy` record with `canReviewFeedback: true` (`PastorFeedbackService.assertCanReviewFeedback()`), not just any clergy designation regardless of title. This is deliberately decoupled from `title` — being promoted to a new title (or holding any title at all) does not by itself grant the ability to see and respond to every department's reports; an admin grants that separately via `PATCH /members/:id/clergy/review-access`, defaulting `true` for existing clergy so nothing broke on rollout. Available via both the admin portal (an `Admin` account whose linked `Member` has such a `Clergy` record) and the mobile app.

### PrayerRequest

A private prayer request submitted by any member/worker — visible only to the submitter, Prayer department workers, and clergy.

| Field           | Notes                                                                                          |
|-----------------|--------------------------------------------------------------------------------------------------|
| member          | ManyToOne → Member, nullable (`onDelete: SET NULL` — a deactivated member's request history survives) |
| submittedByName | Snapshotted at submit time, same rationale as `PastorFeedback.submittedByName`                  |
| content         | text, required                                                                                   |
| status          | OPEN \| PRAYED_FOR \| ANSWERED (character varying, default OPEN)                                |

### Testimony

An opt-in-public testimony — either tied to one of the submitter's own prayer requests, or general.

| Field           | Notes                                                                                          |
|-----------------|--------------------------------------------------------------------------------------------------|
| member          | ManyToOne → Member, nullable (`onDelete: SET NULL`)                                              |
| submittedByName | Snapshotted at submit time                                                                       |
| prayerRequest   | ManyToOne → PrayerRequest, nullable (`onDelete: SET NULL`) — null means a general testimony       |
| content         | text, required                                                                                   |
| isPublic        | boolean, default false — the submitter's own opt-in flag set at submission time; no separate publish/moderation step |

### PregnancyPrayerCase

Tracks a pregnant woman receiving ongoing prayer support — created and managed by the Prayer team (or pastors), not self-submitted. Lives in the same `src/prayer-request/` module and reuses `PRAYER_READ`/`PRAYER_WRITE` — no new permission.

| Field           | Notes                                                                                          |
|-----------------|--------------------------------------------------------------------------------------------------|
| member          | ManyToOne → Member, nullable (`onDelete: SET NULL`) — she may not be an existing member          |
| name            | Snapshot, always present regardless of `member`                                                  |
| edd             | date — estimated due date                                                                        |
| details         | text, nullable — general context/notes                                                           |
| status          | ACTIVE \| DELIVERED \| DISCONTINUED (character varying, default ACTIVE)                          |
| lastPrayedAt    | timestamptz, nullable — denormalized, updated whenever a new `PregnancyPrayerVisit` is logged     |
| createdBy       | ManyToOne → Member, nullable (`onDelete: SET NULL`)                                               |
| createdByName   | Snapshotted at creation time                                                                      |

### PregnancyPrayerVisit

A log entry recorded each time the Prayer team prays with/visits a pregnant woman — mirrors the `FirstTimerVisit` idiom in the Follow-Up module.

| Field         | Notes                                                              |
|---------------|----------------------------------------------------------------------|
| case          | ManyToOne → PregnancyPrayerCase (`onDelete: CASCADE`)                |
| loggedBy      | ManyToOne → Member, nullable (`onDelete: SET NULL`)                  |
| loggedByName  | Snapshotted at log time                                              |
| note          | text, nullable — follow-up note                                     |
| visitedAt     | timestamptz, default now                                             |

### RequestLeave

| Field             | Notes                                            |
|-------------------|--------------------------------------------------|
| workerProfile     | ManyToOne → WorkerProfile                        |
| dateFrom / dateTo | date (YYYY-MM-DD, no time component)             |
| reason            | string                                           |
| status            | PENDING \| APPROVED \| REJECTED                  |
| actionedBy        | ManyToOne → Member (admin who approved/rejected) |

### ChurchClass

| Field               | Notes                                                          |
|---------------------|----------------------------------------------------------------|
| classType           | ManyToOne → ClassType (nullable: false, onDelete: RESTRICT)   |
| startDate / endDate | date strings                                                   |
| nextSessionAt       | timestamptz, nullable — a single "next session" field the facilitator(s) update as the class progresses week to week, not a full multi-session schedule entity |
| meetingLink         | varchar, nullable — join link for a virtual session, shown alongside `nextSessionAt` |
| materials           | OneToMany → ClassMaterial, `cascade: true` — see below         |
| facilitators        | OneToMany → ClassFacilitator, `cascade: true` — see below      |

**Delete guard:** Deleting a class is blocked if any enrolment record exists (any status — IN_PROGRESS, COMPLETED, or CANCELLED). This preserves historical enrolment data. A class with enrolment history cannot be deleted. Deleting an allowed (enrolment-free) class also cleans up its materials' Cloudinary assets first (see `ClassMaterial` below) — the FK's `onDelete: CASCADE` removes the `class_materials` rows automatically, but nothing app-side fires on a DB-level cascade, so this cleanup has to happen explicitly before the class row is removed. `class_facilitators` rows cascade-delete too, but need no app-side cleanup — there's no external asset attached to a facilitator row.

### ClassFacilitator

Replaces the old `ChurchClass.facilitator` (a single Member FK). A class can have several facilitators, and not every facilitator is a registered Member — an outside guest speaker is named via free text instead.

| Field       | Notes                                                                 |
|-------------|------------------------------------------------------------------------|
| churchClass | ManyToOne → ChurchClass (nullable: false, onDelete: CASCADE)          |
| member      | ManyToOne → Member, nullable (nullable: true, onDelete: SET NULL)     |
| guestName   | varchar, nullable                                                     |
| order       | int, default 0 — display order                                        |

Exactly one of `member`/`guestName` is set per row — validated in `ClassesService` (not the DTO, since class-validator can't cleanly express "exactly one of two fields"); an entry with both or neither throws `BadRequestException`.

**A class must always have at least one facilitator.** `CreateChurchClassDto.facilitators` is a required, non-empty array (`@ArrayMinSize(1)`). `UpdateChurchClassDto.facilitators` is optional — omit it to leave the existing facilitators untouched — but if provided, it must also be non-empty and **replaces the full list** (no incremental add/remove endpoints, unlike `ClassMaterial`; a facilitator has no upload step or cross-class reuse concern to preserve).

Request shape for both create and update: `facilitators: [{ memberId?: string, guestName?: string }]`.

**Next session (`nextSessionAt`/`meetingLink`):** `PATCH classes/:id/session` (body: `UpdateClassSessionDto` — both fields optional, either can be set to `null` to clear it) lets a facilitator/admin record when the class next meets and how to join. Deliberately a single mutable pair of columns rather than a `ClassSession` entity — a class is expected to have one upcoming session in view at a time, updated in place as it progresses, not a pre-populated calendar. Feeds `ClassSessionReminderScheduler` (see Reminder Settings Module) and is surfaced on both the authenticated member class-detail view and the guest portal (`GET classes/guest/:enrollmentId`).

### ClassMaterial

Replaces the old `ChurchClass.documentUrl` (a single free-text URL — the previous `uploadMaterial()` also never persisted Cloudinary's `publicId`, so nothing could ever be deleted). One-to-many, so a class can carry multiple titled documents and links, each independently addable/removable.

| Field         | Notes                                                                                          |
|---------------|--------------------------------------------------------------------------------------------------|
| churchClass   | ManyToOne → ChurchClass (nullable: false, onDelete: CASCADE)                                    |
| title         | required — defaults to the uploaded file's name (extension stripped) when omitted on upload      |
| url           | the Cloudinary secure URL (upload) or the pasted external link                                   |
| publicId      | nullable — Cloudinary asset id; `null` for a pasted link (nothing to delete from Cloudinary)     |
| resourceType  | nullable — Cloudinary resource type (`image`/`video`/`raw`); `null` for a pasted link             |
| mimeType      | nullable — set for uploads only                                                                  |
| sizeBytes     | bigint, nullable — set for uploads only                                                          |
| order         | int, default 0 — display order, assigned incrementally as materials are added                    |

**Three ways to add a material** (all class-scoped, `AdminGuard` + `CLASSES_WRITE`):
- `POST classes/:id/materials/upload` — multipart, field `file` (+ optional `title` field), same file-type allowlist as before (PDF/Word/PowerPoint/image), size gated by `PlatformSettingKey.MAX_CLASS_MATERIAL_UPLOAD_MB` via `DynamicLimitedFileInterceptor`. Uploads to the `class-materials` Cloudinary folder and creates the row in one call.
- `POST classes/:id/materials/link` — JSON `{ title, url }`, no Cloudinary asset (`publicId: null`).
- `POST classes/:id/materials/reuse` — JSON echoing a `GET classes/materials/library` entry's fields back; creates a new row pointing at the *same* Cloudinary asset (or the same pasted URL) without a new upload.

**Reference-counted deletion (`DELETE classes/:id/materials/:materialId`):** because "reuse" lets multiple `ClassMaterial` rows share one `publicId`, deleting a row only calls `CloudinaryService.deleteByPublicId()` if no *other* row still references that `publicId` — checked via a live `exists()` query at delete time (not a stored counter, so it can never drift out of sync). A pasted-link row (`publicId: null`) never touches Cloudinary at all. The same check runs for every material when a class itself is deleted.

**Indexes:** `church_class_id` (FK, backs the `materials` relation join and the pre-delete cleanup loop's per-class fetch) and `public_id` (backs the reference-counted `exists()` check above, which runs on every material/class deletion).

**Library (`GET classes/materials/library`, `CLASSES_READ`):** dedups every material across every class by `publicId` (uploads) or `url` (pasted links with no `publicId`), returning `{ title, url, publicId, resourceType, mimeType, sizeBytes, usedByClassNames }[]` — lets the admin UI's "Reuse Previous" picker show what's already in use and by which classes, instead of re-uploading the same syllabus for every cohort.

**Visibility:** `GET classes/:id` (admin) and the guest portal (`GET classes/guest/:enrollmentId`) both return `materials` sorted by `order`; the guest portal's hand-built response only exposes `{id, title, url, resourceType}` per material, not the full row.

### ClassType

Replaces the old hardcoded `ChurchClassTypeEnum` — class types are now admin-creatable and admin-editable, not a fixed set. `ChurchClassTypeEnum` still exists in code purely as a reference for the migration's seed data; it's not used at runtime anymore (removed from the generic `/enums` endpoint's `churchClassTypes` key for the same reason — it no longer reflects reality once admins add their own types).

| Field           | Notes                                                                 |
|-----------------|------------------------------------------------------------------------|
| name            | unique                                                                  |
| description     | nullable text                                                          |
| isActive        | boolean, default true — deactivated types are hidden from class-create pickers but existing classes keep referencing them (RESTRICT prevents hard-deleting a type still in use) |
| nextClassType   | ManyToOne → ClassType, nullable, self-referencing (`onDelete: SET NULL`) |

**Promotion chain:** `nextClassType` is a self-referencing pointer, not a `level` number — a class type either points to the next type in its progression or is `null` (standalone, no promotion). The chain is entirely admin-configured via the ClassType CRUD endpoints; nothing is pre-wired by the migration (the 5 seeded legacy types — Believers' Class, Baptismal Class, Workers in Training, Bible College, School of Discipleship — all seed with `nextClassType = null`). Writes are validated server-side against self-reference and cycles (walks the proposed chain up to 20 hops looking for a loop back to the type being edited) since a DB FK can't express "no cycles."

### Guest

A non-member taking a Training Class — e.g. a visitor's spouse attending marriage counselling alongside their member partner. Deliberately its own entity, not inline columns on `ClassEnrollment`: a guest is a repeat, evolving identity that may take several classes over time, so contact details are stored once here and referenced from each enrollment, rather than duplicated (and risking staleness) per enrollment row.

| Field           | Notes                                                                 |
|-----------------|------------------------------------------------------------------------|
| firstName       | required                                                                |
| lastName        | required                                                                |
| email           | required, unique — the primary contact channel, prioritized over phone |
| phone           | nullable — optional, used only if the guest opts into SMS              |
| churchName      | nullable — their home church, if any                                   |
| address         | nullable                                                                |
| notes           | text, nullable — open catch-all                                        |
| convertedMember | ManyToOne → Member, nullable, `onDelete: SET NULL` — set once this guest converts to a full Member; kept as a permanent historical link even after `ClassEnrollment.member` is also updated directly (see conversion below) |

**Find-or-create by email:** `GuestService.findOrCreateByEmail()` backs both the "new guest" enrollment form (profile fields provided, no prior record) and the "existing guest" search-and-select path — a returning guest's contact details are looked up once by email, not re-entered per class.

**Conversion (`POST classes/guests/:guestId/convert-to-member`):** admin-only, scoped to the guest record (not one enrollment) — reuses `MemberService.createByAdmin()`, the same temp-password + forced-change-password + welcome-email flow used for every other admin-created member. Builds a `SignupDto` from the guest's `firstName`/`lastName`/`email`/`phone`, creates the member, sets `guest.convertedMember`, then bulk-updates every `ClassEnrollment` referencing that guest to point at the new member directly — so downstream code (reminders, Announcements audience resolution, submissions) never needs to know about the guest→member relationship, only "does this enrollment have a member." The guest record and its profile data are kept as history, not cleared. Audit-logged as `GUEST_CONVERTED_TO_MEMBER`.

### ClassEnrollment

| Field                     | Notes                                 |
|---------------------------|---------------------------------------|
| member                    | ManyToOne → Member, nullable          |
| guest                     | ManyToOne → Guest, nullable, indexed, `onDelete: SET NULL` |
| purpose                   | text, nullable — why this specific enrollee is taking this specific class; per-enrollment (not per-guest), since the same guest could take two classes for two different reasons |
| churchClass               | ManyToOne → ChurchClass               |
| status                    | IN_PROGRESS \| COMPLETED \| CANCELLED |
| enrolledAt                | auto timestamp                        |
| completedAt / cancelledAt | set when status changes               |
| certificateIssued         | boolean, default false                |
| certificateIssuedAt       | timestamptz, nullable                 |
| certificateNumber         | varchar, nullable                     |

**Exactly one of `member`/`guest` is required** — DB-level CHECK constraint `member_id IS NOT NULL OR guest_id IS NOT NULL`. Not exclusive (not XOR): a converted guest ends up with both set — `guest` is retained as history, `member` is set at conversion time (see `Guest` above).

**Unique constraints:** (member, churchClass) and (guest, churchClass) — a member and a guest can each only have one enrollment record per class.

**Guest portal access:** a guest never logs in — their own `ClassEnrollment.id` (already a random-looking UUID) is the access key, mirroring the Forms module's public-submission pattern (`@Public()`, no token-generation system). On enrollment, `class-guest-access` emails a link to `GET classes/guest/:enrollmentId` (frontend: `discuva-member`'s `app/classes/guest/[id]/page.tsx`, no `Shell`/`withAuth`). That route + the paired `POST classes/guest/:enrollmentId/assignments/:assignmentId/submit` are the *only* surface a guest can reach — no other member-app feature, no self-serve conversion.

**Level promotion:** When an enrollment is `COMPLETED` and its class's `classType.nextClassType` is set, `GET classes/enrollments/:enrollmentId/promotion-candidate` reports eligibility plus any currently-open (`ACTIVE`) classes of that next type. Promotion itself is a separate, explicit, admin-confirmed action — `POST classes/enrollments/:enrollmentId/promote` (body: `targetClassId`) — mirroring the `promoteToWorker` pattern (transaction + `CLASS_LEVEL_PROMOTED` audit log entry + a `class-level-promotion` templated email to the member). Nothing is auto-enrolled on completion; standalone class types (no `nextClassType`) simply have no promotion affordance.

**Certificates:** Once an enrollment is `COMPLETED`, `PATCH classes/enrollments/:enrollmentId/certificate` (body: optional `certificateNumber`) marks it as having received a certificate — sets `certificateIssued = true`, `certificateIssuedAt = now()`, and stores `certificateNumber` if given. This is a manual, admin-confirmed record only (no file upload); it logs `CLASS_CERTIFICATE_ISSUED`.

### Announcement

| Field        | Notes                                                                     |
|--------------|----------------------------------------------------------------------------|
| audience     | ALL \| WORKERS_ONLY \| MEMBERS_ONLY \| DEPARTMENT \| INDIVIDUAL \| GROUP \| CLASS |
| department   | ManyToOne → Department (required when audience=DEPARTMENT)                 |
| targetMember | ManyToOne → Member, nullable (required when audience=INDIVIDUAL)           |
| group        | ManyToOne → Group, nullable (required when audience=GROUP)                 |
| churchClass  | ManyToOne → ChurchClass, nullable, column `class_id` (required when audience=CLASS) |
| publishedAt  | defaults to creation time                                                  |
| expiresAt    | nullable; expired items excluded from feed                                 |
| sendViaSms   | boolean, default `false`; requires the caller's admin role to hold `SMS_SEND` (see SMS Module) |
| smsBody      | text, nullable; required when `sendViaSms=true`; deliberately separate from `body` since SMS is billed per segment |

### AnnouncementReaction

A member's emoji reaction to an announcement they received.

| Field        | Notes                                                                     |
|--------------|----------------------------------------------------------------------------|
| announcement | ManyToOne → Announcement, `onDelete: CASCADE`, indexed                     |
| member       | ManyToOne → Member, `onDelete: CASCADE`                                    |
| emoji        | character varying, validated against a fixed set (`ReactionEmojiEnum`: 👍 ❤️ 🙏 🎉 👏) |

**Unique constraint:** `(announcement, member)` — one reaction per member per announcement. Reacting again with a different emoji updates the existing row rather than adding a second one (not Slack-style multi-emoji-per-user).

### Group

| Field       | Type            | Notes                                                   |
|-------------|-----------------|----------------------------------------------------------|
| id          | UUID            | PK                                                        |
| name        | string          | Unique                                                    |
| description | text \| null    | Optional                                                  |
| createdBy   | Member \| null  | ManyToOne, SET NULL on delete. Column is `created_by_id` (see migration note below). |
| members     | GroupMember[]   | OneToMany reverse side                                    |

### GroupMember

Join entity between `Group` and `Member`. `@Unique(['group', 'member'])` prevents duplicate membership rows.

| Field    | Type            | Notes                          |
|----------|-----------------|----------------------------------|
| id       | UUID            | PK                                |
| group    | Group           | ManyToOne, CASCADE on delete      |
| member   | Member          | ManyToOne, CASCADE on delete      |
| addedBy  | Member \| null  | ManyToOne, SET NULL on delete. Column is `added_by_id` (see migration note below). |

**Migration note:** `AddGroupsModule` originally created these FK columns as `created_by`/`added_by`. Neither entity
has an explicit `@JoinColumn`, so `SnakeNamingStrategy.joinColumnName` (which names join columns as
`<relation>_<referencedColumn>`) expects `created_by_id`/`added_by_id` at runtime — the mismatch caused
`column grp.created_by_id does not exist` whenever the relation was selected (e.g. the announcements list with
`audience=GROUP`). Fixed by migration `FixGroupsForeignKeyColumnNames`, which renames both columns; per the
immutable-migrations rule the original `AddGroupsModule` file was left untouched.

### BirthdayWish

Persists birthday wishes permanently, grouped by year. The birthday announcement expires but wishes remain readable
indefinitely.

| Field     | Type           | Notes                                         |
|-----------|----------------|-----------------------------------------------|
| id        | UUID           | PK                                            |
| message   | text           | DOMPurify-sanitized plain text, max 500 chars |
| recipient | Member         | ManyToOne, CASCADE on delete                  |
| sender    | Member \| null | ManyToOne, SET NULL on delete                 |
| year      | smallint       | Calendar year the wish was sent               |

**Unique constraint:** (recipient, sender, year) — one wish per sender per recipient per year.

### AdminRole

A named role in the admin RBAC system. Carries a list of permissions.

| Field       | Type              | Notes                                                   |
|-------------|-------------------|---------------------------------------------------------|
| id          | UUID              | PK                                                      |
| name        | string            | Unique (e.g. "SuperAdmin", "ContentManager")            |
| description | string            | Optional                                                |
| permissions | AdminPermission[] | `simple-array` column; subset of `AdminPermission` enum |
| admins      | Admin[]           | OneToMany                                               |

### Admin

Links a church member to an admin role. This is the portal-access record — it is separate from the member's church
role (MEMBER/WORKER).

| Field     | Type      | Notes                                                                         |
|-----------|-----------|-------------------------------------------------------------------------------|
| id        | UUID      | PK                                                                            |
| member    | Member    | OneToOne, CASCADE on delete — the admin must be a church member               |
| adminRole | AdminRole | ManyToOne, RESTRICT on delete — deleting a role with active admins is blocked |
| isActive  | boolean   | Soft-disable without revoking the role                                        |

**Relationship:** A church worker can also be an admin. Having `role=WORKER` on the Member entity and an `Admin` record
are independent. Mobile app routes check `role=WORKER`; admin portal routes check the `admins` table.

**Email notifications:**

- `POST /admin/users` (grant) — sends a `welcome-admin` email to the member containing their email address and the admin
  portal login URL. Password is not re-generated; the message instructs the user to log in with their existing account
  password.
- `POST /admin/users/:id/revoke` — sends an `account-deactivated` email to the affected member.

### AuditLog

Immutable record of every admin write action.

| Field       | Type           | Notes                                                                                        |
|-------------|----------------|----------------------------------------------------------------------------------------------|
| id          | UUID           | PK                                                                                           |
| action      | AuditAction    | String enum — see Audit Actions below                                                        |
| actor       | Member \| null | ManyToOne FK to `members.id`, SET NULL on member delete — the admin who performed the action |
| targetId    | UUID \| null   | The ID of the affected resource (member, event, department, etc.)                            |
| targetEmail | string \| null | Email snapshot for identity tracing when targetId alone is insufficient                      |
| metadata    | jsonb \| null  | Action-specific details (role changed, count of records affected, etc.)                      |
| createdAt   | timestamptz    | Auto-set on insert                                                                           |

**Indexes:** `action`, `actor` (FK column `actorId`), `targetId`, `createdAt`.

**Write path:** `AuditLogService.log()` enqueues a job on the `audit-log` Bull queue (fire-and-forget, 3 attempts, exponential backoff). `AuditLogProcessor` handles the actual DB write asynchronously. Failed writes are retained in Redis (`removeOnFail: false`) and visible in Bull Board.

**Actor traceability:** The `actor` relation is a real FK to the `members` table. When building an audit log API, load
the relation (`relations: ['actor']`) to access actor name and email. If the member account is deleted, `actor` is set
to `null` but the log record and all other fields are preserved.

### EmailLog

Append-only delivery record written by the Bull email processor on every terminal outcome (success or permanent
failure). Used for debugging delivery issues and compliance — answers "was this OTP email actually sent?".

| Field          | Type        | Notes                                                                    |
|----------------|-------------|--------------------------------------------------------------------------|
| id             | UUID        | PK                                                                       |
| recipient      | string      | To address(es), comma-joined if multiple                                 |
| subject        | string      | Email subject line                                                        |
| status         | varchar     | `sent` \| `failed`                                                       |
| jobId          | string      | Bull queue job ID — correlate with Redis for in-flight inspection        |
| errorMessage   | text        | SMTP/API error on permanent failure; null on success                     |
| attemptsMade   | int         | Number of send attempts before terminal outcome (max 5)                  |
| provider       | varchar     | `gmail` \| `smtp` \| `resend` \| `sendgrid` \| `mailgun` — which email provider delivered (or attempted) the message |
| source         | varchar \| null | `tenant` (sent via the church's own BYOK-configured provider) \| `platform_default` (no tenant provider configured, Discuva's `EMAIL_PROVIDER` default was used instead) \| `null` for rows written before this column existed |
| createdAt      | timestamptz | When the terminal outcome was recorded                                   |

**Written by:** `@OnQueueCompleted` (status = `sent`) and `@OnQueueFailed` (status = `failed`, only on the final
attempt after all retries are exhausted). Transient failures that Bull subsequently retries do **not** produce a log
row — only the final outcome is recorded.

**Provider/source resolution:** `EmailProcessor.handleSend` resolves the actual provider and source (`tenant` vs
`platform_default`) before attempting the send, and persists both onto the job's own data via `job.update()`. This
is what lets `onFailed` — which has no return value to read, since a thrown `sendMail()` call means `handleSend`
never reaches its `return` statement — log the provider/source that was *actually* being attempted rather than
guessing. (Previously `onFailed` hardcoded the platform default's name unconditionally, mislabeling any failed send
that was actually attempted through a tenant's own BYOK provider — fixed by this job.update() persistence.)

**Indexes:** `recipient`, `status`, `createdAt`.

**Audit Actions:**
`ADMIN_CREATED` · `MEMBER_SIGNED_UP` · `MEMBER_LOGIN` · `MEMBER_LOGOUT` · `ADMIN_LOGIN` · `PASSWORD_CHANGED` ·
`PASSWORD_RESET_REQUESTED` · `PASSWORD_RESET_COMPLETED` · `ADMIN_PASSWORD_RESET` · `WORKER_PROMOTED` ·
`WORKER_REVOKED` · `MEMBER_ACTIVATED` · `MEMBER_DEACTIVATED` · `MEMBER_UPDATED` · `MEMBER_CREATED_BY_ADMIN` · `MEMBER_PHOTO_UPDATED` ·
`MEMBER_PHOTO_REMOVED` · `ATTENDANCE_ADMIN_MARKED` ·
`PRAYER_REQUEST_SUBMITTED` · `PRAYER_REQUEST_STATUS_UPDATED` · `TESTIMONY_SUBMITTED` · `DEVICE_PURGED` ·
`DEVICE_RESET_REQUESTED` · `DEVICE_RESET_COMPLETED` ·
`ANNOUNCEMENT_CREATED` · `ANNOUNCEMENT_UPDATED` · `ANNOUNCEMENT_DELETED` · `EVENT_CREATED` · `EVENT_UPDATED` ·
`EVENT_DELETED` · `NOTE_CREATED` · `NOTE_UPDATED` · `NOTE_DELETED` · `LEAVE_APPROVED` · `LEAVE_REJECTED` ·
`DEPARTMENT_CREATED` · `DEPARTMENT_UPDATED` · `DEPARTMENT_DELETED` · `DEPARTMENT_LEAD_ASSIGNED` ·
`DEPARTMENT_LEAD_REMOVED` · `WORKER_PROFILE_UPDATED` · `ADMIN_ROLE_CREATED` · `ADMIN_ROLE_UPDATED` ·
`ADMIN_ROLE_DELETED` · `ADMIN_USER_CREATED` · `ADMIN_USER_UPDATED` · `ADMIN_USER_DEACTIVATED`
`TITHE_BATCH_QUEUED` · `TITHE_UNMATCHED_RESOLVED` · `TITHE_UNMATCHED_DISMISSED` · `TITHE_DISPUTE_APPROVED` · `TITHE_DISPUTE_REJECTED` · `TITHE_ACCOUNT_CREATED` · `TITHE_ACCOUNT_UPDATED` ·
`FINANCE_CATEGORY_CREATED` · `FINANCE_CATEGORY_UPDATED` · `FINANCE_REQUEST_CREATED` · `FINANCE_REQUEST_APPROVED` · `FINANCE_REQUEST_REJECTED` · `FINANCE_PROOF_ATTACHED` ·
`TITHE_PROOF_SUBMITTED` · `TITHE_PROOF_CONFIRMED` · `TITHE_PROOF_DECLINED` · `TITHE_PROOF_EXPIRED_PURGED` ·
`CHURCH_SETTING_UPDATED` · `INCIDENT_REPORT_CREATED` · `INCIDENT_REPORT_STATUS_UPDATED` ·
`ASSET_CREATED` · `ASSET_UPDATED` · `ASSET_MAINTENANCE_SCHEDULED` · `ASSET_MAINTENANCE_LOGGED` · `ASSET_INVENTORY_UPDATED` ·
`GUEST_CONVERTED_TO_MEMBER`

### EventReminder

Optional reminder schedule attached to a service slot. Multiple reminders can be configured per slot (one per interval
preset).

| Field          | Type                       | Notes                                                |
|----------------|----------------------------|------------------------------------------------------|
| id             | UUID                       | PK                                                                                         |
| serviceSlot    | ServiceSlot                | ManyToOne, CASCADE on delete                                                               |
| audience       | AnnouncementAudienceEnum   | ALL \| WORKERS_ONLY \| DEPARTMENT                                                          |
| department     | Department \| null         | Required when audience=DEPARTMENT                                                          |
| intervalPreset | ReminderIntervalPresetEnum | 15m \| 30m \| 1h \| 3h \| 24h \| 48h                                                      |
| enabled        | boolean                    | Admin can disable without deleting                                                         |
| lastSentAt     | timestamptz \| null        | Set when the reminder fires; prevents double-sending                                       |
| fireAt         | timestamptz \| null        | Pre-computed: `slot.startTime − preset_minutes`. Set on create and on interval preset update; used by the dispatch cron to filter in SQL (no in-memory filtering) |

**Unique constraint:** (serviceSlot, intervalPreset) — one reminder per preset per slot.

### SundaySchoolClass

A permanent Sunday School class. Members are assigned indefinitely (no graduation).

| Field       | Type           | Notes                                             |
|-------------|----------------|---------------------------------------------------|
| id          | UUID           | PK                                                |
| name        | string         |                                                   |
| description | string         | Optional                                          |
| teacher     | Member \| null | ManyToOne, nullable — the appointed class teacher |

**Delete guard (class):** Blocked if any members are assigned or any sessions have been recorded. Remove all members and sessions before deleting.

**Delete guard (session):** Blocked if any attendance records exist for the session. Sessions with attendance cannot be deleted — this prevents silent cascade-deletion of historical attendance data.

### SundaySchoolMember

Links a church member to a Sunday School class.

| Field             | Type              | Notes          |
|-------------------|-------------------|----------------|
| id                | UUID              | PK             |
| member            | Member            | ManyToOne      |
| sundaySchoolClass | SundaySchoolClass | ManyToOne      |
| assignedAt        | timestamptz       | auto timestamp |

**Unique constraint:** (member, sundaySchoolClass)

### SundaySchoolSession

One session (meeting) of a Sunday School class.

| Field             | Type                | Notes                                                |
|-------------------|---------------------|------------------------------------------------------|
| id                | UUID                | PK                                                   |
| sundaySchoolClass | SundaySchoolClass   | ManyToOne                                            |
| sessionDate       | string (YYYY-MM-DD) | Date of the session                                  |
| selfMarkClosesAt  | timestamptz \| null | Non-null and in the future means the self-mark window is open |
| notes             | string              | Optional session notes                               |

**Unique constraint:** (sundaySchoolClass, sessionDate)

### SundaySchoolAttendance

One attendance record per member per session.

| Field           | Type                         | Notes                                                           |
|-----------------|------------------------------|-----------------------------------------------------------------|
| id              | UUID                         | PK                                                              |
| session         | SundaySchoolSession          | ManyToOne                                                       |
| member          | Member                       | ManyToOne                                                       |
| status          | SundaySchoolAttendanceStatus | PRESENT \| ABSENT \| EXCUSED                                    |
| markedByTeacher | boolean                      | True if a teacher/staff marked the record; false if self-marked |
| markedAt        | timestamptz                  |                                                                 |

**Unique constraint:** (session, member)

### ChildAgeGroup

Defines an age bracket for automatic child classification.

| Field        | Type   | Notes                                                                                                                            |
|--------------|--------|----------------------------------------------------------------------------------------------------------------------------------|
| id           | UUID   | PK                                                                                                                               |
| name         | string | e.g. "Nursery", "Toddlers"                                                                                                       |
| minAgeMonths | int    | Inclusive lower bound in months                                                                                                  |
| maxAgeMonths | int    | Inclusive upper bound in months                                                                                                  |
| displayOrder | int    | UI sort order — lower numbers appear first. Use sequential integers (1, 2, 3…) to control the display order across age brackets. |

**Delete guard:** Deleting an age group is blocked if any child profiles are directly assigned to it or to any of its
class groups. This prevents silent orphaning — the admin must reassign or remove the affected children first.
Internally, `ChildClassGroup` rows CASCADE on age-group delete; `ChildProfile.ageGroup` and `ChildProfile.classGroup`
are SET NULL on delete.

### ChildClassGroup

A physical class room or group within an age group.

| Field       | Type          | Notes                          |
|-------------|---------------|--------------------------------|
| id          | UUID          | PK                             |
| name        | string        | e.g. "Nursery Room A"          |
| ageGroup    | ChildAgeGroup | ManyToOne, CASCADE on delete   |
| capacity    | int \| null   | Optional room capacity         |
| teacherNote | text \| null  | Optional notes for the teacher |

**Delete guard:** Deleting a class group is blocked if any child profiles are currently assigned to it. Reassign
children before deleting.

### ChildProfile

The central record for a registered child.

| Field        | Type                | Notes                                    |
|--------------|---------------------|------------------------------------------|
| id           | UUID                | PK                                       |
| firstname    | string              |                                          |
| lastname     | string              |                                          |
| dateOfBirth  | string (YYYY-MM-DD) | Used for automatic age-group assignment  |
| ageGroup     | ChildAgeGroup       | ManyToOne — auto-assigned from DOB       |
| classGroup   | ChildClassGroup     | ManyToOne — auto-assigned from age group |
| photoUrl     | string \| null      | Optional                                 |
| specialNotes | string \| null      | Allergies, medical info, etc.            |
| registeredBy | Member \| null      | ManyToOne, nullable                      |
| guardians    | ChildGuardian[]     | OneToMany                                |

### ChildGuardian

A guardian or authorised pickup person for a child.

| Field              | Type                     | Notes                                                                                 |
|--------------------|--------------------------|---------------------------------------------------------------------------------------|
| id                 | UUID                     | PK                                                                                    |
| child              | ChildProfile             | ManyToOne                                                                             |
| fullName           | string                   |                                                                                       |
| relationship       | GuardianRelationshipEnum | MOTHER \| FATHER \| GRANDPARENT \| SIBLING \| UNCLE \| AUNT \| FAMILY_FRIEND \| OTHER |
| phoneNumber        | string                   |                                                                                       |
| email              | string \| null           | Direct email; resolved at runtime as `guardian.email ?? guardian.member.email`        |
| member             | Member \| null           | ManyToOne, nullable — links guardian to a church member account                       |
| photoUrl           | string \| null           | Optional                                                                              |
| isAuthorizedPickup | boolean                  | Whether this guardian is allowed to pick up the child                                 |

### ChildCheckIn

One check-in/check-out record per child per session.

| Field            | Type                   | Notes                                                         |
|------------------|------------------------|---------------------------------------------------------------|
| id               | UUID                   | PK                                                            |
| child            | ChildProfile           | ManyToOne                                                     |
| serviceSlot      | ServiceSlot \| null    | ManyToOne, nullable                                           |
| pickupCode       | string (6 chars)       | Unique per check-in; sent to guardians via email              |
| status           | ChildCheckInStatusEnum | CHECKED_IN \| CHECKED_OUT \| FLAGGED                          |
| checkinTime      | timestamptz            |                                                               |
| checkoutTime     | timestamptz \| null    | Set on checkout                                               |
| droppedOffBy     | ChildGuardian \| null  | ManyToOne, nullable                                           |
| droppedOffByName | string                 | Name captured at drop-off                                     |
| pickedUpBy       | ChildGuardian \| null  | ManyToOne, nullable — set on checkout                         |
| pickedUpByName   | string \| null         | Name captured at pickup                                       |
| checkedInBy      | Member \| null         | ManyToOne, nullable — staff member who performed the check-in |
| flagReason       | string \| null         | Reason if status = FLAGGED                                    |

### TitheAccount

Finance-team-managed list of bank accounts members can pay tithes into. Each account carries its own currency so the church can accept payments in multiple currencies (e.g. NGN, USD).

| Field         | Type    | Notes                                                        |
|---------------|---------|--------------------------------------------------------------|
| id            | UUID    | PK                                                           |
| bankName      | string  |                                                              |
| accountNumber | string  | Indexed                                                      |
| accountName   | string  |                                                              |
| currency      | string  | ISO 4217 code (3 chars). Indexed.                            |
| description   | string \| null | Optional note shown to members                        |
| isActive      | boolean | Default `true`. Inactive accounts are hidden from members. Indexed. |

**Indexes:** `idx_tithe_accounts_account_number`, `idx_tithe_accounts_currency`, `idx_tithe_accounts_is_active`.

### TitheUploadBatch

A batch record created when the finance team uploads an Excel file of tithe payments. Each batch is tied to a specific `TitheAccount`, so all records in the batch are credited to that account.

| Field         | Type               | Notes                                            |
|---------------|--------------------|--------------------------------------------------|
| id            | UUID               | PK                                               |
| uploadedBy    | Admin              | ManyToOne                                        |
| titheAccount  | TitheAccount       | ManyToOne (non-nullable, RESTRICT)               |
| fileName      | string             |                                                  |
| status        | TitheBatchStatus   | PENDING \| PROCESSING \| COMPLETED \| FAILED     |
| totalRows     | int                | Total rows in the spreadsheet                    |
| matchedRows   | int                | Rows matched to a member                         |
| unmatchedRows | int                | Rows with no member match                        |
| disputedRows  | int                | Rows flagged as possible duplicates              |
| rows          | jsonb \| null      | Parsed row data stored for safe requeue          |
| errorMessage  | string \| null     | Error detail on FAILED batches                   |
| processedAt   | timestamptz \| null| Set when processing completes                    |

### TitheRecord

A confirmed tithe payment matched to a member.

| Field       | Type    | Notes                                  |
|-------------|---------|----------------------------------------|
| id          | UUID    | PK                                     |
| member      | Member  | ManyToOne. Indexed.                              |
| batch       | TitheUploadBatch | ManyToOne. Indexed.                |
| amount      | decimal (12,2)  |                               |
| paymentDate | date    |                                        |
| reference   | string \| null | Optional bank reference        |
| bankName    | string \| null | Sender's bank from the CSV column — not the destination account |
| source      | `MANUAL_PROOF` \| `PAYMENT_GATEWAY` | `MANUAL_PROOF` for CSV batch/proof-of-payment uploads, `PAYMENT_GATEWAY` for online checkout (see Giving Checkout Module) |
| externalReference | string \| null | Only set for `PAYMENT_GATEWAY` rows — the `GivingCheckoutSession` id, which is the *same* reference string sent to the vendor at checkout (`GivingCheckoutService.initiateCheckout`'s `giving_{uuid}` reference) — so it's what shows up in the church's own Paystack/Flutterwave/etc. dashboard, genuinely reconcilable. `GET /admin/tithes/records`'s `search` param matches against it (and `reference`) in addition to member name/email; the admin UI's Records tab Reference field displays `reference ?? externalReference` (the two are never both set on one row) since `reference` alone stays null for every gateway-sourced record. |
| paymentChannel | string \| null | Only set for `PAYMENT_GATEWAY` rows — the specific vendor (`paystack`/`flutterwave`/`kora`/`stripe`) the payment cleared through. Admin UI (`/finances/tithes`, Records tab) surfaces this alongside the Source badge, and it's included as its own column in the Excel export — needed for settlement/reconciliation, since two different gateways landing in two different merchant accounts both otherwise show only a generic "Gateway" source. |
| givingOption | GivingOption \| null | ManyToOne, nullable, `SET NULL`. Only ever set for `PAYMENT_GATEWAY` rows where the member designated a purpose at checkout (see GivingOption below) — `null` means "General Giving," not a data gap. |

**Duplicate detection:** `(memberId, paymentDate, amount)` — if all three match an existing record, the row is flagged as a dispute instead. The destination bank account is inherited from the batch's `titheAccount`.

**Online giving purpose categorization — GivingOption vs. Pledge (never both):** at checkout, a member may optionally designate the payment either toward a `GivingOption` (Tithe/Offering/General Giving/Building Fund/etc. — admin-curated, see GivingOption below) or toward one of their own active `Pledge`s — never both (`InitiateGivingCheckoutDto` rejects a request carrying both `givingOptionId` and `pledgeId`). A `GivingOption` designation creates this `TitheRecord` with `givingOption` set. A `Pledge` designation does **not** create a `TitheRecord` at all — it creates a `PledgeContribution` (status `CONFIRMED` directly, no admin review, since the webhook already verified the money cleared) via `PledgeService.recordConfirmedContribution`, keeping pledge fulfillment and general giving as genuinely separate ledgers. Designating toward a pledge requires the member to already have an **ACTIVE** `Pledge` for that campaign — checkout never auto-creates one on the fly.

**Indexes:** `member_id`, `batch_id` (single-column). Composite `IDX_tithe_records_member_payment` on `(member_id, payment_date)` for member giving history range queries.

### TitheUnmatchedRecord

Rows from a batch where no member matched the email address.

| Field         | Type                    | Notes                                        |
|---------------|-------------------------|----------------------------------------------|
| id            | UUID                    | PK                                           |
| batch         | TitheUploadBatch        | ManyToOne                                    |
| rawEmail      | string                  | Email from the spreadsheet                   |
| amount        | decimal (12,2)          |                                              |
| paymentDate   | date                    |                                              |
| reference     | string \| null          |                                              |
| bankName      | string \| null          |                                              |
| status        | TitheUnmatchedStatus    | PENDING \| MATCHED \| DISMISSED              |
| matchedMember | Member \| null          | Set when manually resolved                   |
| resolvedBy    | Admin \| null           | Set when manually resolved                   |
| resolvedAt    | timestamptz \| null     |                                              |

### TitheDisputeRecord

Rows that matched a member but would duplicate an existing `TitheRecord`.

| Field          | Type               | Notes                                   |
|----------------|--------------------|-----------------------------------------|
| id             | UUID               | PK                                      |
| batch          | TitheUploadBatch   | ManyToOne                               |
| existingRecord | TitheRecord        | ManyToOne — the conflicting record      |
| member         | Member             | ManyToOne                               |
| amount         | decimal (12,2)     |                                         |
| paymentDate    | date               |                                         |
| reference      | string \| null     |                                         |
| bankName       | string \| null     |                                         |
| status         | TitheDisputeStatus | PENDING \| APPROVED \| REJECTED         |
| reviewedBy     | Admin \| null      |                                         |
| reviewedAt     | timestamptz \| null|                                         |

### TithePaymentProof

A member-submitted proof of tithe payment awaiting finance-team review. Files are stored in Cloudinary and automatically purged after a configurable number of days (default 90, controlled by `TITHE_PROOF_EXPIRY_DAYS`).

| Field        | Type             | Notes                                                 |
|--------------|------------------|-------------------------------------------------------|
| id           | UUID             | PK                                                    |
| member       | Member           | ManyToOne. Indexed.                                   |
| titheAccount | TitheAccount     | ManyToOne (non-nullable, RESTRICT). Indexed.          |
| amount       | decimal (12,2)   |                                                       |
| paymentDate  | date             | Indexed.                                              |
| reference    | string \| null   |                                                       |
| proofUrl     | string           | Cloudinary secure URL                                 |
| publicId     | string           | Cloudinary public ID (used for deletion)              |
| resourceType | string           | Cloudinary resource type returned at upload           |
| status       | TitheProofStatus | PENDING \| CONFIRMED \| DECLINED                      |
| reviewedBy   | Admin \| null    |                                                       |
| reviewedAt   | timestamptz \| null |                                                    |
| financeNote  | string \| null   | Reason supplied when declining                        |
| expiresAt    | timestamptz      | Set to `TITHE_PROOF_EXPIRY_DAYS` days from submission (default 90); file purged on expiry |

### FinanceCategory

Admin-managed list of expense categories used on finance requests.

| Field       | Type   | Notes  |
|-------------|--------|--------|
| id          | UUID   | PK     |
| name        | string | Unique |
| description | string \| null |   |

### FinanceRequest

An expense request raised by a department head (HOD).

| Field                | Type                 | Notes                                              |
|----------------------|----------------------|----------------------------------------------------|
| id                   | UUID                 | PK                                                 |
| requestedBy          | Member               | ManyToOne — the HOD who submitted the request      |
| department           | Department           | ManyToOne                                          |
| category             | FinanceCategory      | ManyToOne                                          |
| reason               | text                 | Justification for the expense                      |
| amount               | decimal (12,2)       |                                                    |
| recipientBankName    | string               |                                                    |
| recipientAccountNumber | string             |                                                    |
| recipientAccountName | string               |                                                    |
| attachmentUrl        | string \| null       | Cloudinary URL for optional budget/invoice upload  |
| attachmentPublicId   | string \| null       | Cloudinary public ID for attachment (deletion)     |
| attachmentResourceType | string \| null     | Cloudinary resource type returned at upload        |
| status               | FinanceRequestStatus | PENDING \| APPROVED \| REJECTED                    |
| reviewedBy           | Admin \| null        | Set on approve/reject                              |
| reviewedAt           | timestamptz \| null  |                                                    |
| rejectionReason      | text \| null         | Populated on rejection                             |
| proofUrl             | string \| null       | Cloudinary URL for payment proof, set post-approval|
| proofPublicId        | string \| null       | Cloudinary public ID for proof (deletion)          |
| proofResourceType    | string \| null       | Cloudinary resource type for proof                 |
| journalEntry         | JournalEntry \| null | ManyToOne, SET NULL — set when a finance-team admin opts to post this request's payment to the ledger at proof-attachment time; see Finance Request Module below |

### FirstTimer

A visitor recorded by a follow-up team worker or admin during or after a service.

| Field                | Type                    | Notes                                                                      |
|----------------------|-------------------------|----------------------------------------------------------------------------|
| id                   | UUID                    | PK                                                                         |
| firstname            | string                  |                                                                            |
| lastname             | string                  |                                                                            |
| phone                | string                  |                                                                            |
| email                | string \| null          | Optional                                                                   |
| source               | FirstTimerSourceEnum    | WALK_IN \| ONLINE \| REFERRAL                                              |
| wantsToJoinChurch    | boolean                 | Default `false`                                                            |
| enjoyedAboutChurch   | text \| null            | What the visitor enjoyed                                                   |
| wantsToJoinWorkforce | boolean                 | Default `false`                                                            |
| notes                | text \| null            | Additional follow-up notes                                                 |
| visitedEvent         | Event \| null           | ManyToOne, SET NULL on delete                                              |
| createdByMember      | Member \| null          | ManyToOne, SET NULL on delete — the follow-up worker who created the record|
| createdByAdmin       | Admin \| null           | ManyToOne, SET NULL on delete — the admin who created the record           |
| convertedMember      | Member \| null          | ManyToOne, SET NULL on delete — linked when the first-timer becomes a member|
| convertedAt          | timestamptz \| null     | Timestamp when admin marked this first-timer as converted                  |
| inviteSentAt         | timestamptz \| null     | Timestamp when membership invitation email was last sent; guards against duplicates |
| followUpTask         | FollowUpTask            | OneToOne — auto-created on registration                                    |
| visits               | FirstTimerVisit[]       | OneToMany — return visit records                                           |

### FollowUpTask

A task assigned to a follow-up team worker to engage a first-timer or online non-responder.

| Field        | Type                    | Notes                                                                                  |
|--------------|-------------------------|----------------------------------------------------------------------------------------|
| id           | UUID                    | PK                                                                                     |
| type         | FollowUpTaskTypeEnum    | FIRST_TIMER \| ONLINE_NO_RESPONSE \| MANUAL                                            |
| status       | FollowUpTaskStatusEnum  | PENDING \| IN_PROGRESS \| COMPLETED \| UNREACHABLE                                     |
| firstTimer   | FirstTimer \| null      | OneToOne, CASCADE on delete — set when type=FIRST_TIMER                                |
| member       | Member \| null          | ManyToOne, SET NULL on delete — set when type=ONLINE_NO_RESPONSE. Indexed.             |
| event        | Event \| null           | ManyToOne, SET NULL on delete — event context. Indexed.                                |
| assignedTo   | WorkerProfile           | ManyToOne, RESTRICT on delete — must be a FOLLOW_UP department worker                  |
| outcome      | FollowUpOutcomeEnum \| null | JOINED \| DECLINED \| NO_ANSWER \| PRAYED_WITH                                     |
| outcomeNotes | text \| null            |                                                                                        |
| dueDate        | date \| null            | Optional target date                                                                   |
| notes          | FollowUpNote[]          | OneToMany                                                                              |
| lastActivityAt | timestamptz             | Updated whenever a note is added or status changes; used to detect inactive tasks      |

**Round-robin assignment:** The worker in the FOLLOW_UP department with the fewest open tasks (PENDING or IN_PROGRESS) is automatically selected. If no eligible worker exists, the API returns 400.

### FollowUpNote

A note added by the assigned worker during follow-up interactions.

| Field    | Type            | Notes                              |
|----------|-----------------|------------------------------------|
| id       | UUID            | PK                                 |
| task     | FollowUpTask    | ManyToOne, CASCADE on delete. Indexed. |
| addedBy       | WorkerProfile \| null | ManyToOne, SET NULL on delete                                    |
| content       | text                  |                                                                  |
| contactMethod | ContactMethodEnum \| null | PHONE_CALL \| WHATSAPP \| IN_PERSON \| SMS \| EMAIL — optional |

### FirstTimerVisit

Records each return visit a first-timer makes before or after converting.

| Field     | Type              | Notes                                           |
|-----------|-------------------|-------------------------------------------------|
| id        | UUID              | PK                                              |
| firstTimer | FirstTimer       | ManyToOne, CASCADE on delete. Indexed.          |
| event     | Event \| null     | ManyToOne, SET NULL on delete — event attended. Indexed. |
| visitedAt | date              | YYYY-MM-DD — date of the visit                  |
| notes     | text \| null      | Optional observation from the admin             |

### Convert

An evangelism outreach contact — not assumed to be an existing `Member`. See the Evangelism Module section below.

| Field            | Type              | Notes                                                                 |
|------------------|-------------------|--------------------------------------------------------------------------|
| id               | UUID              | PK                                                                        |
| name             | varchar           | Required — the only mandatory field on upload                            |
| phone            | varchar \| null   |                                                                            |
| notes            | text \| null      |                                                                            |
| status           | varchar           | UNSAVED \| SAVED \| UNDERGOING_DISCIPLESHIP, default UNSAVED. Indexed.    |
| onboardedBy      | Member \| null    | ManyToOne, SET NULL on delete. Indexed.                                   |
| onboardedByName  | varchar           | Snapshotted at upload time                                                |
| assignedTo       | WorkerProfile \| null | ManyToOne, SET NULL on delete. Indexed. Who is currently following up. |
| member           | Member \| null    | ManyToOne, SET NULL on delete — set once the convert joins as a member    |
| linkedAt         | timestamptz \| null |                                                                          |
| lastContactedAt  | timestamptz \| null | Denormalized, updated on every new ConvertFollowUpLog                   |

### ConvertFollowUpLog

One row per contact attempt with a convert — mirrors `FirstTimerVisit`.

| Field        | Type           | Notes                                    |
|--------------|----------------|-------------------------------------------|
| id           | UUID           | PK                                        |
| convert      | Convert        | ManyToOne, CASCADE on delete. Indexed.    |
| loggedBy     | Member \| null | ManyToOne, SET NULL on delete             |
| loggedByName | varchar        | Snapshotted at log time                   |
| note         | text \| null   |                                            |
| contactedAt  | timestamptz    | Default now                               |

---

### Sermon

Link-based sermon archive entry — no file uploads. See Sermon Module for the "Announce Live" trigger.

| Field       | Type            | Notes                                                        |
|-------------|-----------------|---------------------------------------------------------------|
| id          | UUID            | PK                                                             |
| title       | varchar         |                                                                 |
| speakerName | varchar         | Plain string, not a Member FK — guest speakers may not be in the system |
| date        | timestamptz     | Indexed; list is ordered newest-first                          |
| description | text \| null    |                                                                 |
| youtubeUrl  | varchar \| null | At least one of youtubeUrl/mixlrUrl required                   |
| mixlrUrl    | varchar \| null | At least one of youtubeUrl/mixlrUrl required                   |
| series      | varchar \| null | Indexed; plain string tag, filterable, not its own entity       |
| createdBy   | Admin \| null   | ManyToOne, SET NULL on delete                                   |

---

### ServiceProgramme

One programme per service slot (unique constraint on `service_slot_id`). Status flows: `DRAFT → LIVE → COMPLETED`.

| Field          | Type              | Notes                                   |
|----------------|-------------------|-----------------------------------------|
| id             | UUID              | PK                                      |
| serviceSlot    | ServiceSlot       | OneToOne, CASCADE on delete             |
| status         | varchar           | DRAFT \| LIVE \| COMPLETED              |
| saveAsTemplate | boolean           | If true, upserts template on completion |
| createdByAdmin | Admin \| null     | ManyToOne, SET NULL on delete           |

`GET /service-programme` and `GET /service-programme/:id` responses also include derived (non-persisted) fields for the admin frontend: `serviceSlotId`, `serviceSlotName` (`"{eventName} — {slotName}"`), and `slotCount`.

### ServiceProgrammeSlot

Ordered items within a programme. Frozen when session starts; runtime changes go to `ServiceSessionSlot`.

| Field            | Type          | Notes                             |
|------------------|---------------|-----------------------------------|
| id               | UUID          | PK                                |
| programme        | ServiceProgramme | ManyToOne, CASCADE on delete   |
| position         | int           | Zero-based order index            |
| type             | varchar       | SPEAKER \| BREAK                  |
| topic            | varchar \| null |                                 |
| member           | Member \| null | Assigned speaker; SET NULL on delete |
| guestName        | varchar \| null | Free-text name for non-members  |
| backupMember     | Member \| null | Backup speaker; SET NULL on delete |
| backupGuestName  | varchar \| null |                                 |
| allocatedMinutes | int           | Planned slot duration             |
| reminderSentAt   | timestamptz \| null | Set once the day-before reminder email has been sent; prevents duplicate sends |

### ServiceSession

One session per programme (unique constraint on `programme_id`). Created when a session starts.

| Field       | Type            | Notes                           |
|-------------|-----------------|---------------------------------|
| id          | UUID            | PK                              |
| programme   | ServiceProgramme | OneToOne, CASCADE on delete    |
| sessionCode | varchar         | Unique, e.g. `SVC-ABC123`       |
| status      | varchar         | LIVE \| COMPLETED               |
| startedAt   | timestamptz     |                                 |
| endedAt     | timestamptz \| null |                             |

**Redis anchor** (`session:{sessionCode}:anchor`, TTL 48 h after completion):
```json
{ "currentSlotPosition": 0, "slotStartedAt": 1718000000000, "slotBaseSeconds": 0,
  "status": "LIVE", "isPaused": false, "pausedAt": null }
```
Clients compute `elapsed = slotBaseSeconds + (Date.now() - slotStartedAt) / 1000`. No server-side ticker.

### ServiceSessionSlot

Snapshot of each programme slot at session start. Runtime overrides stored here; planned data stays on `ServiceProgrammeSlot`.

| Field                    | Type          | Notes                                  |
|--------------------------|---------------|----------------------------------------|
| id                       | UUID          | PK                                     |
| session                  | ServiceSession | ManyToOne, CASCADE                    |
| programmeSlot            | ServiceProgrammeSlot | ManyToOne, CASCADE              |
| position                 | int           |                                        |
| status                   | varchar       | PENDING \| IN_PROGRESS \| COMPLETED \| SKIPPED |
| adjustedAllocatedMinutes | int \| null   | Runtime time override                  |
| overriddenTopic          | varchar \| null |                                      |
| overriddenSpeakerName    | varchar \| null | Display-only; analytics still uses member FK |
| overriddenMember         | Member \| null | If actual speaker changed mid-session  |
| actualSeconds            | int \| null   | Measured speaking time                 |
| startedAt                | timestamptz \| null |                                  |
| completedAt              | timestamptz \| null |                                  |

### ServicePauseEntry

One row per pause event during a session.

| Field       | Type          | Notes                  |
|-------------|---------------|------------------------|
| id          | UUID          | PK                     |
| session     | ServiceSession | ManyToOne, CASCADE    |
| slotPosition| int           | Slot active at pause time |
| reason      | varchar       | ServicePauseReasonEnum |
| pausedAt    | timestamptz   |                        |
| resumedAt   | timestamptz \| null | Null until resumed |

### ServiceActionEntry

Audit log of all control actions taken during a session.

| Field             | Type          | Notes                      |
|-------------------|---------------|----------------------------|
| id                | UUID          | PK                         |
| session           | ServiceSession | ManyToOne, CASCADE        |
| actorRole         | varchar       | ADMIN \| WORKER \| PUBLIC_LINK |
| action            | varchar       | e.g. ADVANCE_SLOT, PAUSE, TIME_ADJUSTED, SLOTS_REORDERED |
| detail            | varchar \| null |                          |
| performedByMember | Member \| null | SET NULL on delete        |

### ServiceProgrammeTemplate

Auto-upserted when a session with `saveAsTemplate = true` completes. Minister assignments are always blank — only structure is saved.

| Field           | Type            | Notes                                    |
|-----------------|-----------------|------------------------------------------|
| id              | UUID            | PK                                       |
| name            | varchar         | e.g. "First Service"                     |
| serviceSlotName | varchar         | Match key for auto-suggestion            |
| slots           | jsonb           | `[{ position, type, topic, allocatedMinutes }]` |
| createdFrom     | ServiceProgramme \| null | SET NULL on delete               |

### ServiceHeadcount

Physical attendance count record for one service slot, broken down by demographic group.

| Field        | Type                    | Notes                                                          |
|--------------|-------------------------|----------------------------------------------------------------|
| id           | UUID                    | PK                                                             |
| serviceSlot  | ServiceSlot             | OneToOne (unique), CASCADE on delete                           |
| maleAdults   | int                     | Default 0                                                      |
| femaleAdults | int                     | Default 0                                                      |
| teenagers    | int                     | Default 0                                                      |
| children     | int                     | Default 0                                                      |
| mobileChurch | int                     | Default 0 — count from the mobile outreach venue (fixed group) |
| customGroups | jsonb                   | `Record<string, number>` — extensible free-form groups         |
| recordedBy   | Admin \| null           | ManyToOne, SET NULL on delete — admin who submitted the record |
| notes        | text \| null            | Optional context note for the record                           |

**Computed field:** `total` is not stored. It is computed on every read as the sum of all five fixed columns plus all values in `customGroups`. The value is appended to each response object.

### PrayerProgram

A named, configurable prayer program. All prayer entities (day configs, rules, meetings, roster entries) are scoped to a program, enabling multiple concurrent programs (e.g. "Morning Intercessory" for workers and "Friday Night" open to all members).

| Field               | Type            | Notes                                                                              |
|---------------------|-----------------|------------------------------------------------------------------------------------|
| id                  | UUID            | PK                                                                                 |
| name                | string          |                                                                                    |
| description         | text \| null    | Optional                                                                           |
| audience            | PrayerAudience  | WORKERS \| MEMBERS \| ALL — controls who may be assigned/self-select               |
| selectionWindowDays | int             | Days before meeting when self-selection opens. Default 7.                          |
| isActive            | boolean         | Inactive programs are excluded from normal operations. Default `true`.             |

**Audience rules:** `WORKERS`-audience programs use auto-assign; `MEMBERS`-audience programs use self-selection and manual assignment only; `ALL` programs combine both.

### PrayerScheduleConfig

Global configuration for the prayer roster module (legacy — predates multi-program support). One active record at a time. New installations use `PrayerProgram.selectionWindowDays` instead.

| Field               | Type    | Notes                                                            |
|---------------------|---------|------------------------------------------------------------------|
| id                  | UUID    | PK                                                               |
| selectionWindowDays | int     | Number of days before a meeting that self-selection is open. Default 7. |
| isActive            | boolean | Only one active config is used at a time                         |

### PrayerDayConfig

Defines which days of the week prayer meetings occur and their capacity/mode, scoped to a program.

| Field       | Type           | Notes                                                          |
|-------------|----------------|----------------------------------------------------------------|
| id          | UUID           | PK                                                             |
| program     | PrayerProgram  | ManyToOne, RESTRICT on delete. Indexed.                        |
| dayOfWeek   | int            | 0 = Sunday … 6 = Saturday (JS `Date.getDay`)                   |
| mode        | PrayerDayMode  | PHYSICAL \| VIRTUAL                                            |
| startTime   | string (HH:mm) | Default `00:00`                                                |
| endTime     | string (HH:mm) | Default `01:00`                                                |
| maxCapacity | int            | Max assignees for this day                                     |
| isActive    | boolean        | Inactive configs are skipped during generation                 |

**Unique constraint (application-level):** Only one active config per `(program, dayOfWeek)` pair.

### PrayerScheduleRule

Configurable rules that govern frequency and capacity requirements, scoped to a program.

| Field          | Type                      | Notes                                                             |
|----------------|---------------------------|-------------------------------------------------------------------|
| id             | UUID                      | PK                                                                |
| program        | PrayerProgram             | ManyToOne, RESTRICT on delete. Indexed.                           |
| type           | PrayerRuleType            | ROLE_FREQUENCY \| MIN_LEADERS_PER_MEETING \| MAX_PER_MEETING      |
| targetLeadType | DepartmentLeadTypeEnum \| null | `null` = applies to all workers; set for HOD/D_HOD overrides |
| value          | int                       | Times per month for ROLE_FREQUENCY; head-count for others         |
| description    | string                    | Human-readable label                                              |
| isActive       | boolean                   | Inactive rules are ignored during assignment                      |

**Seeded defaults (on the default program):** worker frequency = 1, HOD frequency = 2, D_HOD frequency = 2, min leaders per meeting = 1, max per meeting = 5.

### PrayerFixedAssignment

Permanently pins a worker to a specific prayer day across all months, within a program.

| Field         | Type           | Notes                                              |
|---------------|----------------|----------------------------------------------------|
| id            | UUID           | PK                                                 |
| workerProfile | WorkerProfile  | ManyToOne, CASCADE on delete                       |
| dayConfig     | PrayerDayConfig | ManyToOne, CASCADE on delete                      |
| isActive      | boolean        | Soft-disable without deleting the assignment       |

**Unique constraint:** `(workerProfile, dayConfig)` — one fixed assignment per worker per day config.

### PrayerMeeting

One concrete meeting per calendar date generated from a day config, scoped to a program.

| Field           | Type                | Notes                                               |
|-----------------|---------------------|-----------------------------------------------------|
| id              | UUID                | PK                                                  |
| program         | PrayerProgram       | ManyToOne, RESTRICT on delete. Indexed.             |
| date            | string (YYYY-MM-DD) | Actual meeting date. Indexed.                       |
| month           | int                 | Calendar month (1–12). Indexed.                     |
| year            | int                 | Calendar year. Indexed.                             |
| dayConfig       | PrayerDayConfig     | ManyToOne, RESTRICT on delete                       |
| status          | PrayerMeetingStatus | SCHEDULED \| COMPLETED \| CANCELLED. Indexed.       |
| selectionStatus | PrayerWindowStatus  | PENDING \| OPEN \| CLOSED. Indexed.                 |
| currentCapacity | int                 | Current number of assigned workers/members          |
| rosterEntries   | PrayerRosterEntry[] | OneToMany                                           |

### PrayerRosterEntry

One assignment of a worker or member to a prayer meeting. Exactly one of `workerProfile` or `member` is set; the other is null.

| Field              | Type                  | Notes                                                                                   |
|--------------------|-----------------------|-----------------------------------------------------------------------------------------|
| id                 | UUID                  | PK                                                                                      |
| workerProfile      | WorkerProfile \| null | ManyToOne, CASCADE on delete. Indexed. Null for member-only assignments.                |
| member             | Member \| null        | ManyToOne, CASCADE on delete. Indexed. Null for worker assignments.                     |
| meeting            | PrayerMeeting         | ManyToOne, CASCADE on delete. Indexed.                                                  |
| assignmentType     | PrayerAssignmentType  | FIXED \| SELF_SELECTED \| AUTO_ASSIGNED \| MANUAL                                       |
| status             | PrayerRosterStatus    | SCHEDULED \| RESCHEDULED                                                                |
| rescheduledFrom    | PrayerRosterEntry \| null | Self-referencing nullable FK, SET NULL on delete — tracks origin of rescheduled entries |
| reminderTwoDaySent | boolean               | 2-day-ahead reminder dispatched flag. Indexed (scheduler filter).                       |
| reminderDaySent    | boolean               | Day-of reminder dispatched flag. Indexed (scheduler filter).                            |

---

### RentalFacility

A bookable space (hall, room, etc.) owned by the congregation.

| Field       | Type    | Notes                              |
|-------------|---------|------------------------------------|
| id          | UUID    | PK                                 |
| name        | varchar | Unique display name                |
| description | text    | nullable                           |
| basePrice   | decimal | Price before discount (15,2)       |
| capacity    | int     | nullable — max occupancy           |
| isActive    | boolean | Soft-disable without deleting      |

### RentalPricingTier

One discount rule per member category. Unique on `memberCategory`.

| Field          | Type                  | Notes                                    |
|----------------|-----------------------|------------------------------------------|
| id             | UUID                  | PK                                       |
| memberCategory | RentalMemberCategory  | MEMBER \| WORKER \| LEADER \| PUBLIC — UNIQUE |
| discountType   | RentalDiscountType    | PERCENTAGE \| FLAT                       |
| discountValue  | decimal               | % value or flat amount (10,2)            |
| isActive       | boolean               |                                          |

### RentalAddon

Bookable extras (LED screen, décor, etc.) with an optional asset link.

| Field         | Type    | Notes                                         |
|---------------|---------|-----------------------------------------------|
| id            | UUID    | PK                                            |
| name          | varchar |                                               |
| description   | text    | nullable                                      |
| price         | decimal | Service charge, subject to discount (15,2)    |
| cautionAmount | decimal | Refundable deposit — never discounted (15,2)  |
| isActive      | boolean |                                               |
| asset         | Asset   | nullable FK → assets, SET NULL on delete      |

### RentalCalendarBlock

Admin-created blackout period on a facility (maintenance, church events, etc.).

| Field         | Type           | Notes                            |
|---------------|----------------|----------------------------------|
| id            | UUID           | PK                               |
| facility      | RentalFacility | ManyToOne, CASCADE on delete     |
| startDateTime | timestamptz    |                                  |
| endDateTime   | timestamptz    |                                  |
| reason        | text           | nullable                         |

### RentalBooking

A member's booking of a facility for a specific time window. Price snapshot is stored at creation time so later config changes do not affect existing bookings.

| Field                | Type                  | Notes                                                                 |
|----------------------|-----------------------|-----------------------------------------------------------------------|
| id                   | UUID                  | PK                                                                    |
| facility             | RentalFacility        | ManyToOne, RESTRICT on delete                                         |
| member               | Member                | ManyToOne, RESTRICT on delete                                         |
| startDateTime        | timestamptz           | Indexed                                                               |
| endDateTime          | timestamptz           |                                                                       |
| status               | RentalBookingStatus   | PENDING → CONFIRMED → IN_PROGRESS → COMPLETED \| CANCELLED \| REJECTED |
| memberCategory       | RentalMemberCategory  | Snapshot of category at booking time                                  |
| basePrice            | decimal               | Snapshot of facility base price                                       |
| discountType         | RentalDiscountType    | nullable — applied discount type                                      |
| discountValue        | decimal               | nullable — applied discount amount/percent                            |
| discountSource       | RentalDiscountSource  | NONE \| TIER \| OVERRIDE                                              |
| serviceFee           | decimal               | (base + addons) after discount                                        |
| cautionTotal         | decimal               | Sum of all caution amounts — never discounted                         |
| grandTotal           | decimal               | serviceFee + cautionTotal                                             |
| overrideDiscountType | RentalDiscountType    | nullable — admin override                                             |
| overrideDiscountValue| decimal               | nullable                                                              |
| overrideDiscountNote | text                  | nullable — reason for override                                        |
| purpose              | text                  | nullable                                                              |
| notes                | text                  | nullable — admin notes                                                |
| rejectionReason      | text                  | nullable                                                              |

### RentalBookingAddon

Junction between a booking and selected add-ons. Stores unit price/caution snapshots.

| Field      | Type          | Notes                                  |
|------------|---------------|----------------------------------------|
| id         | UUID          | PK                                     |
| booking    | RentalBooking | ManyToOne, CASCADE on delete           |
| addon      | RentalAddon   | ManyToOne, RESTRICT on delete          |
| quantity   | int           | Default 1                              |
| unitPrice  | decimal       | Snapshot of addon.price at booking time|
| unitCaution| decimal       | Snapshot of addon.cautionAmount        |

### RentalPayment

One payment line per booking (service fee + separate caution record if caution > 0). Tracks proof and refund lifecycle.

| Field      | Type               | Notes                                                     |
|------------|--------------------|-----------------------------------------------------------|
| id         | UUID               | PK                                                        |
| booking    | RentalBooking      | ManyToOne, CASCADE on delete. Indexed.                    |
| type       | RentalPaymentType  | SERVICE_FEE \| CAUTION                                    |
| amount     | decimal            |                                                           |
| status     | RentalPaymentStatus| PENDING → PAID; CAUTION can transition to REFUNDED        |
| paidAt     | timestamptz        | nullable                                                  |
| refundedAt | timestamptz        | nullable — set when caution returned                      |
| reference  | varchar            | nullable — bank ref / receipt number                      |
| proofUrl   | varchar            | nullable                                                  |

---

### Game

A reusable Kahoot-style quiz definition — created on the admin portal, can back multiple `GameSession`s over time.
`department`/`churchClass` are categorization only, not access control (see Games Module).

| Field       | Type                 | Notes                                                    |
|-------------|----------------------|-----------------------------------------------------------|
| id          | UUID                 | PK                                                         |
| title       | varchar              |                                                             |
| description | text \| null         |                                                             |
| status      | GameStatusEnum       | DRAFT \| LIVE_SESSION_ACTIVE \| ARCHIVED (ARCHIVED not yet exposed via any endpoint) |
| createdBy   | Admin \| null        | ManyToOne, SET NULL on delete                              |
| department  | Department \| null   | ManyToOne, SET NULL on delete — reporting/filtering only    |
| churchClass | ChurchClass \| null  | ManyToOne, SET NULL on delete — reporting/filtering only    |

### GameQuestion

| Field              | Type        | Notes                                          |
|---------------------|-------------|--------------------------------------------------|
| id                  | UUID        | PK                                                |
| game                | Game        | ManyToOne, CASCADE on delete. Indexed.            |
| order               | int         | Zero-based display/play order within the game     |
| questionText        | text        |                                                    |
| options             | jsonb       | Array of option strings, minimum 2                |
| correctOptionIndex  | int         | Index into `options`; validated on create/update  |
| points              | int         | Default 1000 — base score before the speed bonus  |
| timeLimitSeconds    | int         | Default 20                                        |

### GameSession

One "run" of a `Game`. `sessionCode` is the join credential (`GAME-XXXXXX`).

| Field                     | Type                    | Notes                                                |
|----------------------------|-------------------------|--------------------------------------------------------|
| id                         | UUID                    | PK                                                      |
| game                       | Game                    | ManyToOne, CASCADE on delete. Indexed.                  |
| sessionCode                | varchar, unique         |                                                          |
| status                     | GameSessionStatusEnum   | SCHEDULED \| LIVE \| ENDED (SCHEDULED not yet reachable — sessions start directly into LIVE) |
| hostAdmin                  | Admin \| null           | ManyToOne, SET NULL on delete — the only admin who can control the session |
| currentQuestionIndex       | int \| null             | Null before start                                       |
| currentQuestionStartedAt   | timestamptz \| null     | Server-side clock all participants are scored against   |
| startedAt / endedAt        | timestamptz \| null     |                                                          |

### GameParticipant

A member's membership in one `GameSession`, with their running score. `@Unique(['session','member'])` — joining
again just returns the existing row.

| Field       | Type          | Notes                                    |
|-------------|---------------|---------------------------------------------|
| id          | UUID          | PK                                            |
| session     | GameSession   | ManyToOne, CASCADE on delete. Indexed.        |
| member      | Member        | ManyToOne, CASCADE on delete                  |
| totalScore  | int           | Default 0; incremented per correct response   |

### GameResponse

One row per (session, question, participant) answer — the unique constraint is the DB-level backstop against
double-answering. Individual responses are not audit-logged (too high-frequency/low-stakes).

| Field                | Type            | Notes                                                  |
|-----------------------|-----------------|-----------------------------------------------------------|
| id                    | UUID            | PK                                                          |
| session               | GameSession     | ManyToOne, CASCADE on delete. Indexed.                      |
| question              | GameQuestion    | ManyToOne, CASCADE on delete                                |
| participant           | GameParticipant | ManyToOne, CASCADE on delete                                |
| selectedOptionIndex   | int             |                                                              |
| isCorrect             | boolean         |                                                              |
| pointsAwarded         | int             | 0 for incorrect; speed-weighted for correct (see Games Module) |
| answeredAt            | timestamptz     |                                                              |

**Unique constraint:** `(session, question, participant)`.

---

## 4. Authentication & Authorization

### Dual-Surface Sessions

The app has two independent entry points — the mobile app (`POST /auth/login`) and the admin portal (`POST /auth/admin-login`) — and each maintains its own session row in `member_sessions`. The `surface` column (`MEMBER | ADMIN`) is the discriminator; a unique constraint on `(member_id, surface)` ensures at most one active session per surface per user.

**JWT payload** now includes `aud` (audience) to identify the surface:

```json
{ "sub": "<memberId>", "role": "MEMBER|WORKER", "aud": "MEMBER|ADMIN" }
```

**Surface enforcement:**

- `JwtStrategy` calls `validateAccessToken(sub, aud)` — it looks up the session row for that specific `(memberId, surface)` pair. An admin token used on a mobile endpoint checks the `ADMIN` session; if the user has no admin session, the request is rejected with 401.
- `AdminGuard` additionally checks `request.user.surface === 'ADMIN'`. A member token (`aud: MEMBER`) used on an admin-portal endpoint is rejected with 403 before the admin DB lookup even runs.
- `POST /auth/logout` is surface-scoped: it reads `req.user.surface` from the validated token and deletes only that session row, leaving the other surface's session intact.
- Password reset and device reset/purge invalidate **both** surfaces simultaneously (credential change = full sign-out).

There is no `ADMIN` role in the JWT. Admin portal access is determined at the route level by `AdminGuard` looking up the `admins` table.

`validateAccessToken` returns `MemberAuth` which is set as `req.user`. For WORKER-role members, `req.user.workerProfileId` is populated from the loaded `workerProfile.id`. Worker-facing endpoints that need the worker's profile ID read it from `req.user.workerProfileId` — this is never embedded in the JWT itself. HOD status is not carried on `MemberAuth`; it is resolved once on `GET /auth/me` (see above) and can be cached by the client. Server-side HOD-gated endpoints query `department_leads` directly when they need it.

### Guards

- **ThrottlerGuard** — applied globally via `APP_GUARD`. Rate-limits every endpoint to `THROTTLE_LIMIT` requests per
  `THROTTLE_TTL_MS`-millisecond window per IP (defaults: 100 req / 60 s). Returns HTTP 429 when the limit is exceeded.
  The `GET /health` endpoint is exempt via `@SkipThrottle()`. `GET /service-session/:code/state` and
  `GET /service-session/:code/slots/:position` are overridden to 300 req/60s via `@Throttle()` — these are public,
  read-only routes; the override exists for the initial page-load fetch and the (now much less frequent) safety-net
  poll each live-session view keeps as a fallback — see the Socket.IO section below for why per-IP throttling was
  never the real scaling lever for this module, since a per-IP cap does nothing to bound *aggregate* load across the
  hundreds of distinct devices/IPs a single popular session's Audience view can attract.
- **JwtAuthGuard** — applied globally via `APP_GUARD`. All routes are protected unless decorated with `@Public()`.
- **PasswordChangeRequiredGuard** — applied globally via `APP_GUARD` (runs after `JwtAuthGuard`). Blocks all requests
  with HTTP 403 `PASSWORD_CHANGE_REQUIRED` if the authenticated user has `changedPassword = false` (i.e. they are on a
  system-generated temporary password). Exempt routes must be decorated with `@SkipPasswordChangeCheck()`:
  `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password`.
- **RolesGuard** — applied per-route via `@Roles(MemberRoleEnum.WORKER)`. Checks `request.user.role` for worker-only
  routes (mobile app).
- **AdminGuard** — applied per-route via `@UseGuards(AdminGuard)`. First checks `request.user.surface === 'ADMIN'` (rejects member tokens with 403), then queries the `admins` table to verify an active Admin record, then checks `@RequiresPermission(AdminPermission.X)` metadata. Sets `request.admin` for downstream use. Used exclusively on admin portal routes.
- **LocalAuthGuard** — used on `POST /auth/login` (mobile) and `POST /auth/admin-login` (web portal) to invoke the
  Passport local strategy.
- **RefreshJwtAuthGuard** — used on `POST /auth/refresh`.

### Token Lifecycle

Refresh token delivery and transport differ by surface:

| Surface | Refresh token on login | Refresh on `POST /auth/refresh` | Logout |
|---|---|---|---|
| **ADMIN** (web portal) | Set as `httpOnly; SameSite` cookie on `/v1/auth/refresh` path only — **not** in the response body | Cookie sent automatically by browser; new cookie set in response | Cookie cleared |
| **MEMBER / WORKER** (mobile) | Returned in response body (`refresh_token`) | Sent in `Authorization: Bearer` header | Session row cleared |

1. **Login** → receives `access_token` + `requires_password_change` (and `refresh_token` in body for mobile only). A surface-scoped session row is created (or updated) with a hashed refresh token. If `requires_password_change` is `true`, the client must redirect the user to `POST /auth/change-password` before allowing any other action.
2. **Access token expires** → call `POST /auth/refresh`. Admin web clients rely on the httpOnly cookie (sent automatically); mobile clients send the refresh token in the `Authorization: Bearer` header. The refresh token carries `aud` and renews the same-surface session.
3. **Logout** → clears the session row for the caller's surface. For the ADMIN surface the httpOnly cookie is also cleared. The other surface's session is unaffected.

**Admin cookie `secure`/`sameSite` flags are `NODE_ENV !== 'development'`, not `NODE_ENV === 'production'`.** The admin web app calls the API cross-site with `withCredentials: true`, which requires `secure: true; sameSite: 'none'` — browsers drop any cookie without those flags on a cross-site request. Railway always serves over HTTPS regardless of environment name, so `test`/staging deployments need the same secure cookie behavior as production; only local dev runs over plain HTTP and needs the relaxed `lax`/non-secure cookie. Checking `=== 'production'` previously meant any other deployed `NODE_ENV` value (e.g. `test`) silently downgraded to a cookie that cross-site browsers refuse to send back on refresh, dropping the admin session on every refresh call.

### Refresh Token Rotation & Reuse Detection

Every call to `POST /auth/refresh` performs a full rotation:

- A **new** refresh token is issued and its hash replaces the previous one in `member_sessions`.
- The **previous** hash, plus the full token response that was just issued and the rotation timestamp, are stored together in Redis under `rt_rotated:{memberId}:{surface}` for the duration of the refresh token's TTL.
- If an already-rotated token is presented (i.e. the hash matches the Redis entry but not the current session hash), the server checks how long ago the rotation happened:
  - **Within the reuse grace window (10s)** — treated as a benign concurrent-request race, not theft (e.g. two browser tabs on the same admin login, or the proactive pre-expiry refresh racing a reactive 401-triggered refresh). The server does **not** rotate again or touch the session; it replays the exact tokens issued by the rotation that already happened, so both callers converge on the same valid pair.
  - **Outside the grace window** — treated as **credential reuse**, the server immediately invalidates the entire session for that surface, and returns HTTP 401. This limits the blast radius of a stolen refresh token to a single use.
- On reuse detection (outside the grace window) the member receives a `session-security-alert` email advising them to change their password if the sign-out was unexpected.

### Absolute Session Lifetime

Each session row in `member_sessions` is upserted per `member + surface` — `updateLogin()` reuses the existing row across logins rather than creating a new one, updating only `hashedRefreshToken`/`lastLogin`/`lastLogout`. `createdAt` (from `BaseEntity`) is therefore set once at the row's *first-ever* login and never moves again — it is **not** a valid anchor for "how long has this login been going." On every refresh request, `validateRefreshToken` checks:

```
Date.now() - session.lastLogin > SESSION_MAX_AGE_DAYS × 86 400 000 ms
```

(Anchored on `lastLogin`, which resets on every login, not `createdAt` — using `createdAt` would mean any member whose session row is older than `SESSION_MAX_AGE_DAYS` gets force-logged-out on the very first refresh after *every* future login, no matter how recently they signed in.)

If the threshold is exceeded the session is invalidated and HTTP 401 is returned, forcing a fresh login regardless of how recently the token was rotated. `SESSION_MAX_AGE_DAYS` defaults to 30 and is configurable via environment variable.

### Temporary Password Flow

All new accounts — whether created via signup or admin-elevated — receive a server-generated temporary password. The
`changedPassword` flag on `Member` is set to `false`. On first login:

- The login response includes `"requires_password_change": true`.
- The `PasswordChangeRequiredGuard` blocks every subsequent authenticated request except the four exempt routes above.
- The user **must** call `POST /auth/change-password` (supplying the emailed temporary password as `oldPassword`) to
  activate full access.
- Once changed, `changedPassword` is set to `true` and normal access resumes.

**Signup:** `POST /auth/signup` no longer accepts a `password` field. The server generates a secure random password,
hashes it, sets `changedPassword = false`, and emails the plaintext temporary password to the new member.

### Device Lock (Mobile App)

Only one device may be logged into the mobile app per member account. This prevents proxy check-ins.

- `POST /auth/login` requires a `deviceId` string in the request body (the mobile client's device fingerprint).
- On the member's **first login** (`member.deviceId` is `null`), the device is registered and login succeeds.
- On subsequent logins, the incoming `deviceId` is compared to the stored value. If they match, login succeeds. If they
  differ, HTTP 403 is returned.
- An admin can purge the device lock via `DELETE /admin/members/:id/device` (`MEMBERS_WRITE` permission). This sets
  `deviceId = null` and invalidates all active sessions for that member, forcing a fresh login from any device.
- `POST /auth/admin-login` (web portal) does **not** perform a device check — it is web-first.

**Bug fixed:** the `login-notification` email (`EmailCategory.LOGIN_ALERT`, subject "New … Login Detected") used to
send on *every* successful login, not just a new-device registration — despite the email itself claiming "We
detected a new login." `AuthService.login()` now captures `isNewDeviceRegistration = !member.deviceId` before
`setDeviceId()` mutates it, and only queues the email when that's true — i.e. this member's first-ever login, or
their first login after a device reset (the only two ways `deviceId` transitions from `null`). Every other login
(the normal case: `deviceId` already matches) no longer emails at all. The `EmailCategorySettingsService`/
`ENFORCE_DISTANCE_CHECK`-style tenant-level toggle for `LOGIN_ALERT` (see "Email Category Settings Module") still
applies on top of this — it can suppress the email entirely for a tenant, but doesn't affect *when* within a
tenant it would have fired.

### Self-Service Device Reset Flow

A member who needs to log in from a new device (lost phone, factory reset, etc.) can reset their own device lock
without admin involvement, subject to a rate limit.

1. `POST /auth/device-reset/request` — accepts `{ email, newDeviceId }`. Rate-limited per email (default: 3 attempts
   per 24-hour window, configurable via `DEVICE_RESET_MAX_ATTEMPTS` and `DEVICE_RESET_WINDOW_SECONDS`). Generates a
   6-digit OTP, stores an Argon2 hash and the `newDeviceId` in `device_reset_otps`, and emails the code. Always
   returns the same success message to avoid leaking account existence.
   - **Security note:** `newDeviceId` is locked in at request time. An attacker who intercepts the OTP cannot redirect
     the reset to their own device — the device is bound to whoever initiated the request.
2. `POST /auth/device-reset/verify` — accepts `{ email, otp }`. Verifies the OTP, checks expiry, marks the record
   as used, updates `member.deviceId` to the `newDeviceId` stored on the OTP record, invalidates all active sessions,
   unsubscribes push, **revokes every one of the member's WebAuthn credentials** (`WebauthnService.revokeAllCredentials`),
   and sends a confirmation email. On success the member must log in fresh from the new device, re-enrolling biometrics
   if they want one-tap login again.
   - **Why WebAuthn credentials are revoked too:** a WebAuthn credential is hardware-bound and deliberately never
     checks `deviceId` (see `loginWithWebauthn`'s own comment) — several trusted devices are meant to each hold their
     own credential. Without this, a lost/stolen device's fingerprint or Face ID would keep working right through a
     device reset, since that lock only ever gated the password path. There's no way to isolate which single stored
     credential belongs to the lost device, so a device reset revokes all of them rather than leaving any possibly
     compromised one live.
   - If the attempt count reaches the configured maximum, the email is rate-limited and the member must contact an
     admin for an out-of-band device purge (`DELETE /admin/members/:id/device`).
   - **Wrong-guess limiting:** see "OTP Verify Guess Limiting" below — this endpoint is one of the three protected.

### OTP Verify Guess Limiting

`FORGOT_PASSWORD_MAX_ATTEMPTS`/`DEVICE_RESET_MAX_ATTEMPTS` (and the per-route `@Throttle` decorators) only cap how
often a *new* OTP can be requested — none of them capped how many *guesses* could be made against an OTP that was
already issued. A 6-digit code has only 1,000,000 possible values, so without a separate per-account guess limit a
distributed attacker (rotating source IPs past the per-IP `@Throttle`) could brute-force a live code within its
`OTP_TTL_SECONDS` validity window.

`AuthService.checkOtpVerifyRateLimit`/`recordFailedOtpVerify`/`clearOtpVerifyRateLimit` add a per-account counter
(Redis key `otp_verify_fail:<identifier>:<scope>`, TTL = `OTP_TTL_SECONDS`) on top of the existing request-side
limits — mirrors `checkLoginRateLimit`'s shape. Every wrong or expired/missing-code attempt increments the counter;
a correct verify clears it. Once `OTP_VERIFY_MAX_ATTEMPTS` (default `5`) failed attempts accumulate, the endpoint
returns `429 TOO_MANY_REQUESTS` — the account must wait out the window or request a fresh OTP (which doesn't reset
this counter, only reissuing the underlying code does something new to guess). Applies independently, keyed per
`scope`, to all three OTP-verify endpoints:

- `POST /auth/reset-password` (`scope: 'password_reset'`, identifier: email)
- `POST /auth/device-reset/verify` (`scope: 'device_reset'`, identifier: email)
- `POST /auth/email-change/confirm` (`scope: 'email_change'`, identifier: member id) — this route previously had no
  `@Throttle` at all; it now has the same `5/min` per-IP throttle as the other two, plus this per-account guard.

### Forgot Password / OTP Reset Flow

1. `POST /auth/forgot-password` — rate-limited (default: 3 attempts per hour, configurable via env). Generates a 6-digit
   OTP, stores an Argon2 hash in `password_reset_otps`, and emails the code. Always returns the same success message to
   avoid leaking account existence.
2. `POST /auth/reset-password` — rate-limited (5 attempts/min, same as `forgot-password`). Verifies the OTP against
   the hash, checks expiry (default: 15 min for a self-requested reset — longer for a tenant-welcome OTP, see below),
   marks the OTP as used, updates the password, **invalidates any existing session**, and emails a confirmation. On
   success the user must log in fresh.
   - **Wrong-guess limiting:** see "OTP Verify Guess Limiting" above.

This endpoint is also how a brand-new tenant's first admin sets their initial password — see "Tenant Welcome / Set
Password Flow" below.

### Self-Service Email Change Flow

A logged-in member/worker can change their own email address without admin involvement. Unlike the forgot-password
and device-reset flows above, both routes require an authenticated session (`JwtAuthGuard` via the global guard, no
`@Public()`) — the OTP is a second factor confirming ownership of the *new* mailbox, not a way to prove account
ownership from scratch.

1. `POST /auth/email-change/request` — accepts `{ newEmail }`. Returns `409 Conflict` if `newEmail` is already used by
   another member. Rate-limited the same way as `forgot-password` (`checkOtpRateLimit`, keyed on the caller's member
   id). Deletes any prior unused request, generates a 6-digit OTP, stores an Argon2 hash **and the target `newEmail`**
   in `email_change_otps` (mirrors `DeviceResetOtp`'s pattern of locking in the sensitive value at request time), and
   emails the code **to the new address** (not the current one) — this doubles as proof the caller controls it.
2. `POST /auth/email-change/confirm` — accepts `{ otp }`. Verifies the OTP and expiry (`OTP_TTL_SECONDS`) against the
   caller's own most recent unused record, re-checks that `newEmail` is still unclaimed (`409` on a race), marks the
   record used, updates `member.email` to the stored `newEmail`, and emails a confirmation to the new address.
   - **Wrong-guess limiting:** see "OTP Verify Guess Limiting" above.

### Tenant Welcome / Set Password Flow

Neither public entry point — self-serve `POST /signup` nor platform-admin `POST /platform/tenants` — collects a
password for the tenant's first admin. `SignupDto` has no `adminPassword` field at all: letting an unauthenticated
signup form set a password directly would mean anyone could submit an email address they don't own, with no proof of
control over that inbox. `TenantProvisioningService.provision()`/`seedTenantAdmin()` still branches on whether
`adminPasswordHash` was supplied, but in practice only one caller ever supplies it today — the `provision:tenant` CLI
script (`src/provision-tenant.ts`), an internal ops tool run by trusted staff, not a public HTTP surface:

- **No `adminPasswordHash` supplied** (both `POST /signup` and `POST /platform/tenants`, i.e. the normal case):
  `seedTenantAdmin()` generates a random password via `UtilityService.generateRandomPassword()` and hashes it — this
  password is never revealed to anyone, including the caller who triggered provisioning. `changedPassword: false`. It
  also generates a 6-digit OTP and stores its hash in `password_reset_otps` (the same table the forgot-password flow
  uses) with a 48-hour expiry (`WELCOME_OTP_TTL_HOURS`) — deliberately longer than the 15-minute forgot-password OTP,
  since a new admin may not check their email the same day. Once the tenant is active, `provision()` fire-and-forgets
  a warm welcome email (`tenant-welcome` template) to the new admin containing the OTP and a `discuva-admin`
  (formerly `Faithapp-admin`) `/set-password?email=...&otp=...` link. That page pre-fills the code and calls the existing
  `POST /auth/reset-password` — the same endpoint and verification logic the forgot-password flow uses, just reached
  from a different starting point. The longer OTP window is offset by rate-limiting `POST /auth/reset-password`
  itself (5 attempts/min). Clicking that link and setting a password is also, in effect, email verification — nobody
  can ever log in to a self-serve-signed-up tenant without proving control of the inbox behind `adminEmail`.
- **`adminPasswordHash` supplied** (CLI only): `changedPassword: true`, no OTP generated, no welcome email sent.

### Async Tenant Provisioning + Onboarding State Machine

`TenantProvisioningService.provision()` (`CREATE SCHEMA` + run the tenant migration set + seed the first admin +
create a `Subscription`) runs **async, on a Bull queue** (`TENANT_PROVISIONING_QUEUE`,
`TenantProvisioningProcessor`) for self-serve `POST /signup` only. `POST /platform/tenants` runs it **inline** —
see "Platform-admin tenant creation is synchronous" below for why the two callers deliberately differ. `provision()`
itself is unchanged either way and still callable directly (the `provision:tenant` CLI script does) — it's already
idempotent (checks existing state before acting at every step), which is what makes it safe for the queue to retry
and safe to re-run by hand after a synchronous failure.

**`Tenant.onboardingStatus`** (`PENDING | PROVISIONING | ACTIVE | FAILED`) is orthogonal to `isActive` — `isActive`
still means "currently allowed to serve live traffic" (also flipped by `PlatformTenantService.suspendTenant`);
`onboardingStatus` only ever moves forward through the lifecycle once and never changes on suspend/reactivate.

**Subdomain validation** happens inside `ensurePendingTenant`, before touching the database, against two separate
blocklists — `403`/`409 ConflictException` either way, but for different reasons: `RESERVED_SUBDOMAINS`
(`src/tenant/utility/extract-subdomain.ts` — `www`/`api`/`admin`/`platform`/`app`) are words that would actually
break routing if claimed, blocked for *every* caller including platform admins; `GENERIC_OR_ABUSE_PRONE_SUBDOMAINS`
(`src/tenant/constants/blocked-signup-subdomains.constant.ts` — `test`/`dev`/`demo`/`staging`/`login`/`billing`/etc.,
grouped by reason in the file itself) is a policy call against free-tier squatting and phishing-adjacent names, and
can be bypassed via `ensurePendingTenant`'s 4th param (`allowGenericSubdomain`) — set only by
`PlatformTenantService.createTenant`, since a platform admin deliberately creating e.g. a real sales-demo tenant at
`demo.<domain>` is a trusted, authenticated action, not the abuse case this list exists to stop.

**Self-serve signup flow (async):**
1. `TenantProvisioningService.ensurePendingTenant(subdomain, churchName, parentTenantId?)` — the find-or-create part
   of the old `provision()`, now its own method — creates the `Tenant` row (`onboardingStatus: PENDING`) or returns
   the existing one if resuming. Callable standalone specifically so `SignupController` gets a real `tenant.id` back
   before handing off to the queue.
2. `recordEvent(tenantId, 'SIGNUP_INITIATED', SELF_SERVE)` — see the audit trail note below.
3. A `TENANT_PROVISIONING_JOB` is enqueued (`ProvisionTenantParams` + `tenantId` + `actorType`/`actorId` +
   `branchInviteToken`), `attempts: 3, backoff: { type: 'exponential', delay: 5000 }` (this codebase's standard
   retry convention, e.g. `TitheProcessor`).
4. `TenantProvisioningProcessor` sets `onboardingStatus = PROVISIONING`, records `PROVISIONING_STARTED`, calls
   `provision()` (unchanged), then on success sets `onboardingStatus = ACTIVE` (`provision()` already flips
   `isActive`), records `PROVISIONING_COMPLETED`, and consumes the branch invite (`BranchInviteService.markAccepted`,
   moved here from `SignupController` since the controller no longer awaits completion). On permanent failure (all 3
   attempts exhausted, via `@OnQueueFailed()`) sets `onboardingStatus = FAILED` and records `PROVISIONING_FAILED`
   with the error message in `metadata`.
5. `GET /signup/:tenantId/status` (`@Public()`) — polled by the caller until `status` is `ACTIVE` (or `FAILED`).
   Unauthenticated by design, same reasoning as `POST /signup` itself; excluded from `TenantMiddleware` alongside it
   in `TenantModule` (a caller may not be on the tenant's own subdomain yet — e.g. a marketing site). **Confirmed
   live** this exclude needs a named path parameter (`v1/signup/:tenantId/status`), not a bare `(.*)` wildcard
   mid-path — this project's `path-to-regexp` version throws `PathError` on boot for that shape; only a suffix
   wildcard like `v1/platform/(.*)` is accepted.

**Platform-admin tenant creation is synchronous.** `PlatformTenantService.createTenant()` calls
`ensurePendingTenant()` + `recordEvent('PLATFORM_ADMIN_INITIATED', PLATFORM_ADMIN, { actorId })`, then calls
`provision()` directly and awaits it inline — no queue, no polling. On success it sets `onboardingStatus = ACTIVE`
and records `PROVISIONING_COMPLETED`; on failure it sets `onboardingStatus = FAILED`, records
`PROVISIONING_FAILED` with the error in `metadata`, and rethrows so the platform admin sees the real error
immediately instead of a silently-stuck `PENDING` row. This was deliberately reverted from an earlier async design:
unlike self-serve signup, this is a trusted, authenticated action by a platform admin, there's no fraud-review gate
that would need to sit between "created" and "actually provisioned," and `CREATE SCHEMA` + migrations + seeding is
fast enough that the admin can just wait for the response.

**Platform-level audit trail (`TenantOnboardingEvent`, `tenant_onboarding_events`):** distinct from
`AuditLogService`, which is tenant-scoped (lives in each church's own schema, actor FKs to that tenant's own
`Member`) and can't record an event from before/independent of any tenant schema existing. A small, purpose-built,
`public`-schema table instead: `tenant` (FK, cascade), `event` (`SIGNUP_INITIATED | PLATFORM_ADMIN_INITIATED |
PROVISIONING_STARTED | PROVISIONING_COMPLETED | PROVISIONING_FAILED`), `actorType` (`SELF_SERVE | PLATFORM_ADMIN |
SYSTEM`), `actorId` (nullable — the platform admin's id when `actorType = PLATFORM_ADMIN`), `metadata` (nullable
jsonb). Written via `TenantProvisioningService.recordEvent()` — no separate service, it's a simple insert-only log.
Viewable per-tenant via `GET /platform/tenants/:id/onboarding-events` (`TENANTS_READ` permission). The
platform-admin path never emits `PROVISIONING_STARTED` — there's no meaningful gap between "initiated" and
"started" when both happen inline in the same request.

**Response shape:** `POST /signup` returns a `PENDING` tenant immediately (poll `GET /signup/:tenantId/status` for
completion). `POST /platform/tenants` returns the tenant already `ACTIVE` — same shape `GET /platform/tenants`'
rows use, no polling needed.

### Role Elevation

The access token's role is re-validated from the live database on every request via `validateAccessToken`. This means if
a member is promoted to WORKER, their existing token will reflect the new role on the next request after the DB is
updated.

### Department Capabilities

Certain modules are gated by a department **capability** rather than a specific department name or a single free-form
key. This is a full replacement of the earlier `Department.key`-based system: `key` (a single free-form string,
validated against nothing but a preset-suggestion enum) has been removed entirely, in favor of `capabilities` — a
fixed, code-defined, multi-value list. The old system conflated "this department's organizational label" with "what
it unlocks," forcing an admin to type a magic string that had to exactly match hardcoded values scattered across both
the backend and discuva-member mobile, and could only ever grant one capability per department. Capabilities decouple these:
a department can be named anything, and separately be given any combination of capabilities via checkboxes in the
admin UI.

**How it works:**

- Each `Department` has a `capabilities: DepartmentCapability[]` column (`text[]`, default `{}`). `DepartmentCapability`
  (`src/department/enums/department-capability.enum.ts`) is a **fixed enum** — six values today, each named after the
  action it unlocks rather than a department: `MANAGE_SUNDAY_SCHOOL`, `MANAGE_CHILDREN_CHURCH`,
  `MANAGE_PRAYER_REQUESTS`, `MANAGE_EVANGELISM_CONVERTS`, `MANAGE_FOLLOW_UP`, `FRONT_DESK_OPERATIONS`. A capability
  only belongs in this list if a real feature is gated on it — mirrors the `KNOWN_MODULES` pattern. `CreateDepartmentDto`/
  `UpdateDepartmentDto` validate `capabilities` with `@IsEnum(DepartmentCapability, { each: true })`; unlike the old
  `key`, admins pick from a fixed checkbox list, not free text, and a single department can hold more than one
  capability at once.
- A `WorkerProfile` has a primary `department` and an optional `secondaryDepartment`. A worker has a capability if
  **either** department's `capabilities` array includes it.
- **`DepartmentAccessService`** (`src/department/service/department-access.service.ts`, exported from
  `DepartmentModule`) is the single shared implementation of this check — `hasCapability(memberId, capability)`
  (boolean, for composing with other conditions like "or is a pastor" or "or is the class teacher") and
  `assertHasCapability(memberId, capability, message?)` (throws `ForbiddenException`). Used by 7 services —
  `attendance`, `evangelism`, `sunday-school`, `prayer-request`, `service-session`, `children-church`, and
  `follow-up` — each calling it with its own capability and message; two of those services (`evangelism`,
  `follow-up`) also have an inline duplicate of the same check where they already have the `WorkerProfile` loaded
  and calling the service would mean a redundant query.
- `GET /auth/me` computes a flat `capabilities: DepartmentCapability[]` field on `MemberDto`
  (`@Transform`, same pattern as `clergy`) — a deduped union of the primary and secondary department's
  capabilities. discuva-member mobile checks this one field (`profile?.capabilities?.includes("X")`) instead of
  independently re-deriving the primary-or-secondary union at every call site.
- HOD (head-of-department) assignment is always restricted to the worker's **primary** department (unrelated to
  capabilities).

**Sunday School access** — a request passes if any of the following is true:

1. Caller is a WORKER whose primary or secondary department has the `MANAGE_SUNDAY_SCHOOL` capability.
2. Caller is the appointed teacher of the specific Sunday School class being acted upon.

Admin-only SS routes (delete class/session) use `AdminGuard + SUNDAY_SCHOOL_WRITE` instead.

**Children Church access** — a request passes if any of the following is true:

1. Caller is a WORKER whose primary or secondary department has the `MANAGE_CHILDREN_CHURCH` capability.

Admin-only CC routes (age group/class group CRUD, slot-level check-in report) use
`AdminGuard + CHILDREN_CHURCH_WRITE/READ` instead.

**Migration note:** `1790208000000-ReplaceDepartmentKeyWithCapabilities.ts` backfills the 6 legacy `key` values that
had real behavior behind them (`ADMIN`, `EVANGELISM`, `SUNDAY_SCHOOL`, `PRAYER`, `CHILDREN_CHURCH`, `FOLLOW_UP`) into
their corresponding capability, then drops the `key` column. Any department whose `key` was one of the other preset
values (`WORSHIP`, `USHERING`, `MEDIA`, `PROTOCOL`, `WELFARE`, `YOUTH`, `YOUNG_ADULTS`) or a custom string had no real
behavior behind it and is simply dropped — those departments end up with `capabilities: []`.

---

## 5. Module Reference

### Multi-Tenant Request Scoping

Every request except `/v1/platform/*`, `/v1/signup`, and the version-neutral `/`, `docs`, `health` routes goes
through `TenantMiddleware`: it resolves the tenant from the `Host` header's subdomain (stripped of
`APP_BASE_DOMAIN`, e.g. `church-alpha.example.com` → `church-alpha`; `localhost` in dev, so `*.localhost` works with
no `/etc/hosts` changes), then wraps the entire rest of the request — guards, interceptors, and the handler — in one
DB transaction with `SET LOCAL search_path` set to that tenant's schema. Full design in
`docs/MULTI_TENANT_MIGRATION.md` §4.3/§4.4.

**Fallback resolution for a fixed, non-wildcard host (added 2026-08, extended to discuva-member 2026-08):**
discuva-admin is deployed at a single `admin.discuva.org` origin shared by every tenant, not a per-tenant wildcard —
`admin` is in `RESERVED_SUBDOMAINS` (`src/tenant/utility/extract-subdomain.ts`) specifically so no tenant could
ever collide with it, but that also means `extractSubdomain()` always returns `null` there: there is no subdomain
in the Host header to strip. discuva-member has a real per-tenant wildcard for its own hosting
(`{tenant}.discuva.org`, resolved the normal Host-header way, unchanged) but its *API calls* target the separate,
dedicated `api.discuva.org` host every other app calls directly — same problem, different reason: the Host header
`TenantMiddleware` sees on that call carries no subdomain either. When that happens, `TenantMiddleware` tries two
fallbacks, in order, before giving up with the same `404 Tenant not found` as before:
1. **A verified JWT tenant claim.** Every access/refresh token, both surfaces, embeds `tenantId`/`schemaName` in
   the payload at sign time (`AuthService.generateTokens()`, reading `cls.get('tenantId')`/`cls.get('schemaName')`
   — already correctly set for that request by whichever mechanism resolved it, Host header or this same fallback
   on the login request itself). `TenantMiddleware` checks the `Authorization: Bearer` header first — trying the
   access secret, then `REFRESH_JWT_SECRET`, since a Bearer header can legitimately carry either token type
   (discuva-admin's refresh flow sends its refresh token via an httpOnly cookie; discuva-member's sends it via this
   same header instead, a pre-existing `RefreshJwtStrategy` design, not something added for this) — then the
   `refresh_token` httpOnly cookie (verified with `REFRESH_JWT_SECRET`) as a second fallback. Covers every
   authenticated request, including a bare `/v1/auth/refresh` call from either app. This is genuinely safe against
   spoofing: the claim only exists inside a JWT whose signature already proves it came from this server, at a
   moment CLS already held the correct tenant — there's no way for a client to write an arbitrary `tenantId` into a
   token it can't forge the signature for.
2. **`X-Tenant-Subdomain` header.** discuva-admin sends it on every pre-auth request where no token exists yet:
   `POST /v1/auth/admin-login` (needs to know which tenant's `Member`/`Admin` tables to check credentials against
   before it can issue anything), and `POST /v1/auth/forgot-password`/`reset-password` (same reasoning —
   `PasswordResetOtp` is tenant-schema-scoped too, and both the "Forgot password" flow on the login screen and the
   first-time `/set-password` flow reached from a welcome email are equally pre-auth). discuva-member sends it on
   *every* request to `api.discuva.org` (derived from its own Host header via `getCurrentTenantSubdomain()`,
   `utils/tenant/api-base-url.ts`), not just pre-auth ones — harmless to include always, and it's what
   `app/manifest.ts`'s server-side, pre-auth `GET /tenant/info` call for PWA branding relies on, since no JWT
   exists there yet either. This header is **not** cryptographically trusted the way the JWT claim is — it's
   exactly as trustworthy as a user typing a workspace URL: a wrong or malicious value just resolves to the wrong
   (or a nonexistent) tenant's schema, where the supplied email/OTP/session simply won't match any real row, so it
   can never grant access to anything, only ever fail against the wrong place. On an authenticated discuva-member
   request it's redundant with (and always loses to) the JWT claim above — sent anyway for the handful of pre-auth
   calls that need it, and it's simpler to attach unconditionally than to special-case which requests do.

Both fallbacks are skipped entirely — not even attempted — whenever the Host header itself already resolved a
subdomain, so discuva-member's own hosting (as opposed to its outgoing API calls) is completely unaffected; this
exists purely to make a fixed, non-wildcard destination host work for the two kinds of traffic that need one.

**Distinct error responses per tenant state, not a single generic 404:** the tenant lookup is `findOneBy({
subdomain })`, deliberately not filtered by `isActive`, so a row that exists but isn't (yet, or anymore) usable gets
a response that actually explains why, using `onboardingStatus` (see "Async Tenant Provisioning + Onboarding State
Machine" above) to disambiguate:
- No `Tenant` row at all for the subdomain → `404 Tenant not found` (unchanged).
- `onboardingStatus` is `PENDING`/`PROVISIONING` → `503`, "This workspace is still being set up. Please check back
  in a moment." — this is the common case for a subdomain hit moments after signup, before the queue has finished.
- `onboardingStatus` is `FAILED` → `503`, "There was a problem setting up this workspace. Please contact support." —
  deliberately no technical detail in the public response; `GET /platform/tenants/:id/onboarding-events` is where
  that lives.
- `onboardingStatus` is `ACTIVE` but `isActive` is `false` → `403`, "This account has been suspended. Please contact
  support." `onboardingStatus` never reverts once `ACTIVE`, so this combination only ever means
  `PlatformTenantService.suspendTenant` was used — a materially different situation from "still provisioning" that
  a flat `isActive` check couldn't previously tell apart (both 404'd identically before this).
- `onboardingStatus === ACTIVE && isActive === true` → proceeds normally, as before.

**For any new module with tenant-owned tables:** register entities with `TenantTypeOrmModule.forFeature([...])`
(`src/tenant/utility/tenant-typeorm.module.ts`), not `TypeOrmModule.forFeature([...])`. Plain `TypeOrmModule`
repositories never see the tenant transaction regardless of request scoping — this is a `@nestjs-cls/transactional`
limitation, not a bug to work around per-call. `TenantTypeOrmModule` is a drop-in replacement using the same DI
token, so `@InjectRepository(Entity)` call sites in services need no changes. Only genuinely global, `public`-only
tables (`Tenant`, `PlatformAdmin`, `Plan`/`Subscription`, and similar control-plane entities) should keep plain
`TypeOrmModule.forFeature()`.

**Scheduler tenant iteration (`forEachActiveTenant`):** `@Cron()`-decorated methods run with no CLS context at all —
there's no HTTP request for `TenantMiddleware` to hook into. A tenant-scoped repository called from inside a
scheduler with no CLS context silently falls back to the plain `public`-search-path manager instead of throwing, so
without doing anything about it a scheduler processes whatever stale/orphaned rows happen to sit in `public`, not
any real tenant's data. Every scheduler that touches tenant-scoped data fetches every active `Tenant` and re-enters
that tenant's context once per tenant via the shared helper `forEachActiveTenant(tenantRepo, cls, txHost, logger,
fn)` (`src/tenant/utility/for-each-active-tenant.ts`), which wraps the existing `runInTenantContext()` helper (the
same one `EmailProcessor` already used) in a fetch-loop-catch: `fn` runs once per active tenant inside that tenant's
`cls.runWith(...)` + `SET LOCAL search_path` transaction, and one tenant throwing is caught and logged without
stopping the rest of the batch. Any distributed Redis lock a scheduler already had (e.g. `lock:pledge-reminders`)
still wraps the *whole* `@Cron` method across all tenants, unchanged — it guards against two app instances racing,
not tenants racing each other. A service that opens its own `dataSource.transaction()` inside a scheduler needs
extra care: a fresh top-level transaction doesn't inherit the outer `SET LOCAL search_path` (likely a different
pooled connection) and would silently write to the wrong schema — such call sites are rewritten to use the ambient
`this.txHost.tx` manager instead (see `AttendanceService.markAbsentees()` and `RecurringEntryScheduler`, the latter
wrapping each recurring entry in its own Postgres `SAVEPOINT` so one entry's failure doesn't abort the whole
tenant's batch). `BranchRollupScheduler` predates this helper and hand-rolls the identical fetch-loop pattern
itself; `YoutubeSubscriptionScheduler` and `SubscriptionLapseScheduler`'s top-level query are exempt because their
data is genuinely control-plane (`public`-schema), not tenant-owned.

**CORS origin validation (`createCorsOriginValidator`):** wildcard-subdomain tenancy means the set of valid frontend
origins is unbounded — a new tenant's subdomain is valid to call the API the moment it's provisioned, so a static
`CORS_ORIGINS` allowlist can never enumerate them all (and previously didn't try to — it silently rejected every
tenant subdomain origin that wasn't hand-added to the list, a real bug, not just a gap). `src/main.ts`'s
`app.enableCors()`, `ServiceSessionGateway`, and `GameSessionGateway` all now validate the incoming `Origin` header
dynamically via the shared `createCorsOriginValidator()` (`src/tenant/utility/cors-origin-validator.ts`): allow if
the origin's hostname equals `APP_BASE_DOMAIN` or ends in `.${APP_BASE_DOMAIN}` — the exact same suffix logic
`extractSubdomain()` uses for tenant resolution, so "is this origin allowed to call the API" and "does this host
resolve to a tenant" can never disagree — with a small explicit `CORS_ORIGINS` allowlist checked first for origins
that don't fit the pattern (a separate marketing site, API docs, internal ops tooling). Requests with no `Origin`
header (curl, server-to-server calls, mobile apps) are always allowed, matching the previous behavior. **Custom
domains** (a tenant's own domain, e.g. `giving.theirchurch.org`) don't end in `APP_BASE_DOMAIN` and are rejected by
this check today — deliberately deferred, same as `tenant_domains` itself (see Custom Domains note below); adding
support means a second branch in `createCorsOriginValidator()` checking a *cached* set of verified custom domains
before falling through to reject (must stay cached, not a live DB query — this runs on every request/connection).

**Custom domains (deferred, not built):** `docs/MULTI_TENANT_MIGRATION.md` earmarks a future `tenant_domains` table
for letting a church map their own domain (`giving.theirchurch.org`) to their tenant, instead of only
`their-church.<APP_BASE_DOMAIN>`. Not built — subdomain routing is sufficient for now. When it is: (1) resolve the
custom domain to the tenant's canonical `subdomain` via a new lightweight public endpoint, cached client-side, so
discuva-member's `getCurrentTenantSubdomain()` (`utils/tenant/api-base-url.ts`) can resolve it to the same
subdomain it already sends as `X-Tenant-Subdomain` today — no changes needed to CLS/`SET LOCAL search_path`/
tenant-scoped repos, all of that stays subdomain-keyed; (2) a domain must be
DNS-verified (TXT record token, or requiring it already point at this infrastructure) before being trusted — a row
in the table must never be sufficient on its own, since nothing stops a tenant from entering a domain they don't
control; (3) TLS is an infrastructure decision independent of this codebase — a single wildcard cert covers every
subdomain automatically, but each custom domain needs its own certificate (e.g. a reverse proxy that automates
ACME/Let's Encrypt on demand, or requiring the tenant sit behind a proxy like Cloudflare that terminates TLS for
them) — nothing here provisions that.

### Auth Module

**Routes:** `POST /auth/signup`, `POST /auth/login`, `POST /auth/admin-login`, `POST /auth/refresh`,
`POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password`, `POST /auth/email-change/request`,
`POST /auth/email-change/confirm`, `POST /auth/forgot-password`,
`POST /auth/reset-password`, `POST /auth/device-reset/request`, `POST /auth/device-reset/verify`,
`POST /auth/webauthn/login/options`, `POST /auth/webauthn/login/verify`,
`POST /auth/webauthn/register/options`, `POST /auth/webauthn/register/verify`,
`GET /auth/webauthn/credentials`, `DELETE /auth/webauthn/credentials/:id`

`POST /auth/email-change/*` require an authenticated session (member or worker) — see Self-Service Email Change Flow
above for the full request/confirm sequence.

**Route separation:** `POST /auth/login` is for the **mobile app** (members & workers) and enforces device lock —
`deviceId` is required. `POST /auth/admin-login` is for the **web admin portal** — it verifies that the caller has an
active `Admin` record and has no device check. Both routes use the same Passport `LocalAuthGuard` for credential
validation.

**WebAuthn / biometric login (`WebauthnService`, `src/auth/service/webauthn.service.ts`)** — mobile-app-only
alternative to password login using the browser's platform authenticator (Face ID / Touch ID / Android fingerprint /
Windows Hello), built on `@simplewebauthn/server`. `member_webauthn_credentials` (tenant schema, migrated in
`src/migrations/tenant/`) holds one row per registered device/authenticator — deliberately no uniqueness constraint
on `member_id`, unlike `member_sessions`' one-row-per-surface rule: a member can register several devices
independently.

- **Usernameless (discoverable/resident credentials)** — registration sets `residentKey: 'required'`, so
  `POST /auth/webauthn/login/options` needs no email and returns generic options with `allowCredentials` omitted;
  the browser/OS itself resolves which registered credential to use and prompts biometrics directly. The resolved
  `memberId` only becomes known once `POST /auth/webauthn/login/verify` succeeds (matched by the assertion's
  `credentialId` against the stored row), at which point `AuthService.loginWithWebauthn(memberId)` issues tokens via
  the exact same `generateTokens()` used by password login — no separate token-issuance path exists.
- **`loginWithWebauthn` runs the same active/status checks `validateMember()` applies for password login**
  (`INACTIVE` status, revoked/suspended worker), but **deliberately does not** apply `login()`'s single-`deviceId`
  lock — that lock's threat model (a shared/leaked password) doesn't apply to a hardware-bound private key that
  never leaves the device, and the entire point of allowing several WebAuthn credentials per member is several
  trusted devices logged in independently.
- **RP ID is the platform's fixed `APP_BASE_DOMAIN`, never the tenant subdomain** — WebAuthn allows an RP ID that's
  a registrable-domain suffix of the current origin, so a credential registered on `church-a.<base>` still validates
  when asserted from `church-a.<base>` later (the request's actual `Origin` header is still checked exactly via
  `expectedOrigin` on every verify call). RP *name* (shown in the OS-level prompt) is resolved per-request from the
  current tenant's own `Tenant.name` where available, falling back to `PRODUCT_NAME` — same personalization as every
  other tenant-branded surface in this app.
- **Challenges are ephemeral Redis entries** (`CacheService`, 5 min TTL, key `webauthn_challenge:<memberId-or-random-challengeId>`)
  — never persisted to Postgres, single-use (deleted immediately after a verify attempt, success or failure).
- **Registration** (`POST /auth/webauthn/register/options` / `/verify`) requires an existing authenticated session
  (`JwtAuthGuard`, same as any other `/auth/*` account-management route) — a member enrolls a *new* device from
  within an already-logged-in session, typically from Account settings.
- **Device management**: `GET /auth/webauthn/credentials` returns `{ id, deviceName, createdAt, lastUsedAt }` per
  row — never `credentialId`/`publicKey`, which the client has no use for. `deviceName` is derived from the
  registering request's `User-Agent` at enrollment time ("iPhone", "Android device", "Mac", "Windows PC" — a label
  only, never used for anything security-relevant). `DELETE /auth/webauthn/credentials/:id` is scoped to
  `(id, memberId)` — `404` if the row doesn't belong to the caller. Both credential registration and removal are
  audit-logged (`MEMBER_WEBAUTHN_CREDENTIAL_REGISTERED` / `_REMOVED`), and a successful biometric login logs
  `MEMBER_LOGIN_WEBAUTHN` (distinct from `MEMBER_LOGIN`, so the audit trail can tell login method apart).
- **Clone/replay protection**: each credential's signature `counter` must strictly increase on every successful
  authentication (`@simplewebauthn/server`'s `verifyAuthenticationResponse` enforces this) — a same-or-lower counter
  fails verification, the standard signal an authenticator's key material was cloned.
- **Interaction with Self-Service Device Reset**: because WebAuthn logins never check `deviceId`, `POST
  /auth/device-reset/verify` also calls `WebauthnService.revokeAllCredentials(memberId)` — every registered
  credential is deleted, not just the password-login device lock. See the Device Reset section above for why (a lost
  device's biometric key would otherwise survive a reset intended to lock it out).

### Member Module

Manages the universal identity. Admin portal routes (list members, promote/revoke workers, change status, reset
passwords) are now guarded by `AdminGuard` + the appropriate `MEMBERS_READ` or `MEMBERS_WRITE` permission.

**Routes prefix:** `/members`

**Admin-created members:** `POST /members` (`AdminGuard` + `MEMBERS_WRITE`) lets an admin create a plain `MEMBER`
account directly — for members without a phone/email habit, or who otherwise can't complete self-signup. Body is
`SignupDto` (same DTO as `POST /auth/signup`). `MemberService.createByAdmin` shares its implementation with
`signup()` via a private `createMemberRecord` helper: same temp password generation, `changedPassword: false`
(forces the change-password flow on first login), and welcome-member email with the temp password/login URL. The
only difference is the audit action — `MEMBER_CREATED_BY_ADMIN` (with the admin as `actorId`) instead of
`MEMBER_SIGNED_UP`. Promoting the new member to a worker afterwards is a separate step — use the existing
`POST /members/:id/promote`.

**Self-service profile edit:** `PATCH /members/me` (`JwtAuthGuard` only, no admin) lets a member/worker update their
own `firstname`, `lastname`, `phoneNumber`, `gender`, `birthDay`, `birthMonth`, `birthYear`, `maritalStatus`
(`UpdateMyProfileDto`, all fields optional). Deliberately excludes `email` (handled by the OTP-gated email-change
flow — see Self-Service Email Change Flow), and the admin-only church-record fields `dateJoinedChurch`,
`yearBornAgain`, `yearBaptized`, `baptizedWithHolyGhost`.

**Clergy designation:** four `AdminGuard` + `MEMBERS_WRITE` routes manage the optional `Clergy` relation on a member
(same permission as promote-to-worker — no separate permission was introduced):

- `POST /members/:id/clergy` — body `{ clergyTitleId: string (uuid) }` — assigns the designation; `409 Conflict` if
  the member is already clergy, `404` if `clergyTitleId` doesn't match a `ClergyTitle`.
- `PATCH /members/:id/clergy` — body `{ clergyTitleId: string (uuid) }` — changes the title; `404` if the member is
  not clergy, or if `clergyTitleId` doesn't match a `ClergyTitle`.
- `DELETE /members/:id/clergy` — removes the designation; `404` if the member is not clergy. Returns `204`.
- `PATCH /members/:id/clergy/review-access` — body `{ canReviewFeedback: boolean }` — grants/revokes Pastor Feedback
  review access, independent of title (see Clergy above and Pastor Feedback Module below); `404` if the member is
  not clergy.

See ClergyTitle above for the tenant-configurable title catalog these routes reference (`GET /clergy-titles` to
populate a picker with the tenant's own titles).

`clergy: { title: {id, name}, canReviewFeedback: boolean } | null` is surfaced on `MemberDto` (`GET /auth/me`,
`GET /members/:id`, `GET /members`, `GET /members/workers`), computed from the `clergy` relation.

**Profile photo:** `POST /members/me/photo` (multipart, field `photo`) uploads/replaces the caller's own photo via
`CloudinaryService` (folder `profile-pictures`); `DELETE /members/me/photo` removes it. Both `JwtAuthGuard` only —
self-service, no admin permission required. `DELETE /members/:id/photo` (`AdminGuard` + `MEMBERS_WRITE`) lets an
admin clear another member's photo for moderation. All three return the updated `MemberDto`. Audit-logged as
`MEMBER_PHOTO_UPDATED` / `MEMBER_PHOTO_REMOVED`, with `metadata: { self: true|false }` distinguishing a member's
own action from an admin's.

### Member Bulk Import

Lets an admin create many members at once from a spreadsheet, via a preview-then-commit flow so validation errors
can be reviewed before anything is written. Controller: `MemberImportController`, all routes `AdminGuard` +
`MEMBERS_WRITE`.

**Routes prefix:** `/members/bulk-import`

| Method | Path                              | Description                                                                                          |
|--------|-----------------------------------|-------------------------------------------------------------------------------------------------------|
| GET    | `/members/bulk-import/template`   | Streams a `.xlsx` template with the expected columns (see below)                                     |
| POST   | `/members/bulk-import/preview`    | Multipart upload, field name `file`, 5 MB cap (`LimitedFileInterceptor`). Parses and validates every row, persists a `MemberImportJob` + `MemberImportRow[]`, returns `{ ...job, rows }` |
| GET    | `/members/bulk-import/:jobId`     | Refetch a previously-previewed job and its rows                                                       |
| POST   | `/members/bulk-import/:jobId/commit` | Creates a `Member` (+ `WorkerProfile` if the row's `department` column was filled) for every row with zero validation errors; generates a random temp password per member and emails it via the `welcome-member` template; returns `{ createdCount, failedRows }` |

**Commit is batched, not per-row.** `commitImport` resolves duplicate-email and department-name lookups for the
*entire* batch in 2 queries up front (not one of each per row), then inserts every still-eligible row's `Member`
(+ `WorkerProfile`, if applicable) in a single transaction. This means a row can still independently fail
pre-validation (email taken since preview, unknown department) and land in `failedRows` exactly as before, but a
row that passes pre-validation and is included in the transaction is no longer isolated from the others — a genuine
DB-level failure during the bulk insert (e.g. a race-condition constraint violation) fails the whole commit rather
than just that one row, unlike the old per-row-transaction implementation. In practice this only matters for the
rare case a pre-validated row fails for a reason pre-validation couldn't catch.

**Template columns:** First Name*, Last Name*, Email*, Phone Number, Gender (MALE/FEMALE), Birth Day (1-31), Birth
Month (1-12), Birth Year, Marital Status (SINGLE/MARRIED/DIVORCED/WIDOWED), Year Born Again, Year Baptized, Baptized
With Holy Ghost (TRUE/FALSE), Date Joined Church (YYYY-MM-DD), Department (optional — creates the member as a
Worker), Profession, Year Joined Workforce.

**Validation (at preview time, one pass over every row):**

- Each row is validated against `SignupDto`'s rules (required fields, formats).
- Duplicate email **within the file** is flagged, pointing at the earlier row number.
- Email already existing in the DB is flagged.
- A filled `department` column is looked up case-insensitively; an unknown department name is flagged as an error
  (`Unknown department: "..."`) and the row is excluded from commit.
- `job.validRows` = rows with zero errors; only those are eligible for commit.

**Commit behavior:** re-checks each valid row's email uniqueness and department lookup (guards against a race between
preview and commit); on a per-row failure the row is marked `FAILED` with `commitError` set and processing continues
with the remaining rows rather than aborting the whole job. A job can only be committed once — re-committing an
already-`COMMITTED` job returns `400 Bad Request`.

### Admin Module

Manages the admin RBAC system used by the admin web portal. This module is `@Global()` — its providers (`AdminGuard`,
`AdminService`, `AdminRoleService`) are available across the entire app without explicit module imports.

**AdminRole routes** (`/admin/roles`):

- `GET /admin/roles` — `ADMIN_READ` — list all roles
- `GET /admin/roles/:id` — `ADMIN_READ` — get role by ID
- `POST /admin/roles` — `ADMIN_WRITE` — create role
- `PATCH /admin/roles/:id` — `ADMIN_WRITE` — update role
- `DELETE /admin/roles/:id` — `ADMIN_WRITE` — delete role (blocked if active admins use it)

**Admin user routes** (`/admin/users`):

- `GET /admin/users` — `ADMIN_READ` — list all admin users
- `GET /admin/users/me` — any admin — own admin profile
- `GET /admin/users/:id` — `ADMIN_READ` — get admin by ID
- `POST /admin/users` — `ADMIN_WRITE` — grant admin access to a member
- `PATCH /admin/users/:id` — `ADMIN_WRITE` — change admin role or active status; **an admin cannot modify their own record** (403)
- `POST /admin/users/:id/revoke` — `ADMIN_WRITE` — soft-revoke admin access (`isActive = false`)

**Security notes:**
- Admin user read endpoints (`GET /admin/users`, `GET /admin/users/me`, `GET /admin/users/:id`) strip `password` and `deviceId` from the joined Member before returning — these fields are never returned to API clients.
- Role-change audit entries capture the previous and new role name in addition to the changed field list.

**Predefined role seed (migration):** A one-time migration (`SeedPredefinedAdminRoles`) seeds 9 ready-to-use roles
covering the typical org structure. The migration is idempotent — it uses `ON CONFLICT ("name") DO NOTHING` so
re-running it on a database that already has these roles is safe.

| Role name                       | Typical use                                      |
|---------------------------------|--------------------------------------------------|
| Super Admin                     | All permissions                                  |
| General Admin                   | Most read/write permissions excluding admin RBAC |
| Member Coordinator              | Members read/write                               |
| Content Manager                 | Announcements write                              |
| Welfare & Pastoral              | Notes read/write, members read                   |
| Children Church Coordinator     | Children church read/write                       |
| Sunday School Coordinator       | Sunday school read/write                         |
| Attendance Monitor              | Attendance read                                  |
| Leave Approver                  | Leave read/write                                 |

**Default seed:** On application bootstrap, if `DEFAULT_ADMIN_EMAIL` is set and no admin exists with that email, the
system creates:

1. A `Member` with `role = MEMBER` and `changedPassword = false`
2. A `SuperAdmin` `AdminRole` carrying all permissions
3. An `Admin` record linking the two

**Orphaned `'Super Admin'` (with a space) role — cleaned up:** `TenantSchemaGenesis`
(`src/migrations/tenant/1790726400000-TenantSchemaGenesis.ts`, the schema-genesis migration every new tenant still
runs) seeds a legacy `'Super Admin'` role from before `AdminRoleService`'s `'SuperAdmin'` (no space) naming
convention existed — immutable history, can't be edited. Since it runs *before* `seedTenantAdmin()` (application
code, not a migration), every newly-provisioned tenant ended up with two full-permission roles: the orphaned,
never-assigned `'Super Admin'`, and the real, actively-used `'SuperAdmin'` (the one later permission-grant
migrations like `GrantSocialMediaPermissions` target, and the one the real admin is actually assigned to).
`seedTenantAdmin()` now deletes the orphaned row for new tenants (safe unconditionally at that point — `admins`
is guaranteed empty, so nothing can reference it via `admins.admin_role_id`'s `ON DELETE RESTRICT` FK); a new
migration (`1792566000000-RemoveOrphanedSuperAdminSpaceRole.ts`, tenant schema) cleans up the rows already sitting
in existing tenants, guarded by the same "no admin references it" check so a genuine edge case is left untouched
rather than failing the migration.

### Church Settings Module

Lets an admin turn optional feature modules on/off per-installation without a deploy — the mechanism that keeps the
platform usable by congregations that don't run every ministry this codebase supports. Backed by `ChurchSetting`
(`key` unique, `value: jsonb` = `{ enabled: boolean, displayName?: string }`), read through `ChurchSettingsService`
with a short-TTL cache (`cacheService`) so `isEnabled()` checks on every request don't hit Postgres each time.

**`KNOWN_MODULES`** (`src/church-settings/constants/known-modules.constant.ts`) is the fixed list of togglable
modules, each with a `required: boolean`. `required: true` modules (`departments`, `service_programme`) can never be
disabled — `PATCH /admin/settings/:key` returns `400` if attempted. Everything else defaults to `required: false`:
`incident_report`, `asset_management`, `evangelism`, `follow_up`, `pastor_feedback`, `prayer`, `sunday_school`,
`children_church`, `facility_rental`, `tithe`, `classes`, `announcements`. A module with no row in the database is
treated as **enabled** (absent = on) — a fresh install has everything available until an admin opts out.

**`displayName` override:** an admin can rename a module's label (e.g. "Pastor Feedback" → "Elders' Feedback") via
the same `PATCH /admin/settings/:key` body without touching `enabled`. `ChurchSettingsService.upsert()` merges
rather than overwrites — passing `{ enabled }` alone preserves whatever `displayName` was previously set (a toggle
flip must never silently blank out a custom label). Both frontends fall back to the module's default label when
`displayName` is unset.

**Enforcement (`ModuleEnabledGuard` + `@RequiresModule(key)`):** mirrors the existing `AdminGuard` +
`@RequiresPermission` idiom — `@RequiresModule('evangelism')` sets metadata via `Reflector`, and `ModuleEnabledGuard`
(added into the controller's existing `@UseGuards([...])` array, not a separate decorator call) reads it and calls
`isEnabled()`, throwing `403` if the module is off. Applied at the controller level across every optional module's
admin and member-facing controllers, so a disabled module is fully unreachable via the API, not just hidden in the
UI.

**`GET /modules/state`** (`JwtAuthGuard`, any authenticated member/worker/admin) is the one shared source of truth
for "is module X on," returning `{ key, enabled, displayName }[]` for every known module (`displayName` falls back
to the module's default label). Both discuva-admin's sidebar and discuva-member mobile's Explore/Ministry/Leadership
tiles read from this single endpoint (`useModuleState()` hook, near-identical implementation in both frontends)
rather than each frontend independently guessing module state — the same duplication risk already seen once with
discuva-admin's hardcoded permission-group list (see Admin Module's `AdminPermissionGroups` note below).

**`AdminPermissionGroups` visibility tied to module state:** each `AdminPermissionGroup` (see `AdminPermission` enum
reference) optionally carries a `moduleKey`. discuva-admin's role-permission picker (`app/admin-management/page.tsx`)
and the read-only permission display (`app/profile/page.tsx`) both filter `PERMISSION_GROUPS`/`AdminPermissionGroups`
through `isModuleEnabled(group.moduleKey)` before rendering — an admin is never offered permissions for a feature
that's disabled for their church. Core, non-toggleable groups (Members, Events & Venues, Departments, Attendance,
Finance, Administration, etc.) carry no `moduleKey` and are always shown.

**Routes prefix:** `/admin/settings` (admin CRUD), `/modules/state` (shared read endpoint, all authenticated roles)

### Reminder Settings Module

Lets a tenant admin control the timing (and on/off state) of 8 reminder-email categories, per-installation, without a
deploy — previously every value below was either a hardcoded literal or a single global env var, invisible and
unconfigurable to anyone but whoever edits deploy config. Backed by the **same `ChurchSetting` entity/table** as the
Church Settings module above (`key` unique, `value: jsonb`), under a disjoint key namespace (`` `reminder:${key}` ``)
— reuses the proven pattern with zero new migration, but through its own service/controller
(`ReminderSettingsService`/`ReminderSettingsController`), since the value shape (`{ enabled, thresholds }`) and
whitelist (`ReminderSettingKey`) differ from the module-toggle shape and shouldn't be forced through
`ChurchSettingsService`.

**Not the same thing as `EmailCategory`:** `src/utility/email-provider/email-category.enum.ts` gates every
category of email the system sends, at a **coarser granularity** than reminder settings — e.g.
`EmailCategory.ASSET_ALERTS` is shared by all 4 asset schedulers (maintenance, warranty, vehicle-expiry,
overdue-checkout), `EmailCategory.FINANCE_ALERTS` by both pledge and budget alerts. It used to be global-only
(env-flag booleans in `EmailQueueService.isCategoryEnabled`) — it now also has a per-tenant override
(`EmailCategorySettingsService`, see "Email Category Settings Module" below), but `ReminderSettingKey` remains a
separate, finer-grained, per-tenant enum layered *on top* of both — if either the env flag or the tenant's
`EmailCategory` setting is off, that still suppresses sends regardless of any tenant-level `ReminderSettingKey`
setting (`EmailQueueService.queueEmail` checks its own two gates before a job is ever enqueued, upstream of anything
the reminder schedulers decide).

**`KNOWN_REMINDER_SETTINGS`** (`src/reminder-settings/constant/known-reminder-settings.constant.ts`) — the 6 keys,
each `{ label, unit, defaultThresholds }`. `thresholds` is a list of signed integers whose meaning depends on the
key's `unit`: for the date-based ones it's day-offsets relative to a due/expiry date (positive = before, `0` = on
the day, negative = after/overdue); for `budget_alert` it's percent-of-budget-used thresholds. Defaults exactly
match each scheduler's prior hardcoded/env-default value, so shipping this was behavior-neutral until a tenant
actually changes one:

| `ReminderSettingKey` | Unit | Default thresholds | Scheduler |
|---|---|---|---|
| `pledge_reminder` | days relative to due date | `[7, 0, -3]` | `PledgeReminderScheduler` |
| `budget_alert` | % of budget used | `[80, 100]` | `BudgetAlertScheduler` |
| `follow_up_stale` | days since last activity | `[7]` | `FollowUpScheduler.notifyInactiveTasks` |
| `asset_maintenance` | days before due | `[7, 3, 1, 0]` | `MaintenanceReminderScheduler` |
| `asset_warranty` | days before expiry | `[30, 14, 7, 1]` | `WarrantyAlertScheduler` |
| `vehicle_expiry` | days before expiry | `[30, 14, 7, 1]` | `VehicleExpiryAlertScheduler` |
| `assignment_due` | days relative to due date | `[3, 1, 0]` | `AssignmentReminderScheduler` |
| `class_session` | hours before session | `[24, 1]` | `ClassSessionReminderScheduler` |

**`smsEnabled` — email-always, SMS-optional (Training Classes only):** `assignment_due` and `class_session` are the
only two reminder keys with a tenant-configurable `smsEnabled: boolean` (default `false`) on top of the usual
`enabled`/`thresholds` shape (`ReminderSettingValue`/`ReminderSettingResponseDto`/`UpdateReminderSettingDto` all
carry it; stored on the same flexible `ChurchSetting.value` jsonb column, no migration needed). Every other
reminder key is email-only and unaffected. The email always sends when a threshold matches (to `member.email` or
`guest.email` — both exist for every Training Classes enrollee now, guest or member); SMS is an *additional* send,
skipped entirely unless `smsEnabled` is on **and** a phone number is on file for that specific enrollee (a guest's
`phone` is optional). This mirrors the guest contact model chosen for Classes generally: email-first, phone/SMS
opt-in — see the `Guest` entity section above.

- `AssignmentReminderScheduler` (`src/classes/scheduler/assignment-reminder.scheduler.ts`): for each published
  `Assignment` with a `dueDate`, finds `IN_PROGRESS` enrollees of its class (member or guest) with **no matching
  submission yet** (`ClassEnrollment` LEFT JOIN `AssignmentSubmission` on either `member_id` or
  `class_enrollment_id`, `WHERE submission IS NULL`), computes `diffDays` vs. today, and — if it matches a
  configured threshold — emails (`assignment-due-reminder` template, `EmailCategory.ASSIGNMENT_REMINDER`) and
  optionally SMS-nudges (generic, non-personalized text, no link) every qualifying enrollee. Cache-deduped per
  `(assignmentId, enrolleeId, diffDays)` so a reminder never double-sends within the same day.
- `ClassSessionReminderScheduler` (`src/classes/scheduler/class-session-reminder.scheduler.ts`): same structural
  pattern, keyed per `ChurchClass` with `nextSessionAt` set (not per-assignment) — `diffHours`, not `diffDays`,
  matching this key's hours-based unit. Emails `IN_PROGRESS` enrollees (`class-session-reminder` template,
  `EmailCategory.CLASS_SESSION_REMINDER`) with the class name, session time, and `meetingLink` (conditionally
  rendered in the template if set); SMS text includes the meeting link when present. Separate scheduler/key from
  `assignment_due` since they're conceptually different triggers (per-assignment vs. per-class) and admins may
  want different thresholds for each (e.g. "1 hour before" for a meeting vs. "3 days before" for an assignment
  deadline).
  - **Calendar invite:** every send also attaches a generated `.ics` file (`class-session.ics`, built via
    `buildIcsEvent` — see "Calendar invites (`.ics`)" below) so the session can be added to the recipient's
    calendar directly from the email, the same treatment `service-slot-assigned`/`service-slot-reminder` already
    give a service assignment. `ChurchClass` has no explicit session-duration field, so the invite defaults to a
    1-hour block starting at `nextSessionAt`. The invite's `UID` is keyed on `` `${churchClass.id}-${nextSessionAt.getTime()}@classes-session` ``
    — built once per (class, session) and reused for every recipient of that run — so repeated reminders (24h,
    1h) for the *same* unchanged session update the one calendar entry the recipient already has, while
    rescheduling `nextSessionAt` produces a new entry rather than silently mutating the old one. `meetingLink`,
    when set, is used as both the invite's `LOCATION` and its description text.

Both use the same `forEachActiveTenant` + Redis-lock + per-tenant `getConfig()` pattern as every other reminder
scheduler (see "Runtime read" below) and are registered in `ClassesModule` (not a separate module) — they're
Training Classes-specific, not general-purpose. `AssignmentReminderScheduler` runs `@Cron(EVERY_DAY_AT_8AM)`,
matching the date-based thresholds; `ClassSessionReminderScheduler` runs `@Cron(EVERY_HOUR)`, matching its
hours-based thresholds — an hourly-granularity trigger needs an hourly check to land on the right hour.

**Explicitly excluded** from tenant control (unreachable by any tenant-facing route, unchanged hardcoded/global
behavior): `overdue-checkout` alerts (asset accountability — a deliberate product decision, not a tenant
preference), prayer reminders (dual 2-day-ahead/day-of logic doesn't fit the list-of-offsets shape), and Pastor
Feedback's weekly reminder (its timing *is* the `@Cron('0 9 * * 1')` schedule itself — tenant-configurable cron
cadence would need dynamic `SchedulerRegistry` registration, a materially different change than a settings value).

**Runtime read (`getConfig(key)`):** each of the 8 schedulers calls this **inside** its `forEachActiveTenant(...)`
callback — not once at construction — since cron jobs have no ambient tenant context outside that loop, and
`CacheService`'s tenant-scoped cache keys rely on the CLS store `forEachActiveTenant` populates per iteration. If
`enabled` is `false`, the scheduler returns before any email is queued for that tenant that run.

**Per-scheduler notes:**
- `BudgetAlertScheduler`: unlike the date-based schedulers' `thresholds.includes(diffDays)` check, budget alerts use
  `thresholds.some(t => utilizationPct >= t && !alreadySent(t))`, sorted descending so only the highest newly-crossed
  threshold fires per run (matches the original 80/100 behavior of never double-alerting in one pass). Dedup moved
  from the old fixed `alert80SentAt`/`alert100SentAt` columns to a generic `Budget.alertsSent: number[]` jsonb column
  (arbitrary threshold count needs a matching data structure) — see `AddBudgetAlertsSentColumn` migration. The old
  columns are left in place, unused, rather than dropped, to avoid irreversible data loss on this pre-existing table.
- `MaintenanceReminderScheduler`: same generic-column treatment — `MaintenanceSchedule.notifiedThresholds: number[]`
  replaces the 4 fixed `notifiedNDaysAt` columns. The **overdue** branch (`daysUntilDue < 0`) is untouched — still an
  unconditional daily nag via `lastOverdueNotifiedAt`, not part of the configurable threshold list (deliberate:
  `asset_maintenance`'s unit is "days before due," it was never meant to cover overdue).
- `WarrantyAlertScheduler`/`VehicleExpiryAlertScheduler`: same treatment on `Asset` — `warrantyNotifiedThresholds`,
  `insuranceNotifiedThresholds`, `roadworthinessNotifiedThresholds` (3 new jsonb columns) replace 12 old fixed
  columns combined. See `AddAssetExpiryNotifiedThresholds` migration.
- `FollowUpScheduler.notifyInactiveTasks`: `FOLLOW_UP_STALE_DAYS` env var removed entirely (superseded); if multiple
  thresholds are ever configured, the minimum is used as the staleness cutoff (a single scalar concept, using the
  same list shape as the others for UI/DTO consistency, not because multiple values are meaningful here).
- `PledgeReminderScheduler`: `getNextDueDate`'s recurrence-search window, previously hardcoded to look 8 days ahead
  (matched the old fixed `7` threshold), now derives its lookahead from `Math.max(...thresholds)` — a tenant
  configuring a threshold further out than 7 days would otherwise silently never match, since the search would stop
  before reaching it.

**Routes:** `GET/PATCH /admin/reminder-settings`, `GET/PATCH /admin/reminder-settings/:key` — same `AdminGuard` +
`AdminPermission.ADMIN_WRITE`-on-write pattern as `/admin/settings` above.

**Frontend:** discuva-admin's `/notification-settings` page (own `layout.tsx` wrapping `<Shell>` — every new
top-level route needs one, there is no global Shell in root `layout.tsx`) — one row per setting: an enabled/disabled
toggle plus an editable numeric-chip list (add/remove) for `thresholds`. The `assignment_due`/`class_session` rows
additionally show an SMS toggle bound to `smsEnabled` — every other row hides it, since only those two keys carry
the field.

### Email Category Settings Module

Lets a tenant admin turn off any of the 15 `EmailCategory` values for their own church — the gap that made every
category effectively mandatory in practice: the only pre-existing suppression mechanism
(`EmailQueueService.isCategoryEnabled`) was gated behind process-wide `EMAIL_<CATEGORY>_ENABLED` env vars, so
disabling one meant disabling it for **every** tenant simultaneously (a single NestJS process serves all tenants).
Same `ChurchSetting`-backed pattern as Reminder Settings above (own key namespace, `` `email_category:${category}` ``,
zero new migration), own service/controller (`EmailCategorySettingsService`/`EmailCategorySettingsController`) since
the value shape (`{ enabled }`) and whitelist (`EmailCategory`, already defined in `src/utility/email-provider/`) are
unrelated to the module-toggle and reminder-threshold shapes.

**Two independent gates, either can suppress:** `EmailQueueService.isCategoryEnabled(category)` checks the env var
first (unchanged, still the platform-wide kill switch — rarely touched, requires a redeploy) and only calls
`EmailCategorySettingsService.isEnabled(category)` if the env var didn't already suppress it, so a globally-disabled
category never even reaches the tenant-level DB/cache lookup.

**Module wiring note:** `EmailCategorySettingsModule` is `@Global()` but deliberately does **not** import
`UtilityModule` (also `@Global()`) — `EmailQueueService` lives inside `UtilityModule` and needs to inject
`EmailCategorySettingsService`, so an explicit cross-import would be circular. Since both modules are global, this
isn't needed: `UtilityModule`'s own exports (`CacheService`, `AuditLogService`) resolve into
`EmailCategorySettingsService`'s constructor regardless of whether its module lists `UtilityModule` in `imports`.

**`KNOWN_EMAIL_CATEGORIES`** (`src/email-category-settings/constant/known-email-categories.constant.ts`) — a
`{ label, description }` per category, all defaulting to enabled (no DB row = on, same fail-open default every
other settings mechanism in this codebase uses).

**Fixed alongside:** `EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT` was referenced in
`EmailQueueService`'s flag map but had no corresponding `EMAIL_SERVICE_PROGRAMME_ASSIGNMENT_ENABLED` entry in
`env.validation.ts`/`.env.example` — harmless while true (`undefined !== false`), but meant the var could never
actually be set without Joi's `forbidNonWhitelisted` rejecting it. Now registered like the other 14.

**Routes:** `GET/PATCH /admin/email-category-settings`, `GET/PATCH /admin/email-category-settings/:category` — same
`AdminGuard` + `AdminPermission.ADMIN_WRITE`-on-write pattern as `/admin/reminder-settings`.

**Frontend:** a new "Email Categories" section on discuva-admin's existing `/notification-settings` page, below the
reminder-settings section — one row per category, a plain enabled/disabled toggle (no thresholds, unlike reminder
settings).

### Event Module

Manages events and service slots. Events can be single or recurring (daily/weekly/monthly). At least one `serviceSlot`
is required at creation — each slot carries an optional `configId` pointing to an `EventConfig`. For recurring events
the same slot template (including `configId`) is stamped onto every generated occurrence; updating the config later
propagates to all check-ins that reference it.

`CreateEventDto` takes no `eventDate`/`endDate`/`startTime`/`endTime` fields — all four are always derived from the
supplied `serviceSlots` (`eventDate`/`endDate` = earliest `startTime`/latest `endTime`, UTC-date-truncated so the
result doesn't depend on server timezone; `startTime`/`endTime` are the same two instants kept at full precision).
This applies on both `create` (including each recurring occurrence, computed from its own offset-shifted slots) and
`update` (whenever `serviceSlots` is replaced). There is no longer a "manual" date range independent of the slots —
previously a caller could set an event date range that didn't match its slot times (e.g. editing a slot's time left
the event's dates stale), which this removes by construction.

`eventDate`/`endDate` stay date-only because several queries filter on a calendar day (e.g. "events today or later").
`startTime`/`endTime` exist alongside them specifically because a date-only comparison can't tell whether an event
that ends later *today* has actually finished yet — `getUpcomingEvents` and `findEventsReadyForAbsenceMarking` both
filter on `endTime`, not `endDate`, for this reason, and both frontends' "Past" badge logic does the same.

**Routes prefix:** `/events`, `/event-config`

Each slot can have multiple reminder schedules via sub-resource `/events/slots/:slotId/reminders` (admin-only). See EventReminder model.

**Admin frontend UX (`discuva-admin`, `app/events/page.tsx`):** since the event's date range is entirely derived from its slots' times (no manual override, per above), the create/edit form's `SlotRow` sets `min` on the datetime-local inputs (a slot's End Time can't be earlier than its own Start Time; each slot after the first has its Start Time's `min` set to the previous slot's End Time, since slots run in sequence) — but `min` on `type="datetime-local"` only reliably restricts the browser's *calendar* date view; the time-of-day spinner on an already-valid date isn't blocked interactively in Chrome/most browsers, only flagged `:invalid` on blur/submit, which read as "not working" for the time portion. `updateSlot()` therefore also clamps values in JS the instant they change: a slot's End Time snaps forward to match its Start Time if set earlier, a slot's Start Time snaps forward to the previous slot's End Time if set earlier (pulling its own End Time along if that would now precede it), and moving a slot's End Time later pulls the next slot's Start Time forward with it if it would otherwise fall behind. `min` is kept alongside this for the calendar-level hint; the JS clamp is what actually prevents an invalid time-of-day from sticking. Neither replaces backend validation, which still governs what's actually accepted on submit.

**Reminder dispatch (cron `*/15 * * * *`):** Queries `EventReminder` rows where `enabled = true`, `lastSentAt IS NULL`, `fireAt <= now`, and `slot.startTime > now`. The filter runs entirely in SQL — `fireAt` is pre-computed at reminder creation (and recalculated if `intervalPreset` is updated). When a slot is deleted or recreated (e.g., event update), its reminders are cascade-deleted. On `create`, `fireAt = slot.startTime − preset_minutes`. On `update` with a new `intervalPreset`, `fireAt` is recalculated from the existing slot's `startTime`.

**Service slot ordering:** `EventService.getAll()`, `getById()`, and `getUpcomingEvents()` all explicitly order the `serviceSlots` relation by `startTime` ASC (query-builder `.addOrderBy('serviceSlots.startTime', 'ASC')` for `getAll`; TypeORM's relation `order` option for the other two, e.g. `order: { serviceSlots: { startTime: 'ASC' } }`). Without this, a joined one-to-many relation has no guaranteed order — First/Second Service could come back in either order depending on DB/join internals, which showed up as the admin portal's event list not consistently showing slots in the order they begin.

**Editing an event's slots is blocked once the event has any recorded history.** `EventService.update()`'s slot-replacement path (`slotRepository.delete` + recreate) previously ran unconditionally — `ServiceProgramme`/`ServiceSession`/session-slots/action-log all cascade off `ServiceSlot`, and `Attendance.serviceSlot` is `ON DELETE SET NULL`, so replacing the slots on an event that had already run would silently destroy its programme/session history and detach any recorded attendance from the slot it was for. `hasRecordedHistory(eventId)` now checks (via two raw `dataSource` queries, matching `attachMyAttendance`'s existing pattern rather than adding new repository injections) whether any `attendances` row or any `service_sessions` row (joined through `service_programmes`/`service_slots`) exists for the event; if either does, the whole `PATCH` is rejected with a 400 before touching any slot. Cosmetic fields (`name`/`description`) remain editable regardless — only `serviceSlots` replacement is gated. This is a one-way door: once an event has history, its schedule can never be edited again, only replaced by creating a new event (a deliberate, safer default over a more capable diff-based in-place slot update, which was considered and explicitly deferred).

**`deleteEvent`/`deleteFutureRecurring`/`getAll`'s `upcoming` filter now use precise `startTime`/`endTime`, not the date-only `eventDate`/`endDate`** — same class of fix as `findEventsReadyForAbsenceMarking`/`getUpcomingEvents` above, just not originally carried through to these three call sites. Concretely: `deleteEvent` previously compared `eventDate` (start date) to today, so a same-day event that had already fully ended hours ago was still deletable; now blocks on `endTime < now`. `deleteFutureRecurring` previously selected occurrences via `eventDate >= today`, so an already-started (or already-ended) same-day occurrence still counted as "future"; now uses `startTime >= now`, and — previously entirely missing — also filters `attendanceMarked = false`, matching `deleteEvent`'s own guard (this bulk path bypasses `deleteEvent` entirely, so it needs the same safety check independently). `getAll`'s `upcoming` filter now matches `getUpcomingEvents`' own semantics (`endTime >= now`) instead of showing an already-ended-today event as still upcoming.

**Recurring event occurrence spacing is computed in UTC explicitly, not the runtime's local calendar.** `advanceDate()` used `date-fns`' `addDays`/`addWeeks`/`addMonths`, which advance via the process's *local* timezone; the resulting date-to-date millisecond delta is then applied directly to each generated occurrence's absolute slot `startTime`/`endTime`. If the runtime's local timezone ever observed DST, a transition between occurrences would skew every subsequent occurrence's actual time by up to an hour — the same category of server-timezone dependence `truncateToUtcDate` already guards against elsewhere in this service. Rewritten to advance via `setUTCDate`/`setUTCMonth` instead, so occurrence spacing is exact regardless of server `TZ`.

### Venue Module

Manages named venue records referenced by event configs and individual service slots. Venues decouple location data from
event creation — create a venue once, reference it by ID in any config or slot.

**Routes prefix:** `/venues`  
**ADMIN:** create, update, delete  
**Any authenticated user:** list (full, unpaginated — admin-controlled reference data), get by ID, find nearby venues by radius

`latitude` and `longitude` must be updated together on `PATCH` — providing only one is rejected by validation, preventing a venue's stored point from being silently detached from reality mid-edit.

### Attendance Module

**Check-in window logic:**

- Window opens: `slot.startTime + workerCheckinStartOffsetSeconds` (workers) or `+ memberCheckinStartOffsetSeconds` (
  members)
- Window closes: `slot.startTime + checkinStopOffsetSeconds` (same for all)
- Workers are LATE if they check in after `slot.startTime + workerLateOffsetSeconds`
- Members are always PRESENT if within the window

**Location is required from members too when the tenant enforces distance checking, not just workers.**
Workers on an `IN_PERSON` slot have always had a hard requirement (`checkin()` throws if `!dto.location`), unconditional
regardless of the enforce-distance setting. Members previously had no equivalent — `location` is `@IsOptional()` on
`CheckInDto`, so a member could simply omit it and skip distance validation entirely (`validateLocation()` only
runs `if (dto.location && cfg.venue)`), independent of whether the tenant had enforcement turned on. Now, for an
`IN_PERSON` slot, a member omitting `location` while `enforceDistance()` is `true` gets a `BadRequestException`
("Your location is required to check in for this service"); when enforcement is off, location stays fully optional
for members (matches `validateLocation()`'s own behavior — it never rejects on distance when unenforced, so
requiring location unconditionally would add friction with no effect).

**`EventConfigService.validateOffsets` cross-checks `checkinStopOffsetSeconds` against `memberCheckinStartOffsetSeconds`
too, not just `workerLateOffsetSeconds`.** Without this a config could pass every existing check yet still leave
members with an impossible window — e.g. `workerCheckinStart=-600, workerLate=-30, checkinStop=-15` all validate
fine against each other, but `memberCheckinStart=-10` means members' window would only *open* at -10s, after
check-in had already *closed* at -15s.

**Per-event, not per-slot, check-in dedup is intentional, not a bug.** `Attendance` has `@Unique(['member', 'event'])`
— a worker rostered for multiple slots of the same event (e.g. serving both First and Second Service) checks in
*once* for the whole event, not once per slot. This is a deliberate compromise: requiring a separate check-in per
slot for every service someone serves in the same event was judged worse than the alternative. Do not "fix" this
by moving to a per-slot unique constraint without revisiting the product decision first.

**`markAbsentees()` defers all `followUpQueue.add()` calls until the entire batch has been written without error.**
The whole per-tenant cron run is one Postgres transaction (`this.txHost.tx`, entered by `forEachActiveTenant`), but
`followUpQueue.add()` is a Redis/Bull side effect that isn't part of that transaction and can't roll back with it.
Previously each event's Bull job was enqueued immediately after its own DB writes, inside the same loop — so if a
*later* event in the batch threw (e.g. a race with a concurrent check-in hitting the unique constraint above),
the whole transaction rolled back, but jobs already enqueued for *earlier* events in that same run did not, leaving
`POST_EVENT_JOB`s scheduled for events whose absence rows no longer existed. Now every event's `{event}` is
collected during the loop and only enqueued in a second pass after the loop completes successfully — if anything
throws mid-batch, nothing has been enqueued for any event in that run, matching the transaction's own all-or-nothing
semantics.

**`AttendanceService.getBatchApprovedLeave` compares leave dates against `event.eventDate` as a plain `'YYYY-MM-DD'`
string, not the raw `Date` object.** `event.eventDate` is a `date` column, hydrated by the pg driver as a JS `Date`
at local-timezone midnight; passing that `Date` directly as a query parameter risks the driver re-serializing it
(e.g. via UTC `toISOString()`) before Postgres compares it against `request_leave.date_from`/`date_to` (also `date`
columns), which can shift the effective calendar date by a day depending on server timezone. Formatting it as a
plain date string first (via local getters, which round-trip the same y/m/d the pg driver used to construct the
`Date` in the first place, regardless of what the server's actual local timezone is) sidesteps that reinterpretation
entirely — Postgres parses the string as a `DATE` literal with no timezone involved.

**`AttendanceService.confirmOnlineAttendance` no longer locks a member out mid-window if `onlineAttendanceEnabled`
is toggled off after the confirm emails already went out.** Previously checked `event.onlineAttendanceEnabled`
unconditionally first — an admin disabling the toggle after `onlineNotificationSentAt` (but before the window
closes) meant every member clicking their already-sent confirmation link got "Online attendance is not enabled for
this event" instead of the window simply running its course. Now checks `onlineNotificationSentAt` first: if it's
set, the window was already opened for this event and stays valid regardless of the toggle's current state; the
toggle is only checked (for the clearer "not enabled" vs. "window has not opened yet" message) when the window was
never opened at all. Also now compares against `this.dateService.now()` instead of a bare `new Date()`, matching
the rest of the module's convention.

**`checkinStopOffsetSeconds` cannot leave check-in open past a slot's own end time.** Enforced in
`EventService.buildSlotFromDto` (not `EventConfigService`, since the same config can be reused across slots of
different durations — only at slot-save time, once a specific `startTime`/`endTime` is known, can "does this offset
exceed the slot's own length" be judged): the effective value (`serviceSlot.checkinStopOverride ?? config.checkinStopOffsetSeconds`)
must be `<= (endTime - startTime)` in seconds, else `BadRequestException`. discuva-member's home hero card previously
kept showing "Live Now" for as long as this window stayed open, which — before this constraint existed — could
outlive the admin side's own "ended" determination by however long a positive offset was configured, since the
offset is relative to `startTime`, not `endTime`. Tenant migration `CapCheckinStopOffsetAtSlotEnd` clamps any
existing `service_slots.checkin_stop_override` (setting one explicitly, capped to that slot's own duration, only for
the offending slot — the shared `event_configs` row is left untouched so other slots using the same config are
unaffected) for rows where the effective offset already exceeded their own slot's length.

**Attendance Distance Check Setting — two layers, per-tenant override on top of a platform-admin default.**
Previously `ENFORCE_DISTANCE_CHECK` was a single global env var — one on/off switch shared by every tenant, no
per-church control, requiring a redeploy to change. Now two layers, same shape as the upload-limit settings above:

1. **Platform-wide default** (`PlatformSettingKey.ENFORCE_DISTANCE_CHECK_DEFAULT`, `PlatformSettingsService.
   getEnforceDistanceCheckDefault()`) — platform-admin-editable live via `/platform/settings`, same page as the
   upload limits and subscription grace period. Stored as `0`/`1` (`type: 'boolean'` in the response — the
   settings page renders a toggle instead of a number input for this one, discuva-platform's
   `billing-settings/page.tsx`). Unlike every other `PlatformSetting`, its "no row yet" fallback is **not** a
   hardcoded `KNOWN_PLATFORM_SETTINGS` default — `PlatformSettingsService.resolveDefault()` reads the live
   `ENFORCE_DISTANCE_CHECK` env var instead, specifically so shipping this didn't silently flip behavior for any
   environment that already had that env var set to something other than the old default.
2. **Per-tenant override** (`AttendanceSettingsService`, `src/attendance/service/attendance-settings.service.ts`)
   — `ChurchSetting`-backed (`key: 'attendance:enforce_distance_check'`), same pattern as `ReminderSettingsService`/
   `EmailCategorySettingsService` but living inside `AttendanceModule` rather than its own top-level module, since
   it's a single key, not a family. `getConfig()` returns `{enabled, isPlatformDefault}` so the admin UI can show
   whether a church is following the platform default or has set its own value. `AttendanceService.enforceDistance()`
   calls `AttendanceSettingsService.isEnabled()` (cached, tenant-scoped) on every check-in with a location — no
   longer a value read once at boot into a constructor field.

**Routes:** `GET/PATCH attendances/settings/distance-check` (`AdminGuard`, `ATTENDANCE_READ`/`ATTENDANCE_WRITE`) —
admin read/write. `GET attendances/me/distance-check` (`JwtAuthGuard` only) — member-readable mirror of the same
`AttendanceSettingsService.getConfig()`, added so the member app can skip its own client-side distance pre-check
when a tenant has enforcement turned off, instead of always blocking regardless of the setting. Not sensitive
data, safe for any authenticated member to read.
**Frontend (admin):** discuva-admin's Event Config page (`DistanceCheckBanner`) — sits alongside the
per-`EventConfig` "Allowed Distance (meters)" field it works together with: the radius is per-config, this toggle
is tenant-wide.
**Frontend (member):** discuva-member's `useEvents` hook fetches `GET attendances/me/distance-check` once and
gates its existing client-side pre-check (computed before the `POST /attendances/checkin` call, using the
device's geolocation and the slot's resolved venue/`allowedDistanceInMeters`) behind `distanceCheckEnforced`. A
distance-blocked check-in — whether caught client-side or returned by the server — gets a visually distinct "Too
Far Away" treatment (not the generic "Check-in Failed" look) via the `code: 'TOO_FAR'` field described below.

**Too-far check-in — structured exception, not just a message string.** `AttendanceService.validateLocation()`
throws `BadRequestException({ message: 'You are too far from the venue to check in.', code: 'TOO_FAR',
distanceMeters, allowedDistanceInMeters })` — extra keys beyond `message` are spread into the JSON response body
by the global exception filter (`HttpExceptionFilter`, same mechanism `PlanGuard`'s `code: 'PLAN_UPGRADE_REQUIRED'`
already uses). `distanceMeters` is the member's actual computed distance (rounded), included so the frontend can
show it even when the failure came from the server rather than the client's own pre-check.

**`EventConfig.enforceMemberLocation` — a separate, per-config setting from distance-check above.** Workers on an
`IN_PERSON` slot have always had a hard, unconditional requirement to submit location (`checkin()` throws if
`!dto.location`, regardless of the distance-check setting). Members had no equivalent — `location` is
`@IsOptional()` on `CheckInDto`, so a member could simply omit it and skip `validateLocation()` entirely (which
only runs `if (dto.location && cfg.venue)`), independent of whether distance-check enforcement was on. This setting
lets a tenant require the same of members, **scoped per `EventConfig`** (like `allowedDistanceInMeters`, not the
tenant-wide `AttendanceSettingsService`/distance-check toggle) — a church can require it for their main Sunday
service's config while leaving a small-group config unaffected. Deliberately **not** merged into
`enforceDistance()`/the distance-check setting — the two answer different questions ("is a too-far check-in
rejected" vs. "must location be submitted at all") and a config may want either without the other (e.g. requiring
members to share location for record-keeping without necessarily blocking anyone who happens to be far away).

- **Storage**: `EventConfig.enforceMemberLocation` (boolean column, default `false`), with a per-slot override —
  `ServiceSlot.enforceMemberLocationOverride` (nullable boolean, `null` = inherit from config) — same override
  pattern as `checkinStopOverride`/`allowedDistanceOverride`. Resolved in `EventService.resolveSlotConfig()`
  (`slot.enforceMemberLocationOverride ?? config.enforceMemberLocation`) alongside every other per-slot-resolved
  setting, so `AttendanceService.checkin()` reads it synchronously off the already-resolved config rather than a
  separate settings lookup.
- **Enforcement**: `AttendanceService.checkin()` — for an `IN_PERSON` slot, a member omitting `location` while the
  resolved `cfg.enforceMemberLocation` is `true` gets `BadRequestException('Your location is required to check in
  for this service.')`.
- **DTOs**: `CreateEventConfigDto.enforceMemberLocation?: boolean` (defaults to `false` in `EventConfigService.create()`
  when omitted, same as `autoStartSession`), `CreateServiceSlotDto.enforceMemberLocationOverride?: boolean`.
- **Frontend (admin)**: discuva-admin's Event Config page — a toggle inside each config's create/edit form
  (alongside "Auto-Start Programme"), not a standalone tenant-wide banner like distance-check. Reflected as a
  small "Member location required" badge on the config list row and detail view when on.

**Distributed absence-marking lock:** The every-5-minute cron job acquires a Redis `SET NX EX 270` lock before running. If a second instance starts while the first is running, it sees the lock and skips silently. The TTL (270 s) is shorter than the cron interval (300 s) so the lock self-expires if the process crashes mid-run. Department-scoped history endpoints (`/history/department`, `/department/event/:eventId`) are automatically scoped to the caller's own department via their lead-role assignment — no `departmentId` query parameter is accepted or needed.

**Duplicate check-in:** The `(member, event)` unique constraint is enforced at DB level. If a member tries to check in twice for the same event, the service catches the `QueryFailedError` (PG error code `23505`) and returns `409 Conflict` with the message "You have already checked in for this event."

**Event data on absent records:** Absence records have `serviceSlot = null` (no physical slot was entered). History endpoints (`GET /attendances/my-history`, `GET /attendances/history`, `GET /attendances/history/department`) join the `event` relation directly on the `Attendance` entity rather than through `serviceSlot`, so `event` is always populated regardless of status.

**Lifetime summary (`GET /attendances/my-summary`), computed in SQL not client-side:** Returns
`{ totalCount, presentCount, attendanceRatePercentage, lastCheckedInDate, attendanceStreak }` for the calling
member, via `AttendanceService.getMyAttendanceSummary`. This exists because the mobile app previously derived rate
and streak from whatever page of `/attendances/my-history` it had fetched (e.g. the last 10 records) — correct only
for a member with 10 or fewer lifetime records, silently wrong for anyone else. `attendanceRatePercentage` and
`totalCount`/`presentCount` are a single aggregate query (`COUNT`/`SUM(CASE WHEN status IN (...))`) over the
member's **entire** history (not date-windowed, unlike the admin-dashboard-facing `getPersonalAttendancePercentage`
which defaults to a 30-day window) — `ON_LEAVE` records are excluded from both numerator and denominator (an
approved leave shouldn't count against the rate), and `PRESENT`/`LATE`/`ATTENDED_ONLINE` all count as attended.
`attendanceStreak` delegates to the existing `getAttendanceStreak` (walks the last 500 records newest-first,
skip `ON_LEAVE`, break on `ABSENT`) — already used by the dashboard and already covered by the
`(member, roleAtCheckin, createdAt)` composite index, so no new index was needed for this endpoint.

**Admin-assisted attendance (`AttendanceService.adminMarkAttendance`):** one action covers two cases —
checking in a member/worker with no phone (no `Attendance` row exists yet for that member+event), and
"restoring a streak" for someone auto-marked `ABSENT` by the absence-marking cron (a row already exists —
this just updates it). There's no separate streak field to repair: `attendanceStreak` is always computed live
from `Attendance` rows (see `getAttendanceStreak` above), so fixing/creating the row *is* the fix. If a record
already exists for `(member, event)` its `status`/`serviceSlot` are updated and `checkinTime` is left untouched
if already set; otherwise a new record is created with `checkinTime = now`, `roleAtCheckin` = the member's
current role, and `location: null` (this is an assisted check-in, not GPS-verified). Reachable two ways:
- `POST /attendances/admin/mark` — admin portal, `AdminGuard` + `ATTENDANCE_WRITE`.
- `POST /attendances/department/mark` — mobile app, `JwtAuthGuard` only, gated in-service by
  `assertIsAdminDeptWorker()` (the caller's `workerProfile.department` or `secondaryDepartment` must have the
  `FRONT_DESK_OPERATIONS` capability — the same capability idiom already used by
  `ServiceSessionService.assertIsAdminDeptWorker`). Front-desk/Admin-department workers get this without
  needing an admin-portal login.

Both routes take `{ memberId, serviceSlotId, status }` (`AdminMarkAttendanceDto`) — the slot determines the
event (`slot.event`), matching how self-check-in (`POST /attendances/checkin`) already resolves it. Audit-logged
as `ATTENDANCE_ADMIN_MARKED`.

**Mobile member picker for admin-assisted check-in (`GET /attendances/department/search-members?q=`):**
deliberately narrow — gated by the same `assertIsAdminDeptWorker()` check, bounded to 10 results
(`MemberService.searchActiveMembersLite`), and returns only `id`/`firstname`/`lastname`/`role` (no email or
phone) since this is a lookup for "which person is standing in front of me," not a general member directory.
This is the one exception in the codebase to "no non-admin member-search endpoint" — justified because the
whole point of this flow is finding one named person on the spot; it's scoped tightly enough (Admin-department
workers only, minimal fields, capped results) that it doesn't reopen a general member-picker surface.

**Email export (`POST /attendances/export-email`):** same shared pattern as `/service-headcount/export-email` — filters
the same query `GET /attendances/history` already runs (no pagination), builds an `.xlsx`, and emails it via the
`report-export` template.

**Leaderboard chart (discuva-admin, `app/attendance/page.tsx`):** the Leaderboard tab has a Table/Chart toggle —
Chart renders a horizontal present/absent bar per worker via the same `components/charts/bar-chart.tsx` wrapper
introduced for the headcount trends charts. No new backend aggregation — `GET /attendances/leaderboard` was already
aggregate-shaped (`presentCount`/`absentCount` per worker).

**Routes prefix:** `/attendances`

### Department Module

Departments are the workforce units. Each can have a head and assistant lead assigned from its worker members. The
optional `key` field on a department links it to a module-access category (e.g. `SUNDAY_SCHOOL`, `CHILDREN_CHURCH`,
`MEDIA`). Multiple departments can carry the same key.

`GET /departments` returns the **full list** (unpaginated) — department count is admin-controlled and bounded. Workers
by department (`GET /departments/:id/workers`) remains paginated as it can be large.

**Routes prefix:** `/departments`

### Pastor Feedback Module

A weekly, structured feedback channel from departments up to the pastorate — the department's HOD or Assistant HOD (D_HOD) submits it; a pastor reads and responds, from either the admin portal or the mobile app.

**Three controllers, one service:**
- `pastor-feedback-worker.controller.ts` (`JwtAuthGuard`) — `POST /pastor-feedback` (submit), `PATCH /pastor-feedback/:id` (edit own), `GET /pastor-feedback/my` (own history). Ownership is checked in-service (HOD/D_HOD of the target department), not by role alone.
- `pastor-feedback-admin.controller.ts` (`AdminGuard`) — cross-department browse/edit/delete (`PASTOR_FEEDBACK_READ`/`WRITE`), plus `POST /pastor-feedback/admin/:id/respond` for an admin whose linked `Member` has a `Pastor` record.
- `pastor-feedback-pastor.controller.ts` (`JwtAuthGuard`, mobile-facing) — same cross-department browse plus `POST /pastor-feedback/pastor/:id/respond`, gated by `assertIsPastor()` (any `Pastor` record) rather than an admin permission.

**Weekly reminder scheduler (`PastorFeedbackReminderScheduler`):** `@Cron('0 9 * * 1', { timeZone: CHURCH_TIMEZONE })` — Monday 9am. Computes `weekOf` as the Monday of the week that just closed, finds every `Department` with no `PastorFeedback` row for that week, and emails + pushes a reminder to the department's HOD (falling back to the D_HOD if no HOD is assigned; skipped entirely if neither exists). Unlike `PrayerReminderScheduler`, no `reminderSent` boolean is needed — the row's absence *is* the "still pending" signal, and push de-duplication relies on `PushNotificationService`'s `idempotencyKey` (`pastor-feedback-reminder:{departmentId}:{weekOf}`).

**Routes prefix:** `/pastor-feedback`, `/pastor-feedback/admin`, `/pastor-feedback/pastor`

**Rename data-migration note:** the original Department Feedback → Pastor Feedback rename only renamed the
`AdminPermission` enum values in code (`department_feedback:read/write` → `pastor_feedback:read/write`) — it did
not touch already-granted `AdminRole.permissions` (a raw `text[]` column checked via a plain `.includes()` in
`AdminGuard`, not a normalized join table). Any role granted the old strings before the rename silently lost
access with no error. Fixed by `1788998400000-FixStalePastorFeedbackPermissions.ts`, which `array_replace`s the
old strings for the new ones on every existing `admin_roles` row. **General lesson:** any future rename of an
`AdminPermission` enum value needs a matching data-migration for `admin_roles.permissions`, not just the code
rename — the enum change alone never reaches rows that already exist.

### Prayer Request Module

Lets any member/worker submit a **private** prayer request and, separately, share an **opt-in public** testimony —
either tied to one of their own prayer requests or general. This is distinct from the Prayer Roster Module below,
which schedules workers into prayer-meeting duty slots; this module is member-submitted requests with a lifecycle
(`OPEN` → `PRAYED_FOR` → `ANSWERED`), unrelated to any meeting.

**Visibility:**
- Prayer requests are visible only to the submitter, workers in the Prayer department, and pastors — never a
  public wall. Testimonies default to private; the submitter alone decides at submission time whether theirs
  appears on the shared public feed (`isPublic`) — there is no separate admin moderation/publish step.

**Entities:** `PrayerRequest` (`prayer_requests`) and `Testimony` (`testimonies`), both with a nullable
`member` FK (`SET NULL`) plus a `submittedByName` snapshot, mirroring `PastorFeedback.submittedBy`'s pattern so a
deactivated member's history survives. A `Testimony.prayerRequest` FK (nullable, `SET NULL`) links it to a specific
request; `null` means a general testimony not tied to any request.

**Three controllers, one service (`PrayerRequestService`):**
- `prayer-request-worker.controller.ts` (`JwtAuthGuard`) — `POST /prayer-requests` (submit), `GET /prayer-requests/mine`
  (own history), `POST /testimonies` (submit, optional `prayerRequestId` — enforced to be the caller's own request),
  `GET /testimonies/mine`, `GET /testimonies/public` (the opt-in feed, open to any authenticated member/worker).
- `prayer-request-team.controller.ts` (`JwtAuthGuard`, mobile-facing) — `GET /prayer-requests/team`,
  `PATCH /prayer-requests/team/:id/status`. Gated in-service by `assertIsPrayerTeamOrClergy()`: any worker whose
  primary or secondary department has the `MANAGE_PRAYER_REQUESTS` capability, or any member with a `Clergy` record.
- `prayer-request-admin.controller.ts` (`AdminGuard`) — `GET /prayer-requests/admin`,
  `PATCH /prayer-requests/admin/:id/status`, `GET /testimonies/admin` (full visibility, not just public ones).
  Reuses the existing `PRAYER_READ`/`PRAYER_WRITE` permissions (already grouped under "Prayer Roster" in
  `AdminPermissionGroups`) — no new permission was introduced, since this is the same overall "Prayer" domain.

**Routes prefix:** none fixed — routes span `/prayer-requests*` and `/testimonies*` across the three controllers
(each controller uses `@Controller()` with a full path per handler rather than a single shared prefix, since the
two resources don't share one).

**Pregnancy prayer tracking:** the same module also tracks pregnant women receiving ongoing prayer support —
`PregnancyPrayerCase` (name, EDD, details, status) plus `PregnancyPrayerVisit` (a log entry per prayer/visit,
mirroring the `FirstTimerVisit` idiom in the Follow-Up module). Unlike prayer requests, these are created and
managed entirely by the Prayer team/clergy on the woman's behalf — there is no worker-facing self-submit
controller. `PregnancyPrayerCase.lastPrayedAt` is denormalized and updated whenever a new visit is logged, so the
UI can show "last prayed" without joining the visit log on every read. Reuses `PRAYER_READ`/`PRAYER_WRITE` — no new
permission. Every `PregnancyPrayerVisit` is also readable back via `GET
prayer-requests/team/pregnancy-cases/:id/visits` (mobile) and `GET
prayer-requests/admin/pregnancy-cases/:id/visits` (admin, `PRAYER_READ`) — paginated, newest first, so the full
visit-and-note history is reviewable, not just the denormalized `lastPrayedAt` date. Routes: `GET/POST
prayer-requests/team/pregnancy-cases`, `POST prayer-requests/team/pregnancy-cases/:id/visit`, `PATCH
prayer-requests/team/pregnancy-cases/:id/status`, `GET prayer-requests/team/pregnancy-cases/:id/visits` (mobile,
`assertIsPrayerTeamOrClergy` gated) and the parallel `GET prayer-requests/admin/pregnancy-cases`, `PATCH
prayer-requests/admin/pregnancy-cases/:id/status`, `GET prayer-requests/admin/pregnancy-cases/:id/visits` (admin
portal oversight, read + status-only — case creation and visit logging stay Prayer-team/mobile-only by design).

### Leave Module

Workers request leave with a date range. Approved leave is checked by the cron job: if a worker has approved leave
overlapping a slot's time range, they are marked ON_LEAVE instead of ABSENT.

**Submission guards:**
- A worker with a `PENDING` request cannot submit another until the first is actioned.
- A worker cannot submit a request whose date range overlaps any already-approved leave (`dateFrom ≤ request.dateTo AND dateTo ≥ request.dateFrom`). Returns `400 Bad Request`.

**Date columns (`dateFrom`, `dateTo`):** stored as PostgreSQL `date` (no time component, format `YYYY-MM-DD`). Overlap checks compare date strings to avoid timezone shifts.

**Routes prefix:** `/leave`

### Classes Module (displayed as "Training Classes")

Tracks member progress through structured church programs. The module, route path (`/classes`), and permission keys (`classes:read`/`classes:write`) are unchanged — only the user-facing label was renamed from "Classes"/"Church Classes" to "Training Classes" (sidebar nav, breadcrumbs, page headings, permission labels). Renaming the permission enum *keys* would strand existing `admin_roles.permissions` rows (see the Pastor Feedback rename note under the Pastor Feedback Module section), so only display strings changed.

**Class types:** admin-defined via `ClassType` CRUD (`/classes/types`) — not a fixed enum. Each type optionally points to a `nextClassType`, forming an admin-configured promotion chain (see the `ClassType` entity section above). Deactivating a type (`isActive: false`) hides it from new-class pickers without breaking existing classes that reference it.

**Enrollment statuses:** IN_PROGRESS → COMPLETED or CANCELLED. A `COMPLETED` enrollment whose class type has a `nextClassType` becomes eligible for level promotion (`GET classes/enrollments/:id/promotion-candidate` → `POST classes/enrollments/:id/promote`) — an explicit, separate, admin-confirmed action, not automatic.

**Certificates:** A `COMPLETED` enrollment can be marked as having received a certificate via `PATCH classes/enrollments/:id/certificate` (optional `certificateNumber`) — see the `ClassEnrollment` entity section above.

**Guest enrollment:** non-members can take a class alongside members — see the `Guest`/`ClassEnrollment` entity sections above for the data model and portal-access mechanics. `POST classes/enroll/guest` (body: `EnrollGuestDto` — `classId` + either `guestId` for a returning guest, or `firstName`/`lastName`/`email`(+`phone`/`churchName`/`address`/`notes`) for a new one, + optional per-enrollment `purpose`) enrolls a single guest, finding-or-creating the `Guest` row by email and sending the `class-guest-access` portal-link email on a fresh enrollment (not on re-enrollment of a `CANCELLED` row). `POST classes/enroll/guests/bulk` (body: `BulkEnrollGuestsDto` — `classId` + `guests: {firstName, lastName, email, phone?}[]`) loops the same logic per entry, catching and logging per-entry failures rather than aborting the whole batch, and returns `{ enrolled, skipped }` — mirroring `bulkEnrollMembers`'s all-or-nothing-per-row (not all-or-nothing-per-batch) behavior. Both are blocked (`400`) against a `CLOSED` class.

**Guest management (`GET classes/guests`, `GET classes/guests/:id`):** `GET classes/guests` is a paginated, search-by-name/email list of every guest across all classes (permission `CLASSES_READ`) — the answer to "how does an admin see/manage a guest across multiple classes" without digging through one class's enrollment tab at a time. `GET classes/guests/:id` returns one guest's profile plus every `ClassEnrollment` they've ever had, across all classes.

**Guest-to-member conversion:** `POST classes/guests/:guestId/convert-to-member` (permission `CLASSES_WRITE`) — see the `Guest` entity section above.

**Guest portal access (no login):** `GET classes/guest/:enrollmentId` and `POST classes/guest/:enrollmentId/assignments/:assignmentId/submit`, both `@Public()` (bypass `JwtAuthGuard`; `ModuleEnabledGuard` still applies since it keys off the tenant, not caller auth) on a dedicated `ClassPublicController` — mirrors the Forms module's public-submission pattern exactly. The submit route is rate-limited (`5/min`). `submitAsGuest` verifies the enrollment actually has a `guest` attached and belongs to the *same* class as the assignment, so neither a member's enrollment id nor a guest's enrollment in a different class can be used to submit.

**Study materials — see the `ClassMaterial` entity section above** for the full model (multiple titled
documents/links per class, upload vs. pasted-link vs. reuse-existing-asset, and the reference-counted delete
behavior that keeps a shared "reused" upload safe). Upload accepts PDF, Word, PowerPoint, or image mimetypes; size
is capped by `PlatformSettingKey.MAX_CLASS_MATERIAL_UPLOAD_MB` (platform-admin-configurable, default 10 MB —
separate from the app-wide `MAX_FILE_UPLOAD_BYTES` default of 5 MB since course material tends to run larger than
proofs/images). Materials can only be added to a class that already exists — there's no material field on
`POST classes` itself.

**Assignments (`Assignment`/`AssignmentSubmission`, tables `assignments`/`assignment_submissions`):** each
`ChurchClass` can have any number of assignments. An assignment has `title`, optional `instructions`, `maxScore`
(default 100), optional `dueDate`, and `isPublished` (default `true` — an unpublished assignment is an admin-only
draft, invisible to students and not submittable). A student submits free-text `content` against a published
assignment; one submission per member per assignment (`UNIQUE(assignment_id, member_id)`) — resubmitting before
grading overwrites the existing row (`submittedAt` bumped), but once graded (`gradedAt` set) further resubmission
is rejected with `400`, so a grade can't be silently invalidated by a late edit. Grading (`PATCH
classes/assignments/submissions/:submissionId/grade`) sets `score` (validated `<= assignment.maxScore`, `400`
otherwise), optional `feedback`, and stamps `gradedBy` (the grading `Admin`, resolved via `@CurrentAdmin()` — not
the JWT's member id) + `gradedAt`. `gradedBy` is `SET NULL` on admin deletion, mirroring the `reviewedBy` pattern
used by tithe/finance proof review.

**Guest submissions:** `AssignmentSubmission.member` is nullable; a guest's submission is keyed by `classEnrollment` (ManyToOne → `ClassEnrollment`, `onDelete: CASCADE`) instead — DB-level CHECK constraint `(member_id IS NOT NULL) != (class_enrollment_id IS NOT NULL)` (exact XOR, unlike `ClassEnrollment`'s own OR constraint): a submission is made either as an authenticated member OR via a specific guest enrollment, never both, and converting a guest later doesn't rewrite past submissions. `UNIQUE(assignment_id, class_enrollment_id)` mirrors the member-side `UNIQUE(assignment_id, member_id)`. `submitAsGuest()` is the guest-portal equivalent of `submit()` — same overwrite-before-grading / reject-after-grading rules, reached only via `ClassPublicController` (see Guest portal access above).

**Progress summary:** both `GET classes/:classId/assignments/available` (member) and `GET classes/guest/:enrollmentId` (guest) return `{ assignments: [...], progress: { submitted, total } }` — the progress summary is derived from the same published-assignments-plus-submissions query already being run, not a separate round-trip. **Breaking change from the prior shape:** `available` used to return a bare `Assignment[]`; callers must now read `.assignments`.

| Method | Route | Auth | Notes |
|--------|-------|------|-------|
| POST   | `/classes/:classId/assignments`                          | AdminGuard (CLASSES_WRITE) | Create an assignment for a class |
| GET    | `/classes/:classId/assignments`                          | AdminGuard (CLASSES_READ)  | All assignments for a class, including unpublished drafts |
| GET    | `/classes/:classId/assignments/available`                | JwtAuthGuard               | `{ assignments, progress }` — published assignments only, each merged with the caller's own `mySubmission` (`null` if not yet submitted) |
| PATCH  | `/classes/assignments/:assignmentId`                     | AdminGuard (CLASSES_WRITE) | Partial update |
| DELETE | `/classes/assignments/:assignmentId`                     | AdminGuard (CLASSES_WRITE) | Cascades submissions |
| POST   | `/classes/assignments/:assignmentId/submit`              | JwtAuthGuard               | Create or (if ungraded) overwrite the caller's own submission |
| GET    | `/classes/assignments/:assignmentId/submissions`         | AdminGuard (CLASSES_READ)  | Paginated (`?page=&limit=`), for grading |
| PATCH  | `/classes/assignments/submissions/:submissionId/grade`   | AdminGuard (CLASSES_WRITE) | `{ score, feedback? }` |
| POST   | `/classes/:id/materials/upload`                          | AdminGuard (CLASSES_WRITE) | Multipart, field `file` (+ optional `title`) — uploads to Cloudinary and creates the `ClassMaterial` row |
| POST   | `/classes/:id/materials/link`                            | AdminGuard (CLASSES_WRITE) | `{ title, url }` — pasted external link, no Cloudinary asset |
| POST   | `/classes/:id/materials/reuse`                           | AdminGuard (CLASSES_WRITE) | Echoes a library entry's fields — new row, same underlying asset, no re-upload |
| DELETE | `/classes/:id/materials/:materialId`                     | AdminGuard (CLASSES_WRITE) | Reference-counted Cloudinary cleanup — see `ClassMaterial` above |
| GET    | `/classes/materials/library`                             | AdminGuard (CLASSES_READ)  | `{ title, url, publicId, resourceType, mimeType, sizeBytes, usedByClassNames }[]` — for the "Reuse Previous" picker |
| GET    | `/classes/lookup`                                        | AdminGuard (ANNOUNCEMENTS_WRITE) | `{id, name, startDate, endDate}[]` — feeds the Announcements CLASS-audience picker; gated on `ANNOUNCEMENTS_WRITE` (composing an announcement), not `CLASSES_READ`, mirroring `GET /groups/lookup` |
| PATCH  | `/classes/:id/session`                                   | AdminGuard (CLASSES_WRITE) | `{ nextSessionAt?, meetingLink? }` — either can be set to `null` to clear |
| POST   | `/classes/enroll/guest`                                  | AdminGuard (CLASSES_WRITE) | `EnrollGuestDto` — see Guest enrollment above |
| POST   | `/classes/enroll/guests/bulk`                            | AdminGuard (CLASSES_WRITE) | `BulkEnrollGuestsDto` → `{ enrolled, skipped }` |
| GET    | `/classes/guests`                                        | AdminGuard (CLASSES_READ)  | Paginated, `?search=` by name/email |
| GET    | `/classes/guests/:id`                                    | AdminGuard (CLASSES_READ)  | Guest profile + every enrollment across all classes |
| POST   | `/classes/guests/:guestId/convert-to-member`             | AdminGuard (CLASSES_WRITE) | See Guest-to-member conversion above |
| GET    | `/classes/guest/:enrollmentId`                           | `@Public()`                | Class info (incl. `nextSessionAt`/`meetingLink`) + guest name + assignments + progress |
| POST   | `/classes/guest/:enrollmentId/assignments/:assignmentId/submit` | `@Public()`, rate-limited (5/min) | `{ content }` |

Assignments reuse the existing `classes:read`/`classes:write` permissions rather than adding new ones — managing
assignments is the same admin surface as managing the classes they belong to.

**Routes prefix:** `/classes`, `/classes/types`

### Announcements Module

Audience-targeted broadcast messages. The `/announcements/feed` endpoint filters automatically based on the caller's
role and optional `departmentId`.

**Audience rules:**

- MEMBER → sees `ALL` + `MEMBERS_ONLY` + any `INDIVIDUAL` announcements addressed to them + any `GROUP` announcement for a group they belong to + any `CLASS` announcement for a class they're enrolled in (`IN_PROGRESS`/`COMPLETED`, as a member — guests have no login and so never see the feed)
- WORKER → sees `ALL` + `WORKERS_ONLY` + `DEPARTMENT` (for their department) + `INDIVIDUAL` (addressed to them) + any `GROUP` announcement for a group they belong to + any `CLASS` announcement for a class they're enrolled in
- ADMIN → sees all audiences
- Expired announcements (`expiresAt < now`) are excluded from the feed

**Audience types:** `ALL` | `WORKERS_ONLY` | `MEMBERS_ONLY` | `DEPARTMENT` | `INDIVIDUAL` | `GROUP` | `CLASS`  
When `audience = DEPARTMENT`, `departmentId` is required. When `audience = INDIVIDUAL`, `targetMemberId` (UUID) is
required. When `audience = GROUP`, `groupId` (UUID) is required. When `audience = CLASS`, `classId` (UUID) is
required. Since `ChurchClass` already has `startDate`/`endDate` — each row is one dated cohort — picking a specific
class already scopes the audience to a specific date range; there's no separate date-range picker. `CLASS` audience
targets `IN_PROGRESS` + `COMPLETED` enrollees only (excludes `CANCELLED`).

**Push notification on every audience:** `AnnouncementService.create()` always fire-and-forgets a single `PushNotificationService.dispatchToMemberIds()` call after saving, for every audience type — not just `GROUP`. `resolveMemberIdsForAudience()` computes the recipient member-id list per audience (`GROUP` → `GroupService.getMemberIdsForGroup`; `CLASS` → `ClassesService.getMemberIdsForClass` — member-linked enrollees only, guests have no member id to push to; `INDIVIDUAL` → the single `targetMember`; `ALL`/`MEMBERS_ONLY`/`WORKERS_ONLY`/`DEPARTMENT` → an `ACTIVE`-member query filtered by role/department, mirroring `resolvePhoneNumbers`'s SMS-targeting logic but without requiring a phone number on file). No push is sent when the resolved list is empty. Idempotency key = the announcement id, so a retry or duplicate call never double-sends. Failure to dispatch is logged as a warning and never fails the announcement creation itself — the announcement is still visible in-app via the feed regardless of push delivery outcome.

**Optional SMS delivery (`sendViaSms`/`smsBody`):** `CreateAnnouncementDto`/`UpdateAnnouncementDto` accept
`sendViaSms?: boolean` and `smsBody?: string`. Setting `sendViaSms: true` requires the caller's admin role to hold
the `SMS_SEND` permission (checked in `AnnouncementService`, not the DTO — a DTO can't inspect the caller's
permission set — throws `403 Forbidden` otherwise) and requires `smsBody` to be non-empty. `smsBody` is deliberately
separate from `body`: the announcement body is often long-form and meant for in-app reading, whereas SMS is billed
per segment, so admins compose a distinct, short message for it. On `create`, an SMS is sent (awaited, not
fire-and-forget, since it's a paid external call whose failure must be caught and logged synchronously) whenever
`sendViaSms` is set. On `update`, the SMS is sent only on the **transition** into `sendViaSms=true` — re-saving an
already-SMS'd announcement (e.g. editing its title afterward) does not re-text everyone.

**SMS phone number resolution (`resolvePhoneNumbers`)** — independent of the push-notification audience logic above.
Always restricted to `ACTIVE` members with a non-null `phoneNumber`, further filtered by audience:

- `ALL` — every eligible member
- `MEMBERS_ONLY` — role = MEMBER
- `WORKERS_ONLY` — role = WORKER
- `DEPARTMENT` — workers whose `workerProfile.department` matches `announcement.department`
- `INDIVIDUAL` — just `announcement.targetMember`
- `GROUP` — members resolved via `GroupService.getMemberIdsForGroup(announcement.group.id)`
- `CLASS` — union of member-linked enrollees' phones (`ClassesService.getMemberIdsForClass`, filtered `ACTIVE`+phone-on-file like every other audience) and guest enrollees' own phones (`ClassesService.getGuestPhonesForClass` — a guest has no `Member` row, so their own `Guest.phone`, if set, is the only channel besides email), deduped — the same dual-source shape `resolveGroupPhoneNumbers` already uses for member vs. phone-only `GroupMember` entries

`resolvePhoneNumbers` takes a plain `{ audience, departmentId?, targetMemberId?, groupId?, classId? }` target rather than an
`Announcement` entity, so it's reusable outside the announcement-creation flow — see `sendSmsBroadcast` below.

**SMS-only broadcast (`POST /announcements/sms-broadcast`), no announcement created:** For sending a text blast to an
audience without publishing anything to the in-app feed. Guarded solely by `SMS_SEND` (not `ANNOUNCEMENTS_WRITE` —
an admin with SMS access but no announcement-authoring access can use this). Body: `SendSmsBroadcastDto` —
`audience` (required) + the matching `departmentId`/`targetMemberId`/`groupId`/`classId` for `DEPARTMENT`/`INDIVIDUAL`/`GROUP`/`CLASS`
audiences + `message` (required). Reuses the same `resolvePhoneNumbers` targeting as `sendViaSms` on a regular
announcement. No `Announcement` row is created, no push notification is sent, and no title/body is required — this
is purely an SMS send. Returns `{ sentCount }`; `sentCount: 0` (not an error) when the resolved audience has no
members with a phone number on file. Logs `SMS_BROADCAST_SENT` to the audit log (`metadata: { audience, count }`).

**Emoji reactions:** any authenticated member/worker can react to an announcement with one of a fixed emoji set
(`ReactionEmojiEnum`: 👍 ❤️ 🙏 🎉 👏) via `POST announcements/:id/react` — reacting again just updates the existing
reaction (one per member per announcement, not multi-emoji). `DELETE announcements/:id/react` removes it.
`GET announcements/:id/reactions` returns `{ summary: { emoji, count }[], myReaction: string | null }` —
`myReaction` reflects the *calling* member's own reaction so the frontend can highlight it without a separate
lookup. No audit logging on reactions — too high-frequency/low-stakes to be worth an audit trail entry per click.

**System-triggered announcements (`createSystemAnnouncement`):** a small internal entry point used by features that
need to publish an `ALL`-audience announcement without going through the admin-authored `create()` flow — no
`Admin`/SMS-permission check, `author` is left `null` (the FK is nullable for exactly this reason), `publishedAt` is
now, and the same persist + push-notify path runs. Used today by the Sermon Archive's "Announce Live" trigger (see
Sermon Module); designed to also be the target of the planned YouTube WebSub livestream-detection integration.

**Routes prefix:** `/announcements`

**Picking a group when creating a `GROUP` announcement** does not require `groups:read`/`groups:write` — the admin
frontend's group picker (`GroupSearchInput`, a searchable combobox filtering the already-fetched list client-side
rather than a plain `<select>`) calls `GET /groups/lookup` via `useGroupLookup()` (see Groups Module), gated on
`announcements:write` only, since choosing a group here is a component of the announcement feature rather than a
separate group-management capability.

**Picking a class when creating a `CLASS` announcement** mirrors the group picker exactly, one permission layer down: `ClassSearchInput` calls `GET /classes/lookup` (see Classes Module — same `announcements:write`-only gating, same reasoning), showing each class's name plus its `startDate`/`endDate` so an admin can distinguish cohorts of the same class type.

### Groups Module

Reusable, admin-managed rosters of members and/or workers (e.g. "Call Leaders") used to target announcements at a
fixed group of people without re-selecting individuals each time. A group's membership is independent of
`Department` — a group can mix members and workers from any department.

**Entities:**

- `Group` (`groups` table) — `name` (unique), `description` (nullable), `createdBy` (nullable FK → `members`, `SET NULL`).
- `GroupMember` (`group_members` table) — join entity. A row is either a real Member (`member` FK set) **or** a
  phone-only entry (`phoneNumber` + optional `label` set, `member` null) — e.g. a manually-typed number, or one
  imported from a `FirstTimer` who has no `Member` account (first-timers can't join Groups any other way, since
  they aren't `Member` records). Enforced by a `CHECK` constraint (`member_id IS NOT NULL AND phone_number IS NULL`
  OR the reverse) added in migration `AddGroupMemberPhoneEntries`, plus service-layer logic that only ever sets one
  side. `@Unique(['group', 'member'])` and `@Unique(['group', 'phoneNumber'])` both apply — Postgres treats NULLs as
  distinct per unique index, so real-member rows (phoneNumber null) and phone-only rows (member null) don't collide
  with each other's constraint. `group`/`member` FKs `ON DELETE CASCADE` (removing a group or a member cleans up
  membership rows automatically), `addedBy` (nullable FK → `members`, `SET NULL`).

**Permissions:** `groups:read`, `groups:write` (grouped under "Announcements" in `AdminPermissionGroups`, since a group's only current purpose is targeting announcements).

**Routes prefix:** `/groups`

| Method | Path | Description |
|---|---|---|
| GET | `/groups` | List all groups with `memberCount` (no pagination — reference data, mirrors the Departments policy). `memberCount` counts all `group_members` rows regardless of kind, so phone-only entries count too. |
| GET | `/groups/lookup` | Minimal `{id, name}[]` list, gated on `announcements:write` instead of `groups:read` — lets any admin who can create a `GROUP` announcement populate the group picker without also needing group-management access. Registered before `:id` so it isn't swallowed as a param. |
| GET | `/groups/:id` | Get one group with `memberCount` |
| POST | `/groups` | Create a group (`name`, optional `description`) |
| PATCH | `/groups/:id` | Rename / update description |
| DELETE | `/groups/:id` | Delete a group (cascades to its `group_members` rows) |
| GET | `/groups/:id/members` | Paginated roster (`page`, `limit`; can grow large, mirrors the Workers-by-Department policy) — `leftJoin`s the member relation so phone-only rows are included, not just real members |
| POST | `/groups/:id/members` | Add a single real member (`memberId`) |
| POST | `/groups/:id/members/bulk-add` | Add multiple real members at once (`memberIds: string[]`); returns `{added, skipped}` — duplicates are skipped, not errored |
| POST | `/groups/:id/members/phone` | Add phone-only entries directly. Body: `{ entries: { phoneNumber, label? }[] }`; returns `{added, skipped}` — duplicate phone numbers within the group are skipped |
| POST | `/groups/:id/members/first-timers` | Bulk-import every `FirstTimer` captured within a date range as phone-only entries (label = their name). Body: `{ dateFrom, dateTo }` (ISO 8601); returns `{added, skipped}` |
| DELETE | `/groups/:id/members/:memberId` | Remove a single real member by member id (kept for backward compatibility — cannot address phone-only rows, which have no member id) |
| POST | `/groups/:id/members/bulk-remove` | Remove multiple real members at once by member id (`memberIds: string[]`); returns `{removed}` |
| DELETE | `/groups/:id/entries/:entryId` | Remove a single roster entry by its own `GroupMember` row id — works for both real members and phone-only entries |
| POST | `/groups/:id/entries/bulk-remove` | Remove multiple roster entries at once by row id (`entryIds: string[]`); returns `{removed}` |

**Resolving a group's phone numbers for SMS** (`AnnouncementService.resolveGroupPhoneNumbers`, used by both regular
announcement `sendViaSms` and the dedicated SMS-only broadcast): unions two sources — active Members in the group
with a phone number on file (via `GroupService.getMemberIdsForGroup`, then a direct Member query for the
active/phone-on-file filter) and raw phone-only entries (`GroupService.getPhoneOnlyNumbersForGroup`) — deduped
via `Set`. Phone-only entries have no "active" concept; they're included as-is.

**Indexes** (migration `AddGroupsModule`): `group_members(group_id)` and `group_members(member_id)` back the roster listing and the group-audience membership check used by the announcement feed's `EXISTS` subquery; `announcements(group_id)` backs the same feed query.

### SMS Module

Provider-agnostic SMS sending — pure BYOK, no platform-default account and no prepaid credit balance. A tenant must
configure and activate their own SMS provider (Communication Providers below) before they can send at all; there is
no fallback. This is deliberate: a platform-run wallet billed in Naira only ever made sense for Nigerian tenants —
BYOK lets a tenant in any country pick whichever SMS vendor actually serves them and pay that vendor directly.

**Provider abstraction (`src/sms/interface/sms-provider.interface.ts`):**

```ts
type SmsProviderCredentials = Record<string, string>; // e.g. Termii's { apiKey, senderId }, Twilio's { accountSid, authToken, fromNumber }

interface ISmsProvider {
  readonly maxRecipientsPerRequest: number; // Termii: 100 (true bulk endpoint); Twilio: 20 (concurrency cap, no bulk endpoint)
  send(to: string[], message: string, encoding: 'plain' | 'unicode', credentials: SmsProviderCredentials): Promise<{ messageId: string; status: string }>;
  getBalance(credentials: SmsProviderCredentials): Promise<{ balance: number; currency: string }>;
  getMessageHistory(credentials: SmsProviderCredentials): Promise<SmsLogEntry[]>;
}
```

`SmsProviderRegistryService` (`src/sms/service/sms-provider-registry.service.ts`, same shape as billing's
`PaymentProviderRegistryService`) holds every registered vendor simultaneously — `termii` → `TermiiSmsProvider`,
`twilio` → `TwilioSmsProvider` — and `SmsService` resolves which one to use per call from the tenant's active
`TenantCommunicationProviderConfig.providerId`, never a hardcoded class. Adding a vendor is a new `ISmsProvider`
class, a line in the registry, and a `communication_providers` catalog row — no other call site changes.

**`SmsService`:**

- `calculateSegments(message)` — determines encoding and segment count for billing purposes. A message is encoded
  `plain` (GSM-7, 160 chars/segment) unless it contains a non-ASCII character **or** one of the characters Termii
  documents as forcing UCS-2/unicode encoding even though they're otherwise ordinary ASCII punctuation:
  `; ^ { } \ [ ~ ] | € ' "` — in which case it's encoded `unicode` (70 chars/segment). Returns
  `{ segments, encoding, characterCount }`.
- `send(to, message)` — resolves the caller's active SMS config once
  (`SmsCredentialResolverService.resolveConfig()`); if the tenant has none configured, throws
  `403 SMS_PROVIDER_NOT_CONFIGURED` immediately, before attempting anything. Otherwise looks up the matching
  `ISmsProvider` from the registry and batches `to` into groups of that provider's own
  `maxRecipientsPerRequest`. A failed batch is logged and skipped; it does not abort the remaining batches.
- `getLogs()`/`getBalance()` — same resolve-or-403 pattern, then pure passthrough to the resolved provider (a
  tenant sees their own vendor's balance/history, never the platform's — there isn't one). `getLogs()` tags every
  returned entry with `provider: config.providerId` (`termii` \| `twilio`) — individual `ISmsProvider` classes don't
  set this themselves, since a provider class has no reason to know its own registry key.

**Message history (`TermiiSmsProvider.getMessageHistory`):** calls Termii's `GET /api/sms/inbox?api_key=...`
(undocumented pagination or date-filter params — it's a flat array of every message on the account) and maps its
raw field names (`receiver`, `message`, `status`, `sms_type`, `message_id`, `created_at`, `sender?`) to the
provider-agnostic `SmsLogEntry` shape (`recipient`, `message`, `status`, `type`, `messageId`, `sentAt`, `sender?`,
`provider?` — the last set by `SmsService.getLogs()`, not by the provider class itself).
A non-array response body is treated as empty rather than thrown. `TwilioSmsProvider` has no native bulk-send
endpoint, so it issues one `POST` per recipient (`Promise.all`, capped by `maxRecipientsPerRequest`) and joins the
returned `sid`s with a comma for `messageId`.

**Routes prefix:** `/admin/sms` (`AdminGuard`)

| Method | Path                       | Permission | Description                                                            |
|--------|----------------------------|------------|--------------------------------------------------------------------------|
| GET    | `/admin/sms/balance`       | SMS_READ   | Returns `{ balance, currency }` from the tenant's active provider — `403 SMS_PROVIDER_NOT_CONFIGURED` if none is active |
| POST   | `/admin/sms/segment-count` | SMS_READ   | Body `{ message }` — returns `{ segments, encoding, characterCount }` without sending anything |
| GET    | `/admin/sms/logs`          | SMS_READ   | Live passthrough to the provider's message history — `SmsLogEntry[]` (each entry tagged with `provider`), not paginated or filtered server-side; the frontend paginates/filters the returned array client-side |

**Env vars:** `TERMII_BASE_URL` (default `https://api.ng.termii.com`) — Termii's API host is infrastructure, not a
secret, so it stays env-driven even under pure BYOK; every tenant's Termii account (BYOK) talks to the same host.
No platform-default credentials exist for any SMS vendor. See Environment Variables.

### Communication Providers (Tenant Self-Service BYOK)

Tenant-facing counterpart to Platform Admin's read-only/catalog-only communication-provider surface — this is what
lets a church admin actually set their own SMS/email provider credentials (`docs/MULTI_TENANT_MIGRATION.md`
§Phase 6c's deferred write side, now built). `src/communication-provider/`.

**Encryption (`EncryptionService`, `src/utility/service/encryption.service.ts`):** AES-256-GCM, keyed by
`CREDENTIALS_ENCRYPTION_KEY` (hashed via SHA-256 to a real 32-byte key — same `min(32)`-chars convention as
`JWT_SECRET`, no fixed hex/base64 format required on the operator). Each encrypted value is a self-contained
`iv:authTag:ciphertext` string (all base64) — nothing else needs to be stored alongside it to decrypt later.
`encryptFields`/`decryptFields` apply this to every value in a flat credentials object, keeping field names
(`apiKey`, `senderId`, etc.) intact and legible in the stored JSONB while no individual value is ever plaintext.
**Rotating this key makes every previously-encrypted credential unreadable — there is no re-encryption tooling.**

**Credential resolution (`SmsCredentialResolverService`):** pure BYOK, no wallet. `resolveConfig()` looks up the
current tenant's active `TenantCommunicationProviderConfig` for the `sms` channel (cached 300s per
`(tenantId, channel)`, invalidated immediately on write), decrypts it, and returns `{ providerId, credentials }` —
or `undefined` if the tenant has no active SMS provider configured, which `SmsService` treats as "can't send"
(`403 SMS_PROVIDER_NOT_CONFIGURED`), never as "use a default."

**Email credential resolution (`EmailCredentialResolverService`):** same shape as the SMS resolver, `email` channel
— `resolveConfig()` returns `{ providerId, credentials, senderIdentity }` (or `undefined` for "use platform
default"), cached under the same `communication-provider-config:{tenantId}:{channel}` key pattern (so
`TenantCommunicationProviderService`'s existing invalidation already covers this without any changes). No wallet —
email at church-scale volumes is a rounding error on any provider's free tier, so there's no cost to meter
(`docs/MULTI_TENANT_MIGRATION.md` §4.12). `providerId` matters here in a way it doesn't for SMS: each provider has an
incompatible credential shape (`{user, password[, host, port, secure]}` for `gmail`/`smtp`, `{apiKey}` for
`resend`/`sendgrid`, `{apiKey, domain}` for `mailgun`), so `EmailProcessor` has to know *which* concrete
`IEmailProvider` to hand the decrypted credentials to, not just that BYOK credentials exist. `senderIdentity` doubles
as the email "from" address for a BYOK tenant (falls back to the platform's `EMAIL_FROM`/`EMAIL_USER` when unset).

**Email providers (`src/utility/email-provider/`):** five implemented `IEmailProvider` classes; only `gmail`,
`resend`, and `sendgrid` are seeded into the `communication_providers` catalog (`smtp`/`mailgun` exist in code but
aren't tenant-selectable yet — add a catalog row to turn one on) —

| `providerId` | Class              | Credential shape                          | Platform default env vars                                    |
|--------------|---------------------|--------------------------------------------|----------------------------------------------------------------|
| `gmail`      | `GmailProvider`     | `{user, password[, host, port, secure]}`  | `EMAIL_HOST`/`EMAIL_PORT`/`EMAIL_SECURE`/`EMAIL_SERVICE`/`EMAIL_USER`/`EMAIL_PASSWORD` |
| `smtp`       | `SmtpProvider`      | `{host, port?, secure?, user, password}`  | none — BYOK-only, throws if called without credentials         |
| `resend`     | `ResendProvider`    | `{apiKey}`                                | `RESEND_API_KEY`                                                |
| `sendgrid`   | `SendGridProvider`  | `{apiKey}`                                | `SENDGRID_API_KEY`/`SENDGRID_BASE_URL`                          |
| `mailgun`    | `MailgunProvider`   | `{apiKey, domain}`                        | `MAILGUN_API_KEY`/`MAILGUN_DOMAIN`/`MAILGUN_BASE_URL`           |

`sendgrid` is Twilio's actual email product (SendGrid) — catalog name `SendGrid (Twilio)` — registered alongside
`twilio` (SMS) so a tenant who wants Twilio across both channels can, using each product's own real credential shape
(they're genuinely separately-credentialed even though one company owns both, so this is two catalog rows, not one
shared "Twilio" entry).

`gmail`'s BYOK credentials accept an optional `host`/`port`/`secure` override on top of `user`/`password` — this is
what actually lets a tenant route mail through a different domain (Outlook/Office365, Zoho, their own company mail
server) rather than being locked to the platform's own SMTP settings; omitting them reuses the platform's own
host/port/secure/service with just a different mailbox. `smtp` is for a tenant who wants to fully bring their own
server with no platform fallback at all. `sendgrid`/`mailgun` call their REST APIs directly via native `fetch` (no
SDK dependency) — SendGrid with Bearer auth, Mailgun with HTTP Basic auth and a `FormData` body; both throw a clean
`500` if neither BYOK nor platform-default credentials are configured, rather than silently no-op-ing.

**Routes prefix:** `/communication-providers` (`AdminGuard`, tenant-scoped — deliberately not under `/platform`,
which is entirely excluded from `TenantMiddleware`)

| Method | Path                                | Permission                    | Description |
|--------|-------------------------------------|--------------------------------|--------------|
| GET    | `/communication-providers`          | COMMUNICATION_PROVIDERS_READ  | `?channel=sms\|email` (optional) — returns `{ catalog, ownConfigs }`; `ownConfigs` never includes credentials |
| PUT    | `/communication-providers/:channel` | COMMUNICATION_PROVIDERS_WRITE | Body `{ providerId, senderIdentity?, credentials: Record<string,string> }` — upserts this tenant's config for that channel (always activating it), encrypting `credentials` before storage |
| PATCH  | `/communication-providers/:channel/:providerId` | COMMUNICATION_PROVIDERS_WRITE | Body `{ isActive }` — enable/disable an already-configured provider without touching its stored credentials |

**Only one active provider per channel:** both `PUT` and `PATCH` (when activating) run inside a transaction that also
deactivates every other provider already active on that same channel for the tenant
(`TenantCommunicationProviderService.deactivateSiblings`) — `SmsCredentialResolverService`/`EmailCredentialResolverService`
each pick a single `isActive = true` row per channel, so allowing more than one active at a time would make that
pick arbitrary. Turning a provider *off* never touches its siblings.

**Communication Providers: deactivation has real consequences (added 2026-08).** A platform admin can activate/
deactivate a provider in the platform-wide catalog (`PATCH /platform/communication-providers/:id`,
`PlatformCommunicationProviderService.setActive` — see Platform Admin above). Initially this only flipped the
`CommunicationProvider.isActive` column with zero downstream effect anywhere — verified live at the time: neither
credential resolver checked it, the tenant-facing catalog endpoint didn't filter on it, and a tenant already
configured against a since-deactivated provider kept sending through it exactly as before. Three changes closed
that gap:

1. **`TenantCommunicationProviderService.listProviders()`** excludes an inactive provider from the catalog a
   tenant can newly select — *unless* that tenant already has a config against it, in which case it stays visible
   (filtering it out entirely would make an already-configured provider's row silently vanish from
   `discuva-admin`'s page with no explanation, even though its encrypted credentials are still saved).
2. **`SmsCredentialResolverService`/`EmailCredentialResolverService`** now also require `provider.isActive = true`
   in the same query that already checks `config.isActive = true` and `provider.channel`. A deactivated provider
   genuinely stops resolving for every tenant using it, not just new ones.
3. **`PlatformCommunicationProviderService.setActive()`** invalidates the 300s resolved-credential cache
   immediately for every tenant with an active config against the provider (`communicationProviderCacheKey` —
   extracted as a shared utility, `src/communication-provider/utility/communication-provider-cache-key.ts`, since
   four separate places needed the identical cache-key string and three of them were computing it independently
   before this), rather than leaving affected tenants to keep working for up to 5 more minutes. It also emails
   those same tenants' admins — `TenantBroadcastService.notifyTenants()` (see "Tenant Broadcasts" under Platform
   Admin above), deliberately targeted at only the tenants actually using this provider, not a platform-wide
   broadcast — explaining the channel is disrupted (deactivating) or restored (reactivating). A tenant's own
   `TenantCommunicationProviderConfig` row is never touched by any of this — same "don't retroactively delete
   something already configured" posture `suspendTenant` uses for a tenant's own data.

**Env vars:** `CREDENTIALS_ENCRYPTION_KEY` (required, `min(32)` chars) — see Environment Variables.

**Email BYOK send path (`EmailProcessor.handleSend`, `src/utility/processor/email.processor.ts`):** unlike SMS,
which resolves credentials synchronously within the original request, an email send runs inside a Bull job — tenant
context isn't ambient there, so `handleSend` wraps its entire body in `runInTenantContext()` (previously only
`onCompleted`/`onFailed` did this, purely to log) before calling `EmailCredentialResolverService.resolveConfig()`.
Resolves to the concrete `IEmailProvider` matching the tenant's `providerId` if BYOK-configured (falling back to
`GmailProvider` for `gmail` or any unrecognized id), otherwise the platform's constructor-injected
`EMAIL_PROVIDER_TOKEN` default — `source` is `'tenant'` in the former case, `'platform_default'` in the latter.
Which provider/source actually handled a given send is carried back via Bull's job-return-value convention
(`job.returnvalue`) so `onCompleted` logs the real provider/source to `EmailLog.provider`/`EmailLog.source`, not
just the platform default — that can differ per send once BYOK is in play. Since `handleSend` also persists the same
resolved provider/source onto `job.data` via `job.update()` *before* attempting the send, `onFailed` (which has no
return value to read, since a thrown send means `handleSend` never reaches its `return`) can log the actual
provider/source that failed instead of guessing the platform default.

**Announcement integration:** see "Optional SMS delivery" under Announcements Module — sending SMS on an
announcement requires the `SMS_SEND` permission (distinct from `SMS_READ`, which only allows checking balance/cost).

### Tenant Profile Self-Service (`src/tenant/`)

`GET /tenant/info` (`@Public()`, still goes through `TenantMiddleware`) returns branding for the current subdomain —
unchanged. `PATCH /tenant/info` (`AdminGuard`, new `CHURCH_PROFILE_WRITE` permission) is the tenant self-service
write side (`docs/MULTI_TENANT_MIGRATION.md` §Phase 6c's deferred item, now built) — lets a church admin edit their
own `name`/`logoUrl`/`tagline`/`address`/`supportEmail`/`pwaShortName`/`currency`/`timezone` without going through
platform support, which was previously the only way to change any of it (`PATCH /platform/tenants/:id`,
platform-admin-only). Body (`UpdateTenantProfileDto`) is a partial — every field optional, only provided fields are
applied (`Object.assign`). Deliberately excludes `subdomain`, `schemaName`, `clusterId`, and `isActive` —
platform-controlled, not something a church admin can change about their own tenant.

**`pwaShortName`** (nullable, max 20 chars): the label a member sees under the home-screen icon after installing the
PWA (Android's manifest `short_name`, iOS's `apple-mobile-web-app-title`) — deliberately separate from `name`, which
is often too long (formal church names) to survive the ~10-13 characters that render before truncation on a real
home screen. Falls back to `name` itself when unset (still a real improvement over the platform's own generic name,
which was the bug this field was added to fix) — see discuva-member's `app/manifest.ts` and
`context/tenant-context.tsx` for where the fallback chain (`pwaShortName ?? name`) is actually consumed.
`platform-admin/dto/update-tenant.dto.ts` and `PlatformTenantService`'s `TenantWithHealth`/`toHealthShape` mirror this
field for parity, though no discuva-platform UI currently exposes editing it — self-service via discuva-admin's
Church Profile page is the only intended write path today.

**Logo upload (`POST /tenant/logo`, `DELETE /tenant/logo`, both `CHURCH_PROFILE_WRITE`):** `logoUrl` on
`PATCH /tenant/info` only ever accepted an already-hosted URL — these two routes are the actual upload path, same
shape as `MemberController`'s `POST members/me/photo` (`DynamicLimitedFileInterceptor`, image-mimetype-only filter,
`CloudinaryService.uploadBuffer` into the `church-logos` folder) but its own limit —
`PlatformSettingKey.MAX_LOGO_UPLOAD_MB` (5MB default, platform-admin-configurable), not `MAX_AVATAR_UPLOAD_MB` —
since a logo is reused across more surfaces than a profile photo and needs more headroom. `Tenant.logoPublicId`
(new column) tracks
the Cloudinary asset id so a replace or removal can delete the previous asset — deletion always happens *after* the
new row is saved, so a failed re-upload never leaves a tenant with no logo. All three routes (`PATCH /tenant/info`,
`POST /tenant/logo`, `DELETE /tenant/logo`) return the same profile shape.

**Mobile app appearance (`tenant_asset_overrides`):** the member PWA (`discuva-member`) ships a bundled
default hero/backdrop image for every screen — `KNOWN_ASSETS`
(`src/tenant/constants/known-assets.constant.ts`) is the fixed catalog of what can be overridden (25 keys today,
e.g. `login-backdrop`, `home-door-welcome`, `giving-backdrop`, `finance-backdrop`), each mapped to the screen(s) it actually renders on
in the mobile app. A church can override any of these with its own image; anything left unset silently falls back
to the app's own bundled default — that fallback resolution happens **client-side** in discuva-member, not
here. This backend only ever knows what's been explicitly overridden.

- `GET /tenant/info`'s response gained an `assets: Record<assetKey, imageUrl>` field — only overridden keys appear
  in it, never the full catalog and never a default. Bundled into the same call the member app already makes on
  startup rather than a second round trip.
- `GET /tenant/assets/catalog` (`AdminGuard`, `CHURCH_PROFILE_WRITE`) — the fixed `KNOWN_ASSETS` list with
  labels/descriptions, for the admin appearance-settings page to render without duplicating the catalog
  client-side.
- `POST /tenant/assets/:key` (`AdminGuard`, `CHURCH_PROFILE_WRITE`) — upload/replace the override for one asset key.
  Same upload shape as logo upload (multer, `PlatformSettingKey.MAX_LOGO_UPLOAD_MB` limit — 5MB default, image-mimetype-only, `CloudinaryService.uploadBuffer`, into
  the `tenant-assets` Cloudinary folder this time). `:key` is validated against `KNOWN_ASSETS` in
  `TenantAssetService`, not at the DB level, so the catalog can grow without a migration. Same "new asset saved
  before the old one is deleted" ordering as logo upload.
- `DELETE /tenant/assets/:key` (`AdminGuard`, `CHURCH_PROFILE_WRITE`) — removes the override row and the Cloudinary
  asset, reverting that screen to the app's bundled default. A no-op (still `200`, still deletes nothing) if no
  override existed for that key.

`TenantAssetOverride` lives in `public` (`tenant_asset_overrides`, FK to `tenants.id` `ON DELETE CASCADE`), not a
per-tenant schema — this is the same category of data as `Tenant.logoUrl` (self-service branding a church sets
once and rarely touches), not operational data needing schema isolation. One row per `(tenant, assetKey)`,
enforced with a unique constraint.

The admin-side crop tool (discuva-admin's Appearance settings page) guides toward each asset's actual render
ratio before upload, but nothing here enforces it server-side — every one of these images renders with
`object-cover` inside a fixed-size container in the member app, so a mismatched upload crops awkwardly rather than
breaking layout.

### Billing & Checkout (`src/billing/`)

Tenant self-service surface for the plan/subscription infrastructure described in
`docs/MULTI_TENANT_MIGRATION.md` §4.11/§9 Phase 3 — view current plan/subscription status and initiate a Paystack or
Flutterwave checkout to upgrade the plan. `PlanGuard` itself doesn't depend on any of this working — a tenant can
always be moved onto Pro manually via the platform-admin escape hatch (`PATCH /platform/tenants/:id/plan`); this
module is what lets a tenant do it themselves, and pay for it. (SMS billing lives entirely outside this module now —
see SMS Module above for why.)

**Three payment providers, registered simultaneously** (`PaymentProviderRegistryService`) — unlike email, where one
platform-default concrete class is chosen once at boot (SMS has no platform default at all, pure BYOK — see SMS
Module above), `PaystackPaymentProvider`, `FlutterwavePaymentProvider`, and `KoraPaymentProvider` are always
available; a checkout call picks one by name (`?provider=paystack`/`flutterwave`/`kora` in the request body),
defaulting to `DEFAULT_PAYMENT_PROVIDER` when unspecified. All three are platform-wide credentials, not tenant
BYOK — unlike SMS/email/YouTube, these charges pay the *platform* (plan upgrades), so the merchant keys have to be
the platform's own, never a tenant's. This is the platform-billing counterpart to the tenant-facing, fully-BYOK
giving/tithe system (`src/giving-checkout/`, which also supports Kora — `KoraGivingProvider` — plus Stripe); the two
systems share no config or code, only the same proven Korapay request/webhook-signing shape.

**`Plan.currency` is validated against `SUPPORTED_BILLING_CURRENCIES` (`src/billing/constant/supported-currencies.constant.ts`), currently `['NGN', 'USD']` only.** Nothing in `PaymentProviderRegistryService` or any of the three provider implementations checks that Discuva's own merchant account for the chosen provider can actually settle in a plan's currency — a plan created with an unsupported currency would only fail at charge time, at the provider, not at plan-creation time. `CreatePlanDto`/`UpdatePlanDto` enforce this whitelist so a currency can't be picked (via `discuva-platform`'s Plan form or a direct API call) without first confirming it with each active provider's Discuva-owned account and widening the constant.

**Multi-currency, multi-interval tiers (`Plan.tierKey`, `Plan.billingInterval`):** each `Plan` row is still exactly one immutable priced offering in one currency and one billing interval — `id` remains the real billing identity (`Subscription.planId`, `Plan.billingProviderPriceId` all key off it, untouched by anything below). `tierKey` is a separate, purely-display grouping key that lets multiple rows represent the same conceptual tier across currency and/or interval — e.g. `pro` (NGN, monthly), `pro-usd` (USD, monthly), `pro-annual` (NGN, annual) and `pro-usd-annual` (USD, annual) all share `tierKey: 'pro'`, four independent rows, each a real, deliberately-priced offering (never a currency conversion or a computed 12x-minus-discount of another). `PlanGuard`/`PlanFeatureResolverService`/checkout are entirely unaffected — they resolve via `Subscription.planId → Plan`, never `tierKey`. `tierKey` and `billingInterval` (`'monthly' | 'annual'`, `BillingInterval` enum) are both required on `POST /platform/plans` and optional on `PATCH /platform/plans/:id`. **Safeguard:** `PlatformPlanService.updatePlan()` rejects (`400`) a `currency` or `billingInterval` change once `Plan.billingProviderPriceId` is already set, since the cached provider-side price/interval object would silently keep charging at the old currency/cadence — create a new plan variant row instead of editing an existing plan's currency or interval.

**Interval-aware period extension:** `CheckoutService.applyChargeSucceeded()` looks up the charged `Plan`'s `billingInterval` and extends `Subscription.currentPeriodEnd` by `SUBSCRIPTION_PERIOD_DAYS` (monthly, default 30) or `ANNUAL_SUBSCRIPTION_PERIOD_DAYS` (annual, default 365) accordingly — both a fresh checkout and (for Paystack, see below) a provider's own renewal `charge.succeeded` go through this same path, so an annual charge genuinely grants ~365 days, not 30. Only Paystack's lazily-created provider-side Plan object is told this interval at all (`interval: 'annually'` for an annual `Plan`, Paystack's own documented value, mapped from our `BillingInterval.ANNUAL`) — see the Flutterwave/Kora capability-gap note below for why Flutterwave never receives one. `PlatformAnalyticsService.mrrByCurrency()` normalizes an annual subscriber's price to a monthly-equivalent (÷12) before summing, so "MRR" stays actually monthly rather than overstating annual subscribers ~12x.

**Currency unit mismatch between the providers, handled internally:** Paystack's Initialize Transaction takes
`amount` in the currency's smallest unit (kobo for NGN) — matches this codebase's existing `priceCents`/`amountCents`
convention, no conversion needed. Flutterwave's Standard Payment and Korapay's Initialize Charge both take the
*major* unit (naira) — every amount is divided by 100 before being sent and multiplied back where relevant. Only
Paystack lazily creates (and persists onto `Plan.billingProviderPriceId`) a matching provider-side plan object the
first time a `planId` is checked out against — Flutterwave and Kora never do, see below.

**Neither Kora nor Flutterwave has a working recurring-subscription mechanism — a real capability gap, documented
rather than papered over.** Korapay has no confirmed subscription/plan product at all; `KoraPaymentProvider` never
claimed one. Flutterwave *does* have a documented `payment-plans` + `payment_plan` API and this codebase originally
used it the same way Paystack uses its `plan` object — but a real Paystack-style sandbox test exposed that it
doesn't reliably work: a successful Flutterwave subscription checkout came back with `paymentPlan: null` on its
`charge.completed` webhook. The channel the customer paid with was USSD (`"event.type": "USSD_TRANSACTION"` in that
payload) — only a card payment is actually re-chargeable later, and Flutterwave's hosted checkout offers whichever
channels are enabled on the account with no way from this codebase to restrict a subscription checkout to card
only. Rather than depend on the customer happening to pick a channel that supports it, `FlutterwavePaymentProvider`
was changed to match `KoraPaymentProvider` exactly: `createSubscriptionCheckout` is a single charge for the plan's
price (no `payment_plan` attached), not an auto-renewing subscription, and `Plan.billingProviderPriceId` is never
set by either provider. Concretely: a tenant on Paystack may be silently re-charged by Paystack's own recurring
engine when their period ends (see `SubscriptionLapseScheduler` below); a tenant on Flutterwave or Kora never will
be — they always fall through to the normal failed-renewal flow (`PAST_DUE` email → grace period → downgrade) and
must complete a fresh checkout to renew. Both `FlutterwavePaymentProvider.cancelSubscription` and
`KoraPaymentProvider.cancelSubscription` are correspondingly documented no-ops (nothing server-side to cancel).
Kora's `refund()` throws rather than calling an unverified endpoint — Korapay's real refund API shape hasn't been
confirmed against sandbox behavior the way `/charges/initialize` and its webhook signing have (proven first in
`KoraGivingProvider`); Flutterwave's refund endpoint (unrelated to the payment-plan gap above) has been verified.
Don't set `DEFAULT_PAYMENT_PROVIDER` to `kora` or `flutterwave` without accounting for the lack of real
auto-renewal.

**`BillingCheckoutSession`** (`public.billing_checkout_sessions`) is recorded at checkout-*initiation* time, primary-
keyed by the provider's own reference (Paystack `reference` / Flutterwave `tx_ref`) — this is the only thing a
webhook payload is ever trusted for identity/amount against. `CheckoutService.handleWebhookEvent()` looks up this
row by the reference the webhook echoes back; a reference with no matching `pending` row (unknown, already
processed, or forged) is a safe no-op, never an error that could imply something was charged. One intent today:
`subscription` (activates a period on `Subscription` — see `SUBSCRIPTION_PERIOD_DAYS`/`ANNUAL_SUBSCRIPTION_PERIOD_DAYS` — not true
provider-driven recurring-billing reconciliation, deferred pending live sandbox testing). A `wallet_topup` intent
existed pre-BYOK (funded a prepaid `SmsWallet` debited per SMS sent) — removed along with the wallet itself once SMS
went pure BYOK (§ SMS Module); `BillingCheckoutType` only has `SUBSCRIPTION` now.

**Self-serve cancel/downgrade (`CheckoutService.cancelSubscription`):** the tenant-facing counterpart to the
platform-admin escape hatch. Still within a paid period (`currentPeriodEnd` in the future): sets
`Subscription.cancelAtPeriodEnd = true` and the tenant keeps their plan's features until that date —
`SubscriptionLapseScheduler` (below) completes the downgrade once it passes, rather than yanking access from a
period they already paid for. No active period left: downgrades immediately. Best-effort calls the provider's own
`cancelSubscription()` first (via `billingProviderSubscriptionId`), but a provider API failure never blocks the
local downgrade — the tenant's stated intent to stop wins regardless. Throws `400` if the tenant has no paid
subscription, or if the plan is sponsored by a parent tenant (see Branch Hierarchy below — a sponsored plan isn't
the branch's own to cancel).

**Failed-renewal safety net (`SubscriptionLapseScheduler`, daily 04:00, distributed-lock guarded):** finds every
`ACTIVE` subscription whose `currentPeriodEnd` has passed with no new `charge.succeeded` webhook extending it.
Backed by a composite `(status, current_period_end)` index (`idx_subscriptions_status_current_period_end`,
`AddSubscriptionStatusPeriodEndIndex` migration) — the query is `WHERE status = 'active' AND current_period_end <
now()`, and since `ACTIVE` is presumably the majority status platform-wide, a single-column status index (the old
`idx_subscriptions_status`, dropped in the same migration as redundant — the composite's leftmost prefix already
covers a status-only filter) barely narrowed the scan on its own.
`cancelAtPeriodEnd = true` (a voluntary cancellation reaching its natural end) downgrades immediately, no drama. Any
other lapse is treated as a failed renewal: flips `status` to `PAST_DUE` (the "queryable payment-status field" the
frontend can key a banner off — `SubscriptionStatus.PAST_DUE` existed as an enum value long before anything actually
set it), emails the tenant's oldest active admin, and gives a `GRACE_PERIOD_DAYS` (7) window before finally
downgrading to Free. **Known limitation, documented rather than silently accepted:** `Subscription.billingProviderSubscriptionId`
capture is wired up for Paystack (`subscription.create`, verified against a real sandbox payload, see below) — a
Paystack tenant whose subscription is canceled from Paystack's own hosted portal is now recognized as canceled
immediately rather than only once they lapse here. This doesn't apply to Flutterwave or Kora at all, but not
because anything is unwired — neither provider ever creates a real server-side subscription in the first place
(see the capability-gap note above), so there's no provider-side cancellation event to miss; a Flutterwave/Kora
tenant's renewal is always self-serve, and this scheduler's PAST_DUE → grace period → downgrade flow is the
*expected* path for them, not a gap. "Retrying" a failing card
is the provider's own responsibility (both Paystack and Flutterwave retry several times before giving up, well
within the 7-day window) — this scheduler only reflects local state, it never re-attempts a charge itself.

**Branch plan sponsorship (`Subscription.sponsoredByTenantId`):** set when a branch's plan was comped by its parent
at invite time rather than paid independently — see Branch Hierarchy below. Deliberately excluded from
`PlatformAnalyticsService`'s MRR calculation (no real money backs it) and blocks the branch's own admin from
self-cancelling it (that's the parent's call, via the invite/hierarchy relationship, not a `POST /billing/cancel`
on a plan they don't actually pay for).

**Refunds (platform-admin only, not tenant-facing):** `IPaymentProvider.refund(providerReference, amountCents?)` —
Paystack refunds by transaction reference directly; Flutterwave requires resolving the reference to its own numeric
transaction id first (`GET /transactions?tx_ref=`), handled internally. Kora's `refund()` throws unconditionally —
not implemented against a verified endpoint (see above) — so `refundCheckoutSession()` on a Kora-paid session fails
loudly rather than silently no-op'ing; refund a Kora charge directly in the Korapay dashboard instead until this is
built. `CheckoutService.refundCheckoutSession()`
only allows refunding a `completed` session, marks it `BillingCheckoutStatus.REFUNDED`, and **deliberately does
not** automatically downgrade a plan — that requires a product decision (does downgrading strand data created on the
paid tier?) this pass doesn't take on. A platform admin issuing a refund is expected to also apply the tenant-facing
consequence manually via the existing escape hatch if warranted.

**Payment Providers: deactivation has real consequences (added 2026-08, same pass as Communication/Giving
Providers' equivalents).** `payment_providers` (`PlatformPaymentProvider`) gives platform admins the same
list/deactivate capability over paystack/flutterwave/kora that already existed for communication and giving
providers — but the blast radius is meaningfully narrower here, because unlike those two there's no per-tenant BYOK
config table: every tenant shares the platform's own provider credentials, so there's nothing to filter out of a
tenant-facing catalog and nothing per-tenant to cache-invalidate.

- `PaymentProviderRegistryService.get()` — used by webhook handling (`handleWebhookEvent`), self-serve cancel
  (`cancelSubscription`), and refunds (`refundCheckoutSession`) — deliberately **never** checks the DB `isActive`
  flag. An already-charged or already-subscribed tenant's in-flight lifecycle must keep working regardless of a
  later deactivation; rejecting a webhook for an already-completed charge would take the tenant's money without
  crediting their subscription, the same reasoning `GivingCheckoutService.handleWebhook` already established for
  tithe/giving webhooks.
- `PaymentProviderRegistryService.assertActive()` — a new, separate method, used **only** by
  `initiateSubscriptionCheckout()` — resolves the same provider name then throws `400` if its `payment_providers`
  row is deactivated. This is the only place deactivation is actually enforced: starting a *new* subscription
  checkout against a deactivated provider.
- `PlatformPaymentProviderService.setActive()` looks up every `Subscription` currently on that provider (any status
  except `CANCELED`) and sends a targeted `TenantBroadcastService.notifyTenants()` email — worded accurately rather
  than reusing the Communication/Giving copy verbatim, since an existing subscriber's recurring renewal is genuinely
  unaffected (it flows through the webhook path above, which never checks `isActive`); only starting a *new*
  checkout with that provider is blocked until it's restored.
- No `registerProvider()` — unlike `CommunicationProvider`/`GivingProvider`, paystack/flutterwave/kora are
  hard-coded `IPaymentProvider` classes wired into `BillingModule` (`PaystackPaymentProvider` etc.), not arbitrary
  BYOK entries a platform admin can add by id/name alone. A fourth vendor needs its own provider class written and
  registered in `PaymentProviderRegistryService` first, same as it always has — the DB row is just bookkeeping for
  that vendor's on/off state, not a way to add one.

**Routes** (`AdminGuard`, tenant-scoped, unless noted):

| Method | Path                              | Permission     | Description |
|--------|-----------------------------------|----------------|--------------|
| GET    | `/billing/summary`                | BILLING_READ   | `{ planId, planName, subscriptionStatus, currentPeriodEnd, cancelAtPeriodEnd, sponsoredByParent }` |
| GET    | `/billing/plans`                  | BILLING_READ   | Full plan catalog (`[{ id, name, tierKey, priceCents, currency, features }]`), ordered by price ascending — every currency variant of every tier as its own row; the frontend groups by `tierKey` itself. The only tenant-accessible plan list; `GET /platform/plans` is platform-admin-only |
| GET    | `/billing/public/plans`           | None — `@Public()` (bypasses the global `JwtAuthGuard`) and `TenantMiddleware`-excluded | Tier-grouped catalog for discuva-web (no tenant/admin context at all): `[{ tierKey, name, features, featureLimits, variants: [{ planId, currency, priceCents, billingInterval }] }]`, variants and tiers sorted by price ascending |
| POST   | `/billing/checkout/subscribe`     | BILLING_WRITE  | Body `{ planId, provider?, successUrl, cancelUrl }` — returns `{ checkoutUrl }` to redirect the admin to; `400` if the named (or default) provider is deactivated — see "Payment Providers: deactivation has real consequences" above |
| POST   | `/billing/cancel`                  | BILLING_WRITE  | No body — cancels immediately or at period end depending on `currentPeriodEnd`; `400` if no paid/cancelable subscription |
| POST   | `/webhooks/billing`                | No guard — provider webhook | `@Public()`, dispatches to Paystack or Flutterwave by which of their two signature headers is present (`x-paystack-signature` HMAC-SHA512 vs `verif-hash` shared-secret string compare) |
| GET    | `/platform/tenants/:id/billing-sessions` | Platform admin | This tenant's checkout session history, newest first |
| POST   | `/platform/billing-sessions/:sessionId/refund` | Platform admin | Body `{ amountCents? }` — omitted means a full refund |
| GET    | `/platform/payment-providers`     | Platform admin (`BILLING_READ`) | `[{ id, name, isActive }]`, ordered by name |
| PATCH  | `/platform/payment-providers/:id` | Platform admin (`BILLING_WRITE`) | `{ isActive }` — activate/deactivate. See "Payment Providers: deactivation has real consequences" above. |

**Env vars:** `PAYSTACK_SECRET_KEY`, `PAYSTACK_BASE_URL`, `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_SECRET_HASH`,
`FLUTTERWAVE_BASE_URL`, `DEFAULT_PAYMENT_PROVIDER`, `SUBSCRIPTION_PERIOD_DAYS` (default
`30`, monthly-plan renewal period), `ANNUAL_SUBSCRIPTION_PERIOD_DAYS` (default `365`, annual-plan renewal
period — both read by `CheckoutService.applyChargeSucceeded()`, keyed by the charged plan's `billingInterval`),
`GRACE_PERIOD_DAYS` (default `7`, `SubscriptionLapseScheduler`'s
PAST_DUE window before downgrading to Free) — see Environment Variables.

**Paystack `subscription.create` handling (added and verified against a real sandbox payload):**
`CheckoutService.applySubscriptionCreated()`, triggered by `PaymentEventType.subscription.created`, fires once
right after the first successful charge on a subscription-linked transaction — confirmed live that `charge.success`
itself never carries a subscription identifier, only this separate event does (`data.subscription_code`). Matched
to a tenant via `data.customer.metadata.tenantId` (the same metadata attached at checkout-initiation time), not a
checkout reference, since a freshly-created provider subscription has none of its own. Populates
`Subscription.billingProviderSubscriptionId` (closing the gap `applySubscriptionCanceled` needed — see above) and,
when the payload includes one, sets `currentPeriodEnd` directly from the provider's own `next_payment_date` rather
than our `SUBSCRIPTION_PERIOD_DAYS`/`ANNUAL_SUBSCRIPTION_PERIOD_DAYS` math, since that reflects the provider's
actual billing clock rather than whenever we happened to receive a webhook. **No Flutterwave/Kora equivalent, and
none is planned** — neither provider ever creates a real server-side subscription (see the capability-gap note
above), so there's no creation event to capture an id or a next-payment-date from; their `currentPeriodEnd` is
always purely `SUBSCRIPTION_PERIOD_DAYS`/`ANNUAL_SUBSCRIPTION_PERIOD_DAYS` math from checkout time, by design. True
full recurring-billing reconciliation (the provider's own renewal events driving every subsequent period, not just
the first) is still not built even for Paystack — only the *first* charge's subscription-creation metadata is
captured today.

Billing/plan settings UI in `discuva-admin` (`/billing`) is built — plan picker, cancel/downgrade, past-due banner,
plan-inheritance indicator for a sponsored branch. (SMS wallet top-up UI was removed along with the wallet itself —
SMS billing is now entirely the tenant's own vendor relationship, outside this app.)

**Plan feature gating (`PlanGuard`) — boolean gate plus an optional, per-route numeric cap:** any route decorated
`@RequiresPlan(PlanFeature.X)` first checks `Plan.features` membership (boolean gate, cached under
`plan-features:${tenantId}` for 300s via the shared `PlanFeatureResolverService`) and throws
`403 { code: 'PLAN_UPGRADE_REQUIRED' }` if the feature isn't included. If the feature *is* included, the plan has a
numeric limit configured for it (`Plan.featureLimits`, a `jsonb` map of capability key → max lifetime uses,
admin-editable via `PATCH /platform/plans/:id`), **and** the specific handler invoked also carries
`@CountsTowardLimit(PlanFeature.X)`, `PlanGuard` does a read-only check (`FeatureUsageService.getUsage`) and 403s
if usage is already at the cap. This is deliberately narrower than the boolean gate above: `@RequiresPlan` sits at
class level and covers every route in a controller (list, read, poll, join...), while `@CountsTowardLimit` is
opt-in per method — only the one route meant to consume a use (typically `create`) carries it, e.g.
`AdminGameController.create` is the only Games route with `@CountsTowardLimit(PlanFeature.GAMES)`; listing games,
polling a live session's state, joining, answering, and viewing a leaderboard never touch the counter even when a
`games` limit is configured.

The actual increment happens in `PlanLimitInterceptor` (`src/billing/interceptor/plan-limit.interceptor.ts`,
registered globally via `APP_INTERCEPTOR` in `billing.module.ts`, a no-op unless the route carries
`@CountsTowardLimit`), **after** the handler succeeds — via RxJS `tap()` on the response — not before. A request
whose handler throws (validation error, 404, etc.) never reaches the `tap()`, so a failed create never spends a
use; only a request that actually completes does. The increment itself reuses `FeatureUsageService.tryConsume`
(backed by `public.feature_usages`, one row per `(tenantId, feature)`, a single conditional
`INSERT ... ON CONFLICT ... WHERE count < limit`), fire-and-forget from the interceptor's point of view — the
response has already been decided by the guard's earlier read-only check. Splitting "check" (guard, before) from
"consume" (interceptor, after success) reopens a narrow race two truly concurrent creates could both pass the
pre-check before either increments; `tryConsume`'s own `WHERE count < limit` still caps the damage to at most one
extra unit of usage, an accepted tradeoff over the alternative of consuming on every request regardless of outcome.
Usage counts are lifetime and never reset by a plan change — upgrading past a cap and later downgrading back below
it still reflects prior usage rather than granting a fresh allowance.

**Every toggleable module is also a plan-assignable capability, not just the original 12 `PlanFeature` values.**
`ModuleEnabledGuard` (`src/church-settings/guard/module-enabled.guard.ts`) — the guard behind every
`@RequiresModule('x')` controller — checks two things in order: the tenant's `ChurchSetting` on/off toggle
(unchanged), then whether `x` is included in the tenant's plan's `features` array (same `PlanFeatureResolverService`
lookup `PlanGuard` uses), 403ing with the identical `PLAN_UPGRADE_REQUIRED` shape if not. This makes moving *any*
module (originally Prayer, Evangelism, Training Classes, Tithe/Giving, Sunday School, Pastor Feedback, Fellowships,
Social Media, Children's Church, Announcements, Follow-Up — the 11 that were previously free with no plan concept
at all) between Free and Pro a `PATCH /platform/plans/:id` data change from the discuva-platform Plans page, not a code
deploy — no new `PlanFeature` enum value, no new `@RequiresPlan` decorator, no migration. `ALL_CAPABILITY_KEYS`
(`src/billing/constant/capability-keys.constant.ts`) is the full set of strings a `features`/`featureLimits` entry
may validly be: the original `PlanFeature` values (`finance`/`sms`/`audit`/`bulk_export` have no `KNOWN_MODULES`
counterpart and stay purely plan-gated, no toggle) unioned with every `KNOWN_MODULES` key. `GET /platform/capabilities`
(`PlatformCapabilityService`) returns this same set labeled for the Plans page's checkbox list, replacing what used
to be a hardcoded 12-entry array in `plan-form-panel.tsx` (which — notably — never included `forms`, fixed as a
side effect).

A one-time backfill migration (`BackfillModuleCapabilityKeys`) added the 11 previously-free module keys to *both*
`free` and `pro` plans' `features` (preserving today's access for every tenant — a platform admin removes a key
from `free` afterward to make it Pro-only) and 3 module-key spellings that don't match their pre-existing
`PlanFeature` value (`sermons`/`sermon`, `service_ratings`/`service_rating`, `volunteering`/`volunteer` — these
three already carried both decorators with two different strings) to `pro` only, alongside the existing spelling —
a known, deliberately-left naming inconsistency, not something worth a tenant-data rename for now.

**Tithe/Giving (`tithe` key — manual recording, BYOK payment-provider setup, and the member checkout flow) is
Pro-only** (`MoveTitheToProOnly` migration, run right after the backfill above). Same treatment as `sms`: BYOK
means it costs Discuva nothing regardless of volume (money flows straight through the tenant's own Paystack/
Flutterwave/Stripe/Kora account, `TenantGivingProviderController`), but it's high enough business value that it's
gated as a deliberate upgrade lever rather than left free on cost grounds. The remaining 10 free-from-launch
modules (Prayer, Evangelism, Training Classes, Sunday School, Pastor Feedback, Fellowships, Social Media,
Children's Church, Announcements, Follow-Up) are unaffected.

**Per-tenant manual override, independent of plan (`Tenant.moduleOverrides`).** The plan-features mechanism above
answers "which tier includes this module," a platform-wide default every tenant on that tier shares. It has no
answer for "let this one specific church test it regardless of their plan" or "pull access from this one tenant
without touching their plan or anyone else's" — exactly the shape of control needed to roll a still-unstable module
(Social Media, initially) out to a hand-picked set of test tenants before it's ready to sit in any plan's default
`features` at all. `moduleOverrides` is a nullable `jsonb` map on `Tenant`, keyed by the same `KNOWN_MODULES`/
`PlanFeature` strings as `Plan.features` — `{ social_media: true }` grants that module regardless of plan,
`{ social_media: false }` blocks it regardless of plan, a key simply absent (or the whole map `null`) means no
override — falls through to the plan check exactly as before this existed. `ModuleEnabledGuard` checks it between
the tenant's own on/off toggle and the plan-features check: tenant toggle off still always wins (a church's own
choice is never overridden), then override `false` blocks outright, override `true` grants outright, and only an
absent override falls through to `features.includes(moduleKey)`. `PlanGuard` (the 4 orphan `PlanFeature`-only
gates with no `KNOWN_MODULES` counterpart) doesn't consult this — no per-tenant override need has come up for
those yet, easy to extend the same way later if one does.

`PlanFeatureResolverService.resolve()` — already shared by both guards, already caching per-tenant under
`plan-features:${tenantId}` — now also fetches the `Tenant` row and returns `overrides` alongside `features`/
`featureLimits`, so this costs no extra guard-level round trip or cache key. `PlatformTenantService.setModuleOverride()`
validates `moduleKey` against `KNOWN_MODULES`, merges into the existing map (clearing to `null` only once the
*last* override key is removed, never wiping a tenant's other overrides), saves, and invalidates the same
`plan-features:${tenantId}` cache key `changeTenantPlan`/`applyDiscount` already do.

| Method | Route | Auth | Notes |
|--------|-------|------|-------|
| PATCH | `/platform/tenants/:id/module-overrides` | PlatformAdminGuard (TENANTS_WRITE) | `{moduleKey: string, enabled: boolean \| null}` — `null` clears just that one key |

**`MakeSocialMediaOverrideOnly` migration** removed `social_media` from every plan's `features` (it had been in
`pro`/`pro-annual`/`pro-usd`/`pro-usd-annual` since the original backfill, never in `free`) — Social Media is no
longer plan-included by default anywhere. It's an opt-in, still-early-access module now gated entirely through the
Social Media Rollout control below.

**Social Media Rollout — the one control surface (`PlatformTenantService.setSocialMediaRollout`/
`getSocialMediaRollout`).** A platform admin doesn't reason about `Plan.features` vs `Tenant.moduleOverrides`
separately for this module — they use a single toggle plus an optional searchable multi-select of churches, and
`setSocialMediaRollout()` decides which underlying mechanism to write:

- **Disabled:** strips `social_media` from every plan's `features` and clears the `social_media` key from every
  tenant's `moduleOverrides`. Nobody has access.
- **Enabled, empty selection ("everyone"):** adds `social_media` to every plan's `features` (all tiers, not just
  Pro — a true "for all" regardless of plan) and clears every tenant's override. Forward-looking: a tenant created
  next week is covered automatically via the plan check, same as any other plan-included module.
- **Enabled, specific selection:** strips `social_media` from every plan's `features` (so it stays off by default)
  and sets `moduleOverrides.social_media = true` for exactly the selected tenants — clearing the key for any
  previously-selected tenant no longer in the list, so re-saving a shorter list actually revokes access rather than
  only ever adding to it.

The two mechanisms are kept mutually exclusive on write so there's never a redundant or contradictory state (a
tenant with a `true` override while the plan already includes the module, or vice versa).

| Method | Route | Auth | Notes |
|--------|-------|------|-------|
| GET | `/platform/social-media/rollout` | PlatformAdminGuard (SOCIAL_MEDIA_APPS_READ) | `{enabled: boolean, tenantIds: string[]}` — derived live: `enabled:true, tenantIds:[]` if any plan includes `social_media`, else the list of tenants with a `true` override |
| PUT | `/platform/social-media/rollout` | PlatformAdminGuard (SOCIAL_MEDIA_APPS_WRITE) | `{enabled: boolean, tenantIds: string[]}` — full replace, not incremental |

**Frontend:** a "Social Media Rollout" card on discuva-platform's Social Media Apps page (`RolloutPanel`) — an
on/off switch plus a searchable multi-select of churches (chips + type-ahead), shown only when enabled. Replaces
the earlier per-tenant `TenantDetailPanel` "Force On/Off" buttons, which required visiting each church individually
and made "roll out to everyone" a two-step, easy-to-forget dance (remove from Plan.features, then Force On each
tenant by hand) — this is now one screen, one save. `TenantDetailPanel`'s "Social Media Access" field is now
read-only status text (resolved from the same `moduleOverrides`/plan data) with a link back to this page; the
generic `PATCH /platform/tenants/:id/module-overrides` endpoint and `setModuleOverride()` still exist underneath
and remain usable for any other `KNOWN_MODULES` key that later needs the same per-tenant-override treatment.

**Pages Rollout — same mechanism, generalized.** `setSocialMediaRollout`/`getSocialMediaRollout` were the only
implementation of this rollout lifecycle until Pages needed the identical "opt-in, still-early-access module with
no platform-admin control surface at all" treatment the Pages section above already flags (it shipped gated purely
through `Tenant.moduleOverrides`, with no dedicated rollout UI, requiring a platform admin to Force On each church
individually via the generic module-overrides endpoint). Rather than duplicate the whole all-vs-specific/
`Plan.features`-vs-`moduleOverrides` branch a second time, that logic moved into private
`PlatformTenantService.setModuleRollout(moduleKey, dto)`/`getModuleRollout(moduleKey)`, with
`setSocialMediaRollout`/`getSocialMediaRollout` now one-line delegates (`moduleKey: 'social_media'`) and two new
public delegates, `setPagesRollout`/`getPagesRollout` (`moduleKey: 'pages'`), added alongside them. The request DTO
was renamed accordingly (`set-social-media-rollout.dto.ts` → `set-module-rollout.dto.ts`,
`SetSocialMediaRolloutDto` → `SetModuleRolloutDto`) since its shape was already module-agnostic. Behavior is
byte-identical to Social Media's, just keyed on `pages` instead — a plan gaining `pages` in its `features` (the
"everyone" case) or a tenant gaining `moduleOverrides.pages = true` (the "specific churches" case) both flow
through the exact code path already covered above.

**Two bugs found and fixed while wiring up Pages Rollout, both around cache invalidation from platform-admin
requests.** Reported symptom: a platform admin enabled Pages for a tenant, but that tenant's discuva-admin kept
showing the plan-upgrade-required gate.

1. **Missing invalidation entirely, in `setSocialMediaRollout`'s "disabled" and "enabled, empty tenantIds"
   branches.** `PlanFeatureResolverService.resolve(tenantId)` caches its result under `plan-features:${tenantId}`
   for 300s. Those two branches only called `cacheService.del()` for tenants whose *override* changed in the loop
   that follows them — a tenant gaining or losing access purely because the **plan's** `features` array changed
   (the common case for both branches, and for any plain `PATCH /platform/plans/:id` edit to a plan's `features`
   via the Plans admin page) had no cache invalidated at all. Fixed two places: `setModuleRollout()` now calls a
   new `invalidateAllTenantCaches()` (a full tenant scan + one cache invalidation per tenant — no reverse index
   exists from a plan to its subscribers, and tenant counts at this platform's scale make a full scan cheap enough
   not to warrant one) at the end of all three branches, superseding the old per-affected-tenant-only
   invalidation; `PlatformPlanService.updatePlan()` (previously had no `CacheService` dependency at all) now
   invalidates every tenant subscribed to the edited plan whenever `features` or `featureLimits` changes.

2. **The deeper bug: every invalidation in this file — including the pre-existing ones in `changeTenantPlan` and
   `setModuleOverride` that predate this Pages work entirely — was computing the wrong Redis key.**
   `CacheService.del()`/`.get()`/`.set()` all route through a private `scopedKey()` that prefixes the key with
   `tenant:${cls.get('tenantId') ?? 'global'}:`. Platform-admin routes are deliberately excluded from
   `TenantMiddleware` (see `PlanFeatureResolverService`'s own comment), so every request into
   `PlatformTenantService`/`PlatformPlanService` has **no tenant id in CLS at all** — a bare
   `cacheService.del(\`plan-features:${tenant.id}\`)` call from here always resolved to
   `tenant:global:plan-features:${tenant.id}`, while the entry actually written by
   `PlanFeatureResolverService.resolve()` (called from inside an actual tenant-scoped request, where CLS
   genuinely holds that tenant's id) lives at `tenant:${tenant.id}:plan-features:${tenant.id}` — a different key
   entirely, so the "invalidation" was always a silent no-op. This had gone unnoticed for as long as caching has
   existed here (`tenant-branding` cache invalidation in `updateTenant` has the identical bug) because the TTL is
   only 300s — most manual testing outlasted the staleness window without anyone noticing the del() call never
   actually did anything. It surfaced clearly this time because the Pages tenant under test had a warm cache from
   moments earlier. **Fix:** a new `PlatformTenantService.delTenantCache(tenantId, key)` re-enters that tenant's
   CLS context via `cls.runWith({tenantId}, () => cacheService.del(key))` before deleting — every cache
   invalidation in the file (branding, plan-features, the rollout's blanket invalidation) now goes through it
   instead of calling `cacheService.del()` bare; `PlatformPlanService.updatePlan()` does the equivalent inline
   with its own newly-injected `ClsService`. Regression-tested by asserting `ClsService.runWith` is actually
   called with the correct `{tenantId}` before the cache key is touched — a test that would have passed under the
   old bare-`del()` code by simply never noticing the key was wrong, if it only asserted `cacheService.del` was
   called with the right raw key.

| Method | Route | Auth | Notes |
|--------|-------|------|-------|
| GET | `/platform/pages/rollout` | PlatformAdminGuard (TENANTS_READ) | `{enabled: boolean, tenantIds: string[]}`, same derivation as Social Media's but keyed on `pages` |
| PUT | `/platform/pages/rollout` | PlatformAdminGuard (TENANTS_WRITE) | `{enabled: boolean, tenantIds: string[]}` — full replace, not incremental |

Gated by the `Tenants` permission rather than a dedicated `PAGES_*` platform permission — unlike Social Media
(which has its own permission pair because it already needs one for the Social Media Apps/OAuth-credentials page
this rollout card lives on), Pages has no other platform-admin surface, so this is fundamentally the same
tenant-access-management action as the generic per-tenant module-override endpoint above, just gated the same way.

**Frontend:** a standalone "Pages" page in discuva-platform's sidebar (`/pages`, `pages:read`/`pages:write` in the
frontend's own permission scheme — unrelated to the tenant-schema `AdminPermission.PAGES_READ`/`PAGES_WRITE`
documented in the Pages module section above, which gates the church-side admin builder instead), containing
nothing but the same `RolloutPanel` pattern Social Media uses (on/off switch + searchable multi-select of
churches). No apps/credentials section, since Pages has no third-party OAuth concept to register.

**`departments` was Pro-only by accident, corrected via `AddDepartmentsToFreePlan`.** Unlike `tithe`, this had no
migration or comment ever recording it as a deliberate gate — and it directly contradicted `KNOWN_MODULES`'s own
`required: true` flag on `departments` (`src/church-settings/constants/known-modules.constant.ts`), which marks it
as a module a church can never disable, i.e. a foundational primitive, not an optional upsell. It's also the FK
backbone for a wide swath of the app regardless of plan — attendance, worker profiles, finance requests, assets,
games, volunteer opportunities, announcements, and event reminders all reference `department_id`. A Free-tier
tenant was getting `403 PLAN_UPGRADE_REQUIRED` on anything gated by `@RequiresModule('departments')` as a result.
Fixed by adding `departments` to `free.features` (idempotent, `WHERE NOT ('departments' = ANY(features))`) — `pro`
and its currency/interval variants (`pro-usd`, `pro-annual`, `pro-usd-annual`) already had it, inherited via
cloning when those variant rows were created.

**Internal comps/discounts (`Subscription.discountType`/`discountValue`/`discountReason`/`discountExpiresAt`):** a
platform-admin-only manual comp, set via `PATCH /platform/tenants/:id/discount` and cleared via
`DELETE /platform/tenants/:id/discount` (both `TENANTS_WRITE`, both require an existing `Subscription` row — apply
`PATCH /platform/tenants/:id/plan` first if the tenant has none yet). `discountType` is `percentage` (1–100,
validated server-side) or `fixed_amount` (cents); `discountExpiresAt` is optional — `null` means permanent until
explicitly removed. Deliberately **never touches checkout or a payment provider** — same spirit as
`sponsoredByTenantId` above, and for the same structural reason: Paystack's recurring charges are driven
by a provider-side Plan object keyed on `Plan.billingProviderPriceId`, not a per-transaction amount override, so a
discount here can't change what Paystack actually auto-renews at without creating a distinct provider Plan per
discount tier (out of scope for an internal comp). Its effect is bookkeeping only: `PlatformAnalyticsService.mrrByCurrency()`
sums each active, non-sponsored subscription's *effective* (discounted) price via the shared
`computeEffectivePriceCents()` helper (`src/billing/util/discount.util.ts`) rather than the raw `Plan.priceCents`, so
reported MRR reflects comps; `GET /platform/tenants` also returns the four discount fields per tenant for display.
MRR is grouped by `Plan.currency` (`[{ currency, mrrCents }]`), never blended into one figure — same reasoning as
giving totals below: an NGN-priced and a USD-priced subscription summed together would be meaningless.

### Branch Hierarchy (`src/branch/`)

Lets a parent church invite another church to join as a branch, and see a rollup of its branches' member
count/attendance/giving — `docs/MULTI_TENANT_MIGRATION.md` §11's "local compute, pushed rollups" design, now built.
A branch is a tenant like any other (own schema, own admin, own everything) — the only difference is
`tenants.parent_tenant_id` is set.

**Onboarding:** parent admin `POST /branch/invites` (email) generates a 64-char opaque token (not a JWT — has to be
looked up by value later, not decoded), emails it, and records a `pending` row in `tenant_branch_invites`
(`public` schema — has to live there since the invited church has no tenant of its own yet, the very thing the
invite exists to create). `POST /signup` accepts an optional `branchInviteToken`; `SignupController` resolves and
validates it (pending, unexpired) *before* enqueueing provisioning, so a bad/expired code fails fast without
creating a tenant row. `TenantProvisioningProcessor` only marks the invite `accepted` *after* provisioning actually
succeeds (see "Async Tenant Provisioning + Onboarding State Machine" above) — a subdomain collision or any other
provisioning failure leaves the invite still usable for a retry rather than burning it.

**Plan sponsorship (`sponsorPlan`, optional on `POST /branch/invites`):** the parent's stated intent, carried on
the invite row and resolved at signup time — `BranchInviteService.resolveInvite()` returns a `sponsoredPlanId` when
`sponsorPlan` was true *and* the parent currently has a paid (non-`free`) subscription; a parent on Free has nothing
to sponsor onto, so this silently falls back to the normal independent Free-tier signup rather than erroring. When
set, `TenantProvisioningService.provision()` creates the branch's `Subscription` directly on that plan with
`sponsoredByTenantId` pointing at the parent — no checkout, no independent payment. See Billing & Checkout above for
how sponsorship affects cancellation (blocked — it isn't the branch's plan to cancel) and MRR (excluded).

**Rollup computation (`BranchRollupScheduler`, daily 03:00 church time, distributed-lock guarded):** iterates every
active tenant — not just ones with a parent, since a branch invited later still needs history once linked — and for
each one manually enters that tenant's CLS/transaction context (`BranchRollupService.computeAndUpsertOne`, same
mechanism as `YoutubeLiveDetectionService`/`PlatformTenantService.impersonateTenant`) to compute:

| Field | Definition |
|-------|------------|
| `memberCount` | Count of `members` with `status = ACTIVE` |
| `attendanceRate` | Same PRESENT/LATE/ATTENDED_ONLINE-over-a-window definition `AttendanceService.getMyAttendanceSummary` already uses per-member (ON_LEAVE excluded from both numerator and denominator), aggregated church-wide over the last 30 days instead. `null` when there are zero attendance rows in the window, not `0` |
| `totalGiving` | Sum of `tithe_records.amount` |

The public `tenant_rollups` row is upserted *outside* the tenant-context block (same convention as
`YoutubeLiveDetectionService`'s own public-row update) using the plain, non-tenant-scoped repository.

**Parent-side overview (`GET /branch/overview`):** reads only `tenants WHERE parent_tenant_id = :self` joined
against `tenant_rollups` — never reaches into a branch's schema or shard directly, no cross-tenant read path exists
in this class at all to get wrong (§11.2).

**Sharing consent (`tenants.share_data_with_parent`, `tenants.share_giving_with_parent`):** without this, a
branch's rollup became visible to its parent the instant an invite was accepted, with no notice or opt-out.
Self-service, settable only by the branch's own admin via `GET`/`PATCH /branch/sharing-consent` — never by the
parent. Gates *visibility* at `getOverview()`, not *computation* — `computeAndUpsertOne` still computes and stores
every branch's real numbers regardless (a branch's own `tenant_rollups` row is its own data, useful for its own
future views too); consent only controls what's exposed to a specific parent. `shareDataWithParent` defaults `true`
(being a branch structurally implies a reporting relationship — that's the point of the feature, and the admin who
accepted the invite already knows a parent relationship is being formed) and gates every stat when `false` (all
fields `null`, `sharingEnabled: false` in the response — the parent still sees the branch exists, since they
invited it, just not its numbers). `shareGivingWithParent` defaults `false` **regardless of the main flag** — giving
specifically stays opt-in even when general sharing is on, matching how sensitive individual church finances are
treated everywhere else in this codebase (dedicated `TITHE_READ` permission, PII-scrubbing conventions).

**Un-linking (either side can end the relationship):** `DELETE /branch/:branchTenantId` (parent-initiated — detach
one of *this tenant's own* branches, `404` if not actually linked to them) and `POST /branch/leave`
(branch-initiated — the current tenant leaves its own parent, `400` if it has none). Neither side is permanently
locked into a relationship it no longer wants. Both revoke a sponsored plan on the way out
(`revokeSponsorshipIfSponsoredBy`) if the departing tenant's `Subscription.sponsoredByTenantId` matches the
relationship being severed — continuing free access sponsored by a parent it's no longer affiliated with wouldn't
make sense. A subscription sponsored by some *other* tenant (not the one being unlinked from) is left untouched.

**Linking an already-onboarded tenant as a branch (`TenantBranchLinkRequest`, `src/branch/service/branch-link-request.service.ts`):**
the invite flow above only covers a church that doesn't have a tenant yet — it can't be reused for two churches that
are *already* separate, fully-onboarded tenants, since there's no signup step left to attach a token to. This is a
two-sided negotiation between two existing tenants instead: a would-be parent's admin sends a request naming the
target's subdomain (`POST /branch/link-requests`), and nothing about either tenant changes until the **target's own
admin**, from inside their own tenant context, explicitly accepts or declines it (`POST
/branch/link-requests/:id/accept`/`/decline`) — the parent cannot accept on the target's behalf, mirroring the same
"write intent first, mutate state only on confirmed action" discipline used everywhere else BYOK/checkout-shaped
flows appear in this codebase. `TenantBranchLinkRequest` (`public` schema, `tenant_branch_link_requests`) is the
sibling control-plane table to `tenant_branch_invites`, keyed on `targetTenantId` instead of an email+token pair
since the target already exists to be looked up directly.

Validation at creation time: target subdomain must resolve to a real tenant, a tenant can't link itself
(`target.id === parentTenantId`), the target can't already have a parent, and only one `pending` request between a
given parent/target pair may exist at a time. On accept, `target.parentTenantId` is set directly (no provisioning
involved — the target tenant already exists) and, if `sponsorPlan` was requested and the parent currently has a paid
plan, the target's *existing* `Subscription` row is switched onto the parent's plan
(`planId`/`status: ACTIVE`/`cancelAtPeriodEnd: false`/`sponsoredByTenantId`) — same fallback as
`BranchInviteService.resolveInvite` if the parent is on Free (silently skipped, not an error, since `sponsorPlan` was
only ever a request). Both sides get a best-effort email notification (target on request creation, parent on
accept/decline) via the same manually-entered tenant-context pattern `SubscriptionLapseScheduler.findAdminEmail`
already uses (looks up the tenant's oldest active `Admin`, ordered by `createdAt`) — reused here through the shared
`runInTenantContext` helper rather than duplicated inline, since the recipient's admin row lives in a schema this
service has no ambient CLS context for.

A parent can have any number of branches — `getOverview()`/`listOutgoing()` are both plain unbounded
`WHERE parentTenantId = :self` queries, and nothing in this feature restricts branch count.

`GET /branch/link-requests/outgoing`/`/incoming` return `BranchLinkRequestView`, not the raw entity — the entity
only stores `parentTenantId`/`targetTenantId` UUIDs, so both list reads batch-fetch the referenced `Tenant` rows
(one `IN` query per list call) and enrich each row with `parentTenantName`/`targetTenantName`/`targetTenantSubdomain`
before returning, the same way `BranchInviteService`'s invites are already human-readable via the invite's own
`email` column.

**Un-linking (either side can end the relationship):** `DELETE /branch/:branchTenantId` (parent-initiated — detach
one of *this tenant's own* branches, `404` if not actually linked to them) and `POST /branch/leave`
(branch-initiated — the current tenant leaves its own parent, `400` if it has none). Neither side is permanently
locked into a relationship it no longer wants. Both revoke a sponsored plan on the way out
(`revokeSponsorshipIfSponsoredBy`) if the departing tenant's `Subscription.sponsoredByTenantId` matches the
relationship being severed — continuing free access sponsored by a parent it's no longer affiliated with wouldn't
make sense. A subscription sponsored by some *other* tenant (not the one being unlinked from) is left untouched. This
applies identically regardless of whether the branch was linked via invite or via a link request — `unlinkBranch`/
`leaveParent` only look at `Tenant.parentTenantId`/`Subscription.sponsoredByTenantId`, not how the link was formed.

**Routes** (`AdminGuard`, tenant-scoped):

| Method | Path                              | Permission     | Description |
|--------|-----------------------------------|----------------|--------------|
| POST   | `/branch/invites`                 | BRANCH_WRITE   | Body `{ email, sponsorPlan? }` — creates a pending invite, emails the invite code. `sponsorPlan: true` means the branch is provisioned onto the parent's current plan at signup, at no independent cost, if the parent is on a paid plan |
| GET    | `/branch/invites`                 | BRANCH_READ    | This tenant's own sent invites |
| DELETE | `/branch/invites/:id`             | BRANCH_WRITE   | Revokes a `pending` invite — `400` if it's already accepted/revoked |
| GET    | `/branch/overview`                | BRANCH_READ    | This tenant's branches, each joined with its latest rollup, filtered by each branch's own sharing consent |
| GET    | `/branch/sharing-consent`         | BRANCH_READ    | This tenant's own `{ shareDataWithParent, shareGivingWithParent, parentTenantId, parentTenantName }` — the latter two are null when this tenant isn't a branch of anything, and are the only way for the frontend to know whether "Leave Parent" is relevant to show at all |
| PATCH  | `/branch/sharing-consent`         | BRANCH_WRITE   | Body is a partial of `{ shareDataWithParent, shareGivingWithParent }` — only provided fields are applied; `parentTenantId`/`parentTenantName` are read-only and always echoed back |
| DELETE | `/branch/:branchTenantId`         | BRANCH_WRITE   | Parent detaches one of its own branches — `404` if not linked to this tenant |
| POST   | `/branch/leave`                   | BRANCH_WRITE   | This tenant leaves its own parent — `400` if it has none |
| POST   | `/branch/link-requests`           | BRANCH_WRITE   | Body `{ targetSubdomain, sponsorPlan? }` — sends a link request to an already-onboarded tenant. `404` if the subdomain doesn't resolve, `400` if self-link/target already has a parent/a pending request already exists |
| GET    | `/branch/link-requests/outgoing`  | BRANCH_READ    | Link requests this tenant has sent, as a would-be parent |
| DELETE | `/branch/link-requests/:id`       | BRANCH_WRITE   | Parent revokes its own `pending` request — `400` if no longer pending |
| GET    | `/branch/link-requests/incoming`  | BRANCH_READ    | Link requests sent TO this tenant by a would-be parent |
| POST   | `/branch/link-requests/:id/accept`| BRANCH_WRITE   | Target accepts — sets `parentTenantId`, applies sponsorship if requested and the parent is on a paid plan. `400` if not pending or this tenant already has a parent |
| POST   | `/branch/link-requests/:id/decline`| BRANCH_WRITE  | Target declines — `400` if no longer pending |

Branch hierarchy UI is built in `discuva-admin` (`/branch-hierarchy`) — invite-sending, branches overview with
unlink, link-request sending/incoming-review, and a "this church" section showing sharing consent toggles +
leave-parent, only shown when `parentTenantId` is actually set (see `GET /branch/sharing-consent` above).
Multi-level hierarchy (branch-of-a-branch) is representable with zero further schema change (`parent_tenant_id` is
self-referencing) but only flat parent → branch is exercised by anything built so far.

### Forms (`src/forms/`)

Admin-built dynamic forms — not tied to any one use case (events, surveys, sign-ups, and admin-recorded pastoral
records all reuse the same builder). A form has a `visibility` of `MEMBERS`, `PUBLIC`, or `ADMIN_ONLY`, an optional
link to an `Event`, and an ordered list of fields (`TEXT`, `NUMBER`, `EMAIL`, `PHONE`, `TEXTAREA`, `DATE`,
`DROPDOWN`, `CHECKBOX` — the latter two carry an `options` array). A `PUBLIC` form is fillable with no login at all
— the whole point of making it public — `MEMBERS` forms require an authenticated member/worker token, and
`ADMIN_ONLY` forms have **no** member-facing or public-facing fill surface at all — the only way a submission is
ever created against one is `POST /forms/:id/submissions` (admin-only; see below). `ADMIN_ONLY` exists for
record-keeping forms an admin fills in on someone else's behalf rather than the subject self-submitting — e.g.
pastoral records (child naming, dedication, marriage, baptism), where the subject often has no reason or ability
to self-submit (a newborn being named has no account). This is a general-purpose escape hatch, not a fixed set of
pastoral-record types the way a hardcoded "Notes" module would be — an admin defines whatever fields a given
record type needs, and gets the same generic per-field analytics (see below) any other form gets, with zero new
backend code per record type.

**Field order is always explicit, never left to Postgres's default row order.** `Form.fields` is an eager
`@OneToMany` relation with no `orderBy` of its own, so every `formRepo.find`/`findOne` call across
`FormService`/`FormSubmissionService` passes `order: { fields: { order: 'ASC' } }` explicitly — an unordered join
doesn't reliably return rows in `FormField.order` order (or even the same order twice in a row), which surfaced as
the admin builder's field list visibly reshuffling itself on every page load/refresh, with no reordering ever
actually requested. `getById`'s ordering alone covers most call sites (`update`, `cloneForm`, `getAnalytics`,
`getSubmissionsCsv`, the field-mapping in `create`/`update` all route through it); `FormSubmissionService` has its
own separate `formRepo.findOne` calls (`getForMember`, `getForPublic`, `submitAsMember`/`submitAsPublic`/
`submitAsAdmin`, `updateSubmission`, `getMySubmission`) and needed the same fix independently, since none of them
share `getById`.

**Field description:** each `FormField` has its own optional `description` (text, nullable) — helper text shown
under that field's label while filling out the form (e.g. "Enter your legal name as it appears on your ID"),
distinct from `Form.description`, which introduces the form as a whole. Returned on every field DTO (create/update
request, and the public/member-facing `PublicFormFieldDto`) with no visibility restriction — unlike `optionMetadata`,
there's nothing to hide here before submission.

**Auto-fill:** a field can carry an `autoFillKey` (`FIRST_NAME`/`LAST_NAME`/`EMAIL`/`PHONE_NUMBER`) — the
member-facing "get form for filling" endpoint resolves these against the logged-in member's own profile and
returns them as `suggestedValues` alongside the field definitions, so the frontend can pre-fill without needing its
own copy of the mapping logic. Never applies to public/anonymous fills — there's no member to infer from.

**Online first-timer intake (`Form.createsFirstTimers`):** a `PUBLIC` form can be flagged so that every submission
to it also creates a `FirstTimer` record (`FollowUpService.createFirstTimerFromPublicForm`) — the online-intake
counterpart to a walk-in visitor being registered by a Follow-Up worker. The same `autoFillKey` mechanism doubles
as the field-mapping: `FormSubmissionService` reads the submitted answers back out via whichever fields carry
`FIRST_NAME`/`LAST_NAME`/`PHONE_NUMBER`/`EMAIL`. Enforced at create/update time (`FormService.assertValidFirstTimerConfig`):
the form must be `PUBLIC`, and each of `FIRST_NAME`/`LAST_NAME`/`PHONE_NUMBER` must be mapped to a field that is
itself `required: true` — not just present — since `CreateFirstTimerDto`'s own class-validator decorators never
run against a service-constructed object, so this is the only real guard against an empty name/phone reaching
`FirstTimer`. The resulting `FirstTimer.source` is always forced to `ONLINE` regardless of whatever the form's own
fields submit, and it's created with no actor (`memberCreatorId`/`adminCreatorId` both unset) — same round-robin
Follow-Up-worker assignment and task-creation path as every other first-timer registration route. This side effect
is fault-tolerant: a failure (e.g. no active Follow-Up worker configured yet) is logged but never blocks the
submission itself from saving — an anonymous visitor filling this in from a QR code never sees an error. The
intended distribution path is a QR code linking to the form's public URL, printed/displayed for walk-up scanning
or shown during a livestream (generated client-side in discuva-admin — no backend endpoint involved).

**Submissions are keyed by field id inside a `jsonb` blob** (`FormSubmission.answers: Record<fieldId, value>`),
not a normalized per-answer table — editing or removing a field later never requires migrating past submissions; a
removed field just leaves a harmless orphaned key behind in old submissions' JSON, still readable/exportable.

**Admin notification on submission (`Form.notifyOnSubmission`, default `false`):** a per-form opt-in — when on,
`FormSubmissionService.notifyAdmins` emails every active `Admin` whose `adminRole.permissions` includes
`FORMS_WRITE` (`form-submission-new` template) after a successful save, fire-and-forget (a failure here is logged,
never surfaces to the submitter). Gated by **both** this per-form flag **and** the tenant-wide
`EmailCategory.FORM_SUBMISSION` toggle (§10's `EMAIL_FORM_SUBMISSION_ENABLED` platform kill switch, and the
per-church override under Notification Settings → Automated Emails) — the same defense-in-depth every other
`EmailCategory` already has. Only fires from `submitAsMember`/`submitAsPublic`; `submitAsAdmin` never notifies,
since an admin recording something on someone's behalf doesn't need to be told about it.

**Per-option link + description, an always-shown general action, and dynamic post-submission "next steps":** a
`DROPDOWN`/`CHECKBOX` field's `options` can each carry `optionMetadata: Record<option, { url?, description? }>` —
e.g. a "Department" dropdown where each department option has its own WhatsApp group link and one-line
description. A form separately designates one `DROPDOWN` field (`Form.nextStepsField`, `nextStepsFieldId` on
create/update — CHECKBOX is rejected here, since its multi-select answers don't map to "one selected option's
metadata") and every submit endpoint now returns `{ submissionId, nextSteps: { message, generalAction,
selectedOption } }` instead of the raw `FormSubmission` row: `message` is the form's own `postSubmitMessage` (or
`null`); `generalAction` — `{ label, url } | null` — is the form's own `generalActionUrl`/`generalActionLabel`
(`FormService.assertValidGeneralAction`: both must be set together, or both left empty, and the URL must parse),
an always-shown second call-to-action independent of what was answered (e.g. "Join the Main Volunteer Group",
same for every submitter); `selectedOption` — `{ value, url, description }` — is resolved from whichever option
the visitor actually picked, or `null` if no `nextStepsField` is configured. These two links are independent and
both optional — a form can have either, both, or neither. **Only the chosen option's metadata is ever returned**
— the public `GET /forms/public/:id` (and the member-facing equivalents) strip `optionMetadata` from every field
entirely, so no other department's link is ever visible before that option is submitted, and `generalActionUrl`/
`generalActionLabel` are likewise omitted from that response — both call-to-actions only ever appear on the
post-submission response, never before. Validated at create/update (`FormService.assertValidOptionMetadata`):
every `optionMetadata` key must be one of that field's own `options`, and any `url` must parse as a real URL.

**Ranked conditional overrides for the post-submission message/action (`Form.postSubmitOutcomes`, nullable jsonb
array):** each entry is `{ conditions: [{ fieldId, operator, value }, ...], message, hideMessage, actionUrl,
actionLabel, hideAction }` — `conditions` reuses `FormField.visibilityRule`'s exact same shape/operator set
(`equals`/`notEquals`/`includes`), just as an array instead of a single condition, ALL of which must match (AND)
for that outcome to apply. `FormSubmissionService.resolvePostSubmitContent` evaluates `postSubmitOutcomes` in
array order at submit time against the just-submitted answers — the **first** outcome whose conditions all match
wins. Resolution is **per-field, not a paired all-or-nothing swap**, and the message and the `actionUrl`/
`actionLabel` pair are each an independent **three-way** choice on the winning outcome:
- `hideMessage`/`hideAction` `true` → show none of that piece for this response, even though the form has a
  static `postSubmitMessage`/`generalActionUrl`+`generalActionLabel` default. `normalizePostSubmitOutcomes` forces
  `message`/`actionUrl`/`actionLabel` to `null` whenever their own hide flag is `true`, so there's never an
  ambiguous "hidden but a value is also set" state in storage — `resolvePostSubmitContent` never even reads those
  fields when the hide flag is set.
- hide flag `false` and the value is `null` → inherit the form's own static default, independently per piece — so
  one rule can override just the button while leaving the default message alone, or vice versa.
- hide flag `false` and the value is set → use that custom value.

No match (or no outcomes configured) falls back to the static fields unchanged, so an older form with none
behaves exactly as before, and a form created before this three-way choice existed (both hide flags absent) reads
as `false` for both — identical to its old inherit-on-null-only behaviour. Condition evaluation is shared with
`isFieldVisible` via a new `evaluateCondition` helper rather than duplicated. Deliberately independent of
`nextStepsField`/`optionMetadata`'s per-selected-option `selectedOption` link (see above), which still resolves
and is returned alongside whatever `postSubmitOutcomes` produces — the two mechanisms answer different questions
("what does the option they picked lead to" vs. "does this whole submission, considered together, warrant a
different message/action") and compose rather than conflict.

Validated at create/update (`FormService.assertValidPostSubmitOutcomes`): every condition's `fieldId` must reference
a field already present among the incoming `fields` — the same real-world constraint `visibilityRule` has, since no
field has an id yet on `create()`, outcomes are edit-only in practice — and each outcome's own `actionUrl`/
`actionLabel` reuse `assertValidGeneralAction`'s pairing check (both set or both empty), **skipped entirely when
`hideAction` is `true`** (the pair is forced to `null` regardless, so there's nothing meaningful to pair-check, and
a stray value the client didn't clear shouldn't block the save). On `update`, validated against `dto.fields` when
the request touches fields (so a field this same request is about to delete can't be referenced) or the form's
current `fields` otherwise. `CloneFormDto` has no override for `postSubmitOutcomes` — like `visibilityRule`, every
condition's `fieldId` points at a source field id that won't exist post-clone, so there's no sensible value an admin
could supply before the clone's own fields exist. Instead `cloneForm` always inherits and re-matches it from the
source by label (`FormService.remapClonedPostSubmitOutcomes`, the same by-label technique `remapClonedVisibilityRules`
uses, carrying `hideMessage`/`hideAction` through unchanged via its object spread) — if even one condition inside an
outcome can't be re-matched, the **whole** outcome is dropped rather than left partially broken (an outcome needs
every one of its conditions to mean anything), mirroring `remapClonedVisibilityRules`'s own "drop rather than leave
dangling" stance.

**Duplicate-submission prevention:** a form can designate one field (`Form.dedupField`, `dedupFieldId` on
create/update — DROPDOWN/CHECKBOX excluded as poor dedup keys) whose submitted value must be unique per form. On
submit, that field's value is normalized (phone-normalized if it's a `PHONE` field, else trimmed+lowercased) into
`FormSubmission.dedupValueNormalized`, enforced by a **DB-level partial unique index**
(`(form_id, dedup_value_normalized) WHERE dedup_value_normalized IS NOT NULL`) — not just an application check, so
two near-simultaneous duplicate submissions can't both slip through a race. A unique-constraint violation
(`err.code === '23505'`, same pattern as `SmallGroupService`) is translated into a friendly `BadRequestException`
carrying a structured `code: 'DUPLICATE_SUBMISSION'` alongside its message (same "extra keys spread into the
response body" convention as `PlanGuard`'s `PLAN_UPGRADE_REQUIRED` — see `http-exception.filter.ts`), so the fill
page can render a distinct "you're already registered" screen instead of routing it through a generic error
banner, rather than just matching a display string.

**Phone normalization** (`src/utility/decorators/normalize-phone.decorator.ts`, `normalizePhoneNumber`, backed by
`libphonenumber-js` — this platform is multi-tenant/multi-country, not Nigeria-only, so hand-rolled Nigeria-shaped
regex would incorrectly reject or mangle any other country's number): every `PHONE`-type field's submitted value is
parsed and normalized to E.164 before it's persisted. A number already carrying its own country code (a leading
`+`, or a bare international dialing code) parses correctly for *any* country regardless of the tenant's own
default — e.g. a Nigerian church's diaspora member submitting a UK number still normalizes correctly. A
LOCAL-format number with no country code (e.g. a bare `0801234567`) is interpreted against `defaultPhoneRegion`,
derived once per `FormSubmissionService` instance from the `CURRENCY_LOCALE` env var's region subtag (`en-NG` →
`NG`) — the same per-deployment default already used for currency/date formatting elsewhere (`TitheService`,
`PdfService`, `EventReminderService`), not a Nigeria-specific hardcode. Anything that doesn't parse as valid for
its (explicit or assumed) country returns `null` (a *required* PHONE field that fails to normalize is rejected
with a 400 — never silently mangled or dropped). The normalized value is what's actually stored in `answers`, so
exports, analytics, and dedup all ever see one canonical shape for the same real number. This is the first
phone-normalization logic anywhere in the codebase — `Member.phoneNumber` still stores whatever raw string was
typed, unaffected by this.

**Form branding — cover image and logo:** `Form.coverImageUrl`/`coverImagePublicId` and `Form.logoUrl`/
`logoPublicId` (mirrors `Tenant.logoUrl`/`logoPublicId`'s shape) are set via dedicated upload endpoints (see table
below), Cloudinary-backed (`CloudinaryService.uploadBuffer`, folders `form-covers`/`form-logos`) with the same
"delete the previous asset only after the new one is safely saved" ordering used by `TenantInfoController`'s own
logo upload. Both are optional and independent of the tenant's own logo — the public fill page renders a form's
own logo in place of the generic tenant logo when set, and falls back to the tenant logo otherwise; a cover image
renders as a banner above the form title when set, with no fallback (most forms have none).

**Audience restriction via Contact List:** a `MEMBERS`-visibility form can be restricted to members of one `Group`
("Contact List" in the admin UI) — `Form.audienceGroup`/`audienceGroupId`. `audienceGroupId` is rejected outright
on a `PUBLIC`/`ADMIN_ONLY` form (`FormService.assertValidAudienceGroup`) — there's no member identity to check
against there. When set, `GET /forms/member` filters it out of the list for anyone not in that group (an `EXISTS`
subquery against `group_members`, mirroring `AnnouncementService.getForMember`'s own group-membership check), and
`GET /forms/member/:id` / `POST /forms/member/:id/submit` 404 for an outside member exactly as if the form didn't
exist — no distinct "you're not allowed" response that would leak the form's existence. `audienceGroupId: null`
(explicit) clears the restriction; omitting it on a `PATCH` leaves the current value untouched. This deliberately
reuses the existing Group/Contact-List feature rather than introducing a parallel "specific list" concept — e.g. a
church restricting a form to department heads first builds a "HODs" Contact List, then points the form at it.

**Field diff-sync on update:** `PATCH /forms/:id`'s `fields` array is diffed against the form's existing fields —
an incoming field with an `id` updates that row in place (keeping the id stable so existing submissions' answer
keys stay meaningful), one without an `id` is a new field, and an existing row missing from the incoming array is
deleted. Omitting `fields` entirely from the PATCH body leaves them untouched.

**Cloning (`POST /forms/:id/clone`, `FormService.cloneForm`):** modeled on `PrayerConfigService.cloneProgram` —
`title` is the only required field on `CloneFormDto`; every other scalar follows an "omitted = inherited from the
source, explicit `null` = cleared, value = override" convention (same as `UpdateFormDto`'s nullable fields). The
clone always starts `isActive: false` (an admin reviews it before it goes live) and with no cover/logo — the two
Forms would otherwise share a Cloudinary `publicId`, so removing the clone's cover would delete the original's.
`fields` themselves are **not** part of the DTO: they're always deep-copied from the source verbatim, each getting
a fresh id — a clone's fields are edited afterwards via the normal `PATCH`, not at clone time. `dedupField`/
`nextStepsField` are re-matched by **label** against the freshly-cloned fields (the only stable key once ids are
gone), the same `.update()`-not-`.save()` two-phase approach `applyCrossFieldRefs` already uses. `FormSubmission`s
are never cloned.

**Answer validation happens server-side against the form's actual field definitions**, not via a fixed DTO shape
(`SubmitFormDto.answers` is just `Record<string, unknown>` — the schema is per-form, not knowable at compile time):
required fields must be present and non-empty, `DROPDOWN`/`CHECKBOX` values must be one of the field's
configured `options`, and `EMAIL`/`NUMBER`/`DATE` fields are format-checked (`isValidEmail`/`isValidNumber`/
`isValidDateString`, `src/utility/decorators/form-answer-validators.ts` — thin wrappers around class-validator's
`isEmail`/`isNumberString`/`isDateString`). Format checks are validate-only: unlike `PHONE`'s
`normalizePhoneNumber`, the stored answer is never rewritten — a `NUMBER` answer stays whatever numeric string was
submitted, so CSV export/analytics' existing string-tolerant handling of answers is unaffected. An empty optional
field skips both the options and format checks, same as it always has.

**Bound constraints (`minValue`/`maxValue`, `minLength`/`maxLength`, `minSelections`/`maxSelections`, all nullable
on `FormField`):** each pair only applies to its matching `fieldType` — `minValue`/`maxValue` to `NUMBER`,
`minLength`/`maxLength` to `TEXT`/`TEXTAREA`, `minSelections`/`maxSelections` to `CHECKBOX` — enforced at
create/update time by `FormService.assertValidFieldConstraints` (rejects a bound set on the wrong `fieldType`
outright, and `max < min` when both are set on the same field) — this check treats an explicit `null` the same as
omitted (`== null`, not `=== undefined`): the admin field editor sends an explicit `null` for every bound that
doesn't apply to whatever `fieldType` a field is switched to (e.g. picking PHONE clears `minValue`/`maxValue`), and
since a form's `fields` array is always saved as a full replace rather than a per-property patch, "omitted" and
"explicitly cleared" mean the same thing here — unlike the top-level `Form` scalars in `update()`, which do
distinguish the two. `FormSubmissionService.validateAnswers` re-checks
the bound at submit time (`validateFieldBounds`, after `validateFieldFormat` so a malformed `NUMBER` answer is
already rejected before its value bound is even checked) — a `null` bound means unbounded on that side, and an
empty optional field skips bound checks the same way it skips every other check. `PublicFormFieldDto` carries all
six through unchanged for the fill UI's own native-input hinting (`min`/`max`/`minLength`/`maxLength` HTML
attributes; `minSelections`/`maxSelections` has no native HTML equivalent, shown as helper text instead) — that
client-side hinting is convenience only, not the real enforcement.

**Custom pattern validation (`FormField.validationRegex`/`validationMessage`, both nullable strings):** TEXT/
TEXTAREA only — a submitted answer must match `new RegExp(validationRegex).test(value)`
(`FormSubmissionService.validateFieldPattern`, run after `validateFieldFormat`/`validateFieldBounds` in
`validateAnswers`), rejected with `validationMessage` if set, else a generic `"<label>" is not in the required
format`. `FormService.assertValidFieldPattern` (called from both `create`/`update`, alongside
`assertValidFieldConstraints`) rejects a pattern set on the wrong `fieldType` outright, and rejects a
syntactically invalid regex (`new RegExp()` throwing) as a `400` at save time rather than only surfacing the
first time someone submits against it. Both fields are capped at 200 characters at the DTO level
(`@MaxLength(200)`) — defense-in-depth against a pathological catastrophic-backtracking pattern; the value is
admin-authored (`AdminGuard` + `FORMS_WRITE`), not visitor input, but the cap costs nothing and narrows the blast
radius regardless. `PublicFormFieldDto` carries both through for the fill UI's own hinting: the native HTML
`pattern`/`title` attributes only apply to `<input type="text">` (not `<textarea>`, not `type="email"`/`"tel"`/
`"number"`/`"date"`), so `TEXT` gets the real browser-native attributes and `TEXTAREA` falls back to a plain
helper-text hint — both convenience only, not the real enforcement. The admin field builder shows a live
client-side regex-syntax check (red border + inline warning) purely as authoring feedback; the server re-checks
syntax independently at save time regardless.

**Multi-page forms (`FormField.pageIndex`, smallint, default `0`):** a plain grouping key, not a first-class
`FormPage` entity — every field defaults to page 0, so an older form (or one that never opts into pagination)
renders and submits exactly as before. Grouping/rendering is entirely a member-frontend concern
(`components/forms/paginated-form-fill-fields.tsx`'s `PaginatedFormFillFields`, wrapping `FormFillFields` per
page rather than replacing it — used by both the member and public fill pages): page count is derived from
`Math.max(...fields.map(f => f.pageIndex))`, `Back`/`Next` navigate between pages, and a `Next` click does a
client-side required-field check on the *current* page only (mirrors `validateAnswers`' own `isEmpty` check, but
is convenience-only — a page not yet visited is unmounted, so it never gets native HTML5 validation at all).
There is deliberately **no backend pagination logic and no draft/partial-save**: a submission is still one atomic
final `POST` of every page's answers together, same as a single-page form always was — an abandoned mid-form
visitor simply never submits. `PublicFormFieldDto` carries `pageIndex` through unchanged for the fill UI's own
grouping. The admin field builder (`field-editor.tsx`) gets a numeric "Page" input per field (1-based in the UI,
0-based in `pageIndex`) and visually groups the field list by page once a form actually uses more than one —
each page section is independently collapsible; a new field added via "Add Field" continues on whichever page
was last in use rather than always resetting to page 1.

**Conditional/branching logic (`FormField.visibilityRule`, nullable jsonb — `{ fieldId, operator, value }`,
`operator` one of `equals`/`notEquals`/`includes`):** one rule concept, lives on `FormField` only — there's no
separate page-level rule; a page effectively disappears when every one of its fields is hidden by its own rule,
evaluated by the same function on both the admin builder and the fill renderer. Deliberately a **plain jsonb
column, not a `@ManyToOne` relation** — unlike `dedupField`/`nextStepsField`, this never enters TypeORM's
topological sorter at all (a jsonb column carries no relation semantics for it to see), so it sidesteps the
`Form.fields` cyclic-dependency class of bug entirely rather than needing that pair's `.update()`-not-`.save()`
workaround — set directly in the same `fieldRepo.create()`/`fieldRepo.save()` call as every other field property.
`fieldId` must reference another field on the *same* form that **already has an id** — the same constraint
`dedupFieldId`/`nextStepsFieldId` have in practice, since the admin picker only ever offers existing fields
(`FormService.assertValidVisibilityRules`, called from both `create`/`update`; rejects a self-reference too). A
direct consequence: **a rule can never be set at `create` time** (no field has an id yet at that point) — same
real-world constraint as dedup/next-steps, which are also edit-only in the admin UI. `cloneForm` re-matches each
rule's `fieldId` to the freshly-cloned target by label (`remapClonedVisibilityRules`, the same by-label technique
`applyCrossFieldRefs` uses) — a rule whose target somehow didn't survive the clone is silently dropped rather
than left dangling.

When the trigger field has a fixed option set (`DROPDOWN`/`CHECKBOX`), `assertValidVisibilityRules` also rejects a
`value` that isn't one of that field's own `options` — a value that can never match anything a visitor actually
submits would otherwise fail silently (the rule just never fires, with no error anywhere to explain why). The
admin field builder avoids this case by construction: once a trigger with options is selected, the condition's
`value` input becomes a `<select>` of that field's own options instead of free text, so a typo or case mismatch
can't be typed in the first place — this validation is the server-side backstop for anyone calling the API
directly.

`FormSubmissionService.isFieldVisible` evaluates a rule against the submitted (or, client-side, in-progress)
answers: `equals`/`notEquals` compare a scalar answer as a string (an array/object answer — CHECKBOX/FILE — is
never treated as "equal" to a typed value, rather than falling back to a meaningless `Object`-stringified
comparison); `includes` array-contains for a CHECKBOX target or substring-matches for free text. `validateAnswers`
calls this **before** a field's `required` check and skips every other check too when hidden — a
conditionally-hidden field never blocks submission and its leftover value (if any) is never validated, regardless
of what the client happened to render. No cycle detection anywhere: each field's visibility is evaluated
independently against the answers, never against another field's own computed visibility, so a rule chain (or an
accidental cycle) can't recurse.

**A hidden field's leftover value is stripped before it's ever persisted**, not just exempted from validation
(`FormSubmissionService.stripHiddenAnswers`, run after `validateAnswers` succeeds so validation itself keeps seeing
every raw submitted value — only what actually gets saved is affected). The fill UIs only stop *rendering* a field
once a prior answer hides it; they never clear that field's own local edit state, so a value typed before the
field went hidden is still present in the submit payload. Left in the saved record, that stale answer would
silently pollute CSV export and `FormService.getAnalytics` with a response the submitter never actually confirmed
seeing. Applied on `submitAsMember`/`submitAsPublic`/`updateSubmission` — **deliberately not** on `submitAsAdmin`,
since the admin's own record-entry UI shows every field unconditionally regardless of `visibilityRule`, so any
answer reaching that path was something an admin actually saw and typed, never a stale leftover. Every field's
hidden/visible determination is evaluated against the same fixed pre-strip snapshot regardless of which order
fields happen to be stripped in, so one field being hidden can never change another field's own visibility result.
A FILE field's now-unclaimed upload (hidden, so its `{url, publicId}` answer is stripped rather than saved) is
picked up by the normal 48h orphan sweep like any other abandoned upload, rather than being treated as claimed.

On the member/public fill side, `form-fill-fields.tsx` exports the identical evaluation logic
(`isFieldVisible`, duplicated rather than shared across the repo boundary) and filters fields live on every
render; `PaginatedFormFillFields` uses the same function to skip a page with zero currently-visible fields during
Back/Next navigation and on initial mount — but doesn't re-scan the *current* page reactively while the visitor
is sitting on it (changing an earlier answer that would hide the current page doesn't yank them off it
mid-view), and structural page count (progress bar, single-vs-multi-page chrome) is fixed at mount rather than
recomputed as pages become runtime-hidden. The admin field builder's "Show this field only if…" control
(`field-editor.tsx`) lives in each field's own state, reusing the exact `fields.filter((f) => f.id && ...)`
pattern the dedup/next-steps pickers already use; deleting a field client-side also proactively clears any other
field's `visibilityRule` pointing at it, rather than letting the save round-trip fail with an "unknown field"
error.

**Submitter response editing (`Form.editableAfterSubmit`, boolean, default `true`):** member-only — a public/
anonymous submission carries no member identity to look one back up by, and there's no login for an anonymous
visitor to come back through anyway, so the edit surface is unreachable for `submitAsPublic` regardless of this
flag. `GET /forms/member/:id/submission` (`FormSubmissionService.getMySubmission`) powers the member fill page's
"you already submitted — edit it?" flow, reached from the `DUPLICATE_SUBMISSION` error `submit` already throws: it
returns the caller's most recent submission for that form (`{ submissionId, answers, editable }`, most recent wins
when more than one exists — only possible when the form has no `dedupField`) via a composite `(form_id, member_id)`
index (`IDX_form_submissions_form_id_member_id`, since the base migration only ever indexed those columns
separately) with `editable` mirroring
`Form.editableAfterSubmit`, so the frontend can show a read-only "no longer editable" message instead of an edit
link without a second round trip. `PATCH /forms/member/submissions/:submissionId` (`updateSubmission`) re-runs the
exact same `normalizeAnswers`/`validateAnswers` pipeline a fresh submit does — 4a's bounds and 4c's
visibility-aware required-skipping both apply — but never calls `notifyAdmins` (an edit isn't a new-submission
event), and only recomputes/rewrites `dedupValueNormalized` when the dedup field's value actually changed. A `23505`
conflict on save (the edited value collides with a *different* submission's dedup value) is reported the same
`DUPLICATE_SUBMISSION` way a fresh submit's own conflict is. Ownership is resolved entirely from the submission
record itself (`submission.member.id === callerId`) rather than trusting anything from the URL beyond the
submission id, matching how every other check in this module resolves from the form/member tokens. Both endpoints
additionally 404 on an `ADMIN_ONLY` form even when the caller happens to be the `memberId` attached to one of its
submissions (e.g. a baptism record an admin filed on the member's behalf via `submitAsAdmin`'s optional `memberId`)
— those forms have no member-facing fill surface at all, and a subject shouldn't be able to fetch or edit that
record just because they're linked to it. A known, accepted limitation: editing a `FILE` answer to replace it does
not clean up the *old* file from Cloudinary — its `FormFieldAttachment` tracking row was already deleted at the
original submit time, and no `resourceType` is available at edit time to delete it correctly; judged too narrow an
edge case to justify redundantly storing `resourceType` in the answer shape or a fragile Cloudinary lookup.

**`FILE` fields (upload-then-reference):** the three submit endpoints stay pure JSON — a file is uploaded first, to
its own `POST .../fields/:fieldId/attachment` endpoint (member/public/admin variants, each gated by the same
visibility/audience-group rules as that audience's own submit path, via `FormSubmissionService.uploadAttachment`),
which uploads to Cloudinary (`form-submissions` folder) and returns `{ url, publicId }`. That object becomes the
FILE field's answer in the normal submit call; `validateAnswers` checks only that it's a well-formed `{url,
publicId}` shape, not a format like `EMAIL`/`NUMBER`/`DATE`. Each upload also writes a `FormFieldAttachment`
tracking row (`formId`, `fieldId`, `publicId`, `url`, `resourceType`) — pure bookkeeping, not a real relation to
`Form`/`FormField` (plain UUID columns, deliberately no `@ManyToOne`, to avoid resurrecting the Form/FormField
cyclic-dependency issue documented on `Form.fields` for no benefit). On a successful submission,
`saveSubmission` deletes the tracking row for every FILE answer actually referenced (awaited, not fire-and-forget,
since a silent failure here would let the row survive to the sweep below and delete a file a real submission still
relies on). `FormAttachmentCleanupScheduler` (same `forEachActiveTenant` shape as `SocialMediaRetentionScheduler`)
sweeps nightly (`0 4 * * *`) for tracking rows older than 48h — a row's mere continued existence past that window
**is** the signal the upload was abandoned, since a claimed one is deleted immediately — and deletes both the row
and the Cloudinary asset. Upload size is capped by the new `MAX_FORM_ATTACHMENT_UPLOAD_MB` platform setting
(`DynamicLimitedFileInterceptor`, same convention as cover/logo/class-material/finance-proof uploads).

| Method | Route | Auth | Notes |
|--------|-------|------|-------|
| GET    | `/forms/audience-groups/lookup`     | AdminGuard (FORMS_WRITE) | `{id, name}[]` of every Contact List, for the audience-restriction picker. Own route + gate rather than reusing `GET /groups/lookup` (gated on `ANNOUNCEMENTS_WRITE`) — a forms admin shouldn't need a second, unrelated permission grant |
| POST   | `/forms`                            | AdminGuard (FORMS_WRITE) | Create a form with its fields in one call |
| GET    | `/forms`                            | AdminGuard (FORMS_READ)  | List all forms — unpaginated, same policy as departments/event-configs |
| GET    | `/forms/:id`                        | AdminGuard (FORMS_READ)  | Get one form with fields |
| PATCH  | `/forms/:id`                        | AdminGuard (FORMS_WRITE) | Update form + diff-sync fields (see above). `audienceGroupId`/`dedupFieldId`/`nextStepsFieldId`/`postSubmitMessage`/`generalActionUrl`/`generalActionLabel` all follow the same "explicit `null` clears, omit to leave untouched" convention as `eventId`. `postSubmitOutcomes` follows it too, but replaces the whole array wholesale rather than diff-syncing per-outcome (see Ranked conditional overrides, above) |
| DELETE | `/forms/:id`                        | AdminGuard (FORMS_WRITE) | Cascades fields + submissions |
| POST   | `/forms/:id/clone`                  | AdminGuard (FORMS_WRITE) | Clone a form — `{ title, ... }` (see `CloneFormDto`; `title` is the only required field). Clone starts `isActive: false` with no cover/logo, fields copied verbatim with fresh ids, `dedupField`/`nextStepsField` re-matched by label. Never clones submissions |
| POST   | `/forms/:id/cover`                  | AdminGuard (FORMS_WRITE) | Multipart, field name `cover`. Sets `Form.coverImageUrl` |
| DELETE | `/forms/:id/cover`                  | AdminGuard (FORMS_WRITE) | Clears the cover image |
| POST   | `/forms/:id/logo`                   | AdminGuard (FORMS_WRITE) | Multipart, field name `logo`. Sets `Form.logoUrl` |
| DELETE | `/forms/:id/logo`                   | AdminGuard (FORMS_WRITE) | Clears the logo |
| POST   | `/forms/:id/submissions`            | AdminGuard (FORMS_WRITE) | Admin records a submission on someone's behalf — `{ answers, memberId? }`. Works against any visibility, not just `ADMIN_ONLY` (e.g. backfilling a `MEMBERS`-visibility form entry for someone who called in). Returns `{ submissionId, nextSteps }`, same shape as the member/public submit endpoints |
| GET    | `/forms/:id/submissions`            | AdminGuard (FORMS_READ)  | Paginated (`?page=&limit=`) — this list is attendance-scale, unlike the forms list itself |
| GET    | `/forms/:id/submissions/export`     | AdminGuard (FORMS_READ)  | CSV, one column per field (ordered), `Submitted By` shows the member's name or "Public". A `FILE` field's cell is the uploaded file's URL |
| GET    | `/forms/:id/analytics`              | AdminGuard (FORMS_READ)  | At-a-glance summary across all submissions, computed per field type (see below) |
| POST   | `/forms/:id/fields/:fieldId/attachment` | AdminGuard (FORMS_WRITE) | Multipart, field name `file`. Same shared upload path as the member/public equivalents below (see FILE fields, further down) — lets an admin attach a file while recording a submission via `POST /forms/:id/submissions` |
| GET    | `/forms/member`                     | JwtAuthGuard             | Forms visible to the caller (`isActive`, `MEMBERS` or `PUBLIC`) — optional `?eventId=` filter. A `MEMBERS` form with an `audienceGroup` is filtered out for anyone outside that Contact List |
| GET    | `/forms/member/:id`                 | JwtAuthGuard             | Form fields + `suggestedValues` auto-filled from the caller's own profile. 404s (not 403) if the form has an `audienceGroup` the caller isn't in |
| POST   | `/forms/member/:id/submit`          | JwtAuthGuard             | `memberId` comes from the token, never the body. Returns `{ submissionId, nextSteps }` |
| GET    | `/forms/member/:id/submission`      | JwtAuthGuard             | The caller's own most recent submission for this form — `{ submissionId, answers, editable }`. Powers the "edit your response" flow off a `DUPLICATE_SUBMISSION` error. 404s on an `ADMIN_ONLY` form even for a linked member |
| PATCH  | `/forms/member/submissions/:submissionId` | JwtAuthGuard        | Edit the caller's own submission — `{ answers }`, same shape as `submit`. `400` if `Form.editableAfterSubmit` is off; `404` if the submission isn't the caller's or the form is `ADMIN_ONLY` |
| POST   | `/forms/member/:id/fields/:fieldId/attachment` | JwtAuthGuard | Multipart, field name `file`, max size `MAX_FORM_ATTACHMENT_UPLOAD_MB`. Returns `{ url, publicId }` — the answer value for a `FILE` field in the `submit` call above. Subject to the same `MEMBERS`/`PUBLIC` visibility + audience-group gating as `submit` |
| GET    | `/forms/public/:id`                 | Public, `404` unless `isActive && visibility === PUBLIC` | No tenant subdomain restriction beyond the usual Host-header resolution. Response is a sanitized `PublicFormDto` — every field's `optionMetadata` is stripped |
| POST   | `/forms/public/:id/submit`          | Public, rate-limited (5/min) | `memberId` is always `null` — an open, unauthenticated write endpoint, throttled from day one rather than retrofitted. Returns `{ submissionId, nextSteps }` |
| POST   | `/forms/public/:id/fields/:fieldId/attachment` | Public, rate-limited (5/min) | Multipart, field name `file`. Same upload-then-reference contract as the member endpoint, no member identity involved |

`forms` is a toggleable module (`KNOWN_MODULES`, `ModuleEnabledGuard`) *and* Pro-plan-gated
(`@RequiresPlan(PlanFeature.FORMS)`, `PlanGuard`) on all three controllers, including the public one — `PlanGuard`
keys off the tenant resolved by `TenantMiddleware`, not the caller's auth, so an unauthenticated visitor filling out
a public form on a Free-tier tenant is still correctly blocked. Both gates are independent: a Pro tenant can still
disable Forms via the module toggle, and a Free tenant sees `403 PLAN_UPGRADE_REQUIRED` regardless of the module
toggle's state.

**Analytics** (`GET /forms/:id/analytics`, a Google-Forms-style summary, not raw rows): computed in-memory per
field from every submission's `answers[fieldId]`, shaped by that field's type — `DROPDOWN`/`CHECKBOX` get a
per-option `{count, percentage}` breakdown (`CHECKBOX` counts every selected value, since one submission can pick
several options); `NUMBER` gets `{average, min, max}`; `FILE` gets `{uploadCount}` (same number as
`responseCount` — a `{url, publicId}` answer isn't a meaningful "sample" the way free text is); every other type
(`TEXT`, `EMAIL`, `PHONE`, `TEXTAREA`, `DATE`) gets up to the 20 most recent non-blank answers as `sampleAnswers`,
since there's no meaningful aggregate for free text. Blank/null/undefined answers are excluded from
`responseCount` and every computation — a field added after some submissions already exist doesn't drag its
stats toward zero.

### Pages (`src/pages/`)

Per-church public web pages — a homepage or a shareable landing page (e.g. a conference page), assembled from a
fixed library of section types rather than a free-form drag-and-drop canvas, mirroring the Forms builder's own
"admin assembles typed, ordered items" shape. A `Page` has a unique-per-tenant `slug` (url-safe, `^[a-z0-9-]+$`),
a `title`, an `isPublished` flag (only a published page is ever reachable publicly — an unpublished draft 404s
identically to an unknown slug, so a visitor can never distinguish "never existed" from "not live yet"), optional
`seoDescription`/`ogImageUrl` for link-preview metadata, and an ordered `sections: PageSection[]` (`{ id, type,
content }`, plain `jsonb`, whole-array replace on every save — same convention `Form.postSubmitOutcomes` uses,
since there's no per-section DB row to diff against). `id` is client-generated (a uuid), not server-assigned —
sections have no relation of their own for TypeORM to assign an id to.

**Section toolkit (`PageSectionType`, 8 fixed types)** — `content`'s shape depends on `type`:

| Type | Content shape |
|---|---|
| `HERO` | `title, subtitle?, dateRangeText?, backgroundImageUrl?, ctaLabel?, ctaUrl?` (`ctaLabel`/`ctaUrl` paired — both or neither) |
| `ABOUT` | `heading, body, imageUrl?` |
| `STATS` | `items: { label, value }[]` (≥1) |
| `SPEAKERS` | `heading?, items: { name, title?, photoUrl? }[]` (≥1) |
| `SCHEDULE` | `heading?, days: { label, entries: { time?, title }[] }[]` (≥1 day, each with ≥1 entry) |
| `REGISTRATION` | `heading?, body?, formId, ctaLabel?` — embeds an existing `Form` inline (rendered client-side via the same `FormFillFields`/`PaginatedFormFillFields` components a form's own public fill page already uses) rather than reimplementing registration. Reuses the whole Forms feature (validation, dedup, notifications, `postSubmitOutcomes`) for free |
| `TESTIMONIALS` | `heading?, items: { quote, name?, photoUrl? }[]` (≥1) |
| `FAQ` | `heading?, items: { question, answer }[]` (≥1) |

**Validation is envelope-only at the DTO layer** (`PageSectionDto`: `id`/`type`/`content` as a plain object) —
per-type structural validation happens in `PageService.assertValidSections`, a `switch (section.type)` checking
each type's required fields, the same "jsonb content a decorator alone can't cross-check" pattern
`FormService.assertValidOptionMetadata`/`assertValidPostSubmitOutcomes` already use, rather than a
class-transformer discriminated union (deliberately not introduced, to keep this module's validation style
consistent with the rest of the codebase). `REGISTRATION`'s `formId` is the one genuinely cross-referential check
— it must reference a `Form` that actually exists in this tenant (`formRepo.findOneBy`).

**Endpoints — two controllers, not three like Forms** (a Page has no authenticated-member behavior; it's purely
public or admin-managed):
- `PageAdminController` (`AdminGuard` + `PAGES_READ`/`PAGES_WRITE`): full CRUD (`GET/POST /pages`,
  `GET/PATCH/DELETE /pages/:id`), `POST /pages/:id/images` — one generic multipart upload endpoint reused by every
  image slot in every section type (hero background, each speaker photo, gallery), returning `{url, publicId}`
  only, never touching the `Page` row itself (the client embeds the url into whichever section's content it
  belongs to on the next save) — and `POST`/`DELETE /pages/:id/og-image` (mirrors `FormService.setCoverImage`/
  `removeCoverImage`'s "delete the previous Cloudinary asset only after the new one is safely saved" ordering).
  Admin-only image uploads mean the volume of an abandoned upload (started, page edit never saved) is low enough
  that — unlike `FormFieldAttachment`'s visitor-facing uploads — no orphan-cleanup sweep is built for this; an
  accepted v1 tradeoff, not an oversight.
- `PagePublicController` (`@Public()`, no guard): `GET /pages/public/:slug` — published-only, returns the full
  `Page` including every section verbatim. Unlike Forms' `PublicFormDto`, nothing is stripped — every section is
  content the church chose to show publicly, there's no "spoiler" concern the way an unselected `DROPDOWN`
  option's `optionMetadata` has. Not rate-limited (read-only, unlike Forms' public write endpoints).

`pages:read`/`pages:write` are backfilled onto every existing tenant's `SuperAdmin` role by
`GrantPagesPermissions1796194800000` (same class of fix as `GrantFormsPermissions`/`GrantSocialMediaPermissions`
— a brand-new `AdminPermission` is only auto-granted to a `SuperAdmin` role at the moment that role row is
*created*, a one-time `Object.values(AdminPermission)` snapshot, so every tenant provisioned before this module
existed needs the new permission strings appended explicitly). `CreatePagesTable1795849200000` shipped without
this grant migration, which is why the "Pages" sidebar entry (gated behind `pages:read` in discuva-admin's
`NAV_STRUCTURE`) silently never appeared for any pre-existing tenant even though the module itself worked once
reached directly.

**Early-access rollout, controlled by the Pages Rollout control (§Platform Admin — Tenant Management)** — `pages`
is a toggleable module (`KNOWN_MODULES`) not included in any plan's `features` by default (no `@RequiresPlan`/
`PlanGuard` on either controller, unlike Forms), same posture Social Media used before it went GA
(`MakeSocialMediaOverrideOnly1793736000000`'s own comment). `ModuleEnabledGuard`'s own plan-feature resolution
(`PlanFeatureResolverService`) already checks `Tenant.moduleOverrides[moduleKey]` ahead of plan membership either
direction — `true` grants access regardless of plan, `false` blocks it regardless of plan — so a platform admin
grants specific churches under test access from discuva-platform's dedicated Pages page (`GET`/`PUT
/platform/pages/rollout`, the same one-toggle-plus-multi-select mechanism Social Media Rollout uses, see below),
with every other tenant getting a `403` from `isEnabled`'s plan-membership fallback until the rollout is flipped to
"everyone." `PageAdminController.isPlatformEnabled`
(`GET /pages/platform-enabled`) is a lightweight, side-effect-free access ping the discuva-admin frontend reads to
decide whether to render the real builder or a "Coming Soon" panel — reaching the handler at all already proves
access, since `ModuleEnabledGuard` 403s first otherwise. `PagePublicController` carries the same `@RequiresModule`
+ `ModuleEnabledGuard` (no separate plan check needed there either) — a tenant without access could never have
created a page to view publicly anyway. `PageAdminController`'s `GET /pages/:id` is a wildcard route, so
`PagePublicController` is registered first in `PagesModule.controllers` — otherwise it would swallow
`GET /pages/public/:slug`, the same route-ordering issue `FormsModule` already documents.

**No custom-domain resolution, no auto-provisioned homepage.** A page is reachable at
`member.<church-subdomain>.<baseDomain>/p/<slug>` today, resolved the same way `discuva-member`'s existing public
form-fill pages resolve tenant (subdomain read from the `Host` header server-side, or the `X-Tenant-Subdomain`
header client-side — see that app's own tenant-resolution notes). There's no `isHomepage` designation and no
"every tenant gets a default page" provisioning — a church's first page can be a homepage or a conference page,
same feature either way; both are natural fast-follows once this is in active use, not built for v1.

| Method | Route | Auth | Notes |
|--------|-------|------|-------|
| GET    | `/pages/platform-enabled`   | AdminGuard (PAGES_READ)  | `{ enabled: true }` always — the "Coming Soon" gate; reaching this handler at all already proves access (see above) |
| POST   | `/pages`                    | AdminGuard (PAGES_WRITE) | Create a page with its sections in one call |
| GET    | `/pages`                    | AdminGuard (PAGES_READ)  | List all pages — unpaginated, same policy as Forms |
| GET    | `/pages/:id`                | AdminGuard (PAGES_READ)  | Get one page with sections |
| PATCH  | `/pages/:id`                | AdminGuard (PAGES_WRITE) | Update page. `sections` omitted = untouched, an array = replace wholesale (no per-section id to diff against) |
| DELETE | `/pages/:id`                | AdminGuard (PAGES_WRITE) | Delete a page |
| POST   | `/pages/:id/images`         | AdminGuard (PAGES_WRITE) | Multipart, field name `file`, max size `MAX_PAGE_IMAGE_UPLOAD_MB`. Generic upload for any section's image slot — returns `{ url, publicId }` only, doesn't touch the page row |
| POST   | `/pages/:id/og-image`       | AdminGuard (PAGES_WRITE) | Multipart, field name `file`. Sets `Page.ogImageUrl` |
| DELETE | `/pages/:id/og-image`       | AdminGuard (PAGES_WRITE) | Clears the OG image |
| GET    | `/pages/public/:slug`       | Public, `404` unless `isPublished` | Returns the full `PublicPageDto` — every section verbatim, nothing stripped |

### Church Calendar (`src/church-calendar/`)

Admin-configurable, dated programme calendars — the in-app equivalent of the flyer a church already designs each month for social media ("Programs in the month of September, themed REMEMBERED — Special Thanksgiving on the 6th, Holy Communion on the 9th, ..."). A `ChurchCalendar` has a `title`, an optional `theme`, a `startDate`/`endDate` range (a single month, a full year, or anything in between — not a fixed month field), an optional `accentColor` (hex, drives the admin-side exported flyer's gradient bands — there's no tenant-wide brand-color setting to fall back to, so the flyer template falls back to a built-in default when unset), an `isPublished` flag, and an ordered `entries: ChurchCalendarEntry[]` (`{ id, date, time?, title, description?, imageUrl? }`, plain `jsonb`, whole-array replace on save — same convention `Page.sections`/`Form.postSubmitOutcomes` already use, since there's no per-entry DB row to diff against). `id` is client-generated. `time` is an optional 24-hour `HH:mm` string (`@Matches` on the DTO) — an all-day or time-TBD entry simply omits it; adding it required no migration since `entries` is `jsonb`. The admin builder flags (non-blocking — never rejected server-side) two entries sharing the same `date` and `time` as a likely scheduling conflict, since two things legitimately happening at once (e.g. Kids Church and the Main Service) isn't necessarily a mistake.

**Validation** (`ChurchCalendarService`, mirrors `PageService.assertValidSections`'s "structural checks the decorator layer can't express" pattern): `endDate` cannot be before `startDate`; every entry's own `date` must fall inside `[startDate, endDate]`, and every entry needs a non-empty `title`. Entries are sorted by `date` before persisting (on both `create` and any `update` that replaces `entries`) so the admin list and the member view always render in date order regardless of the order entries arrived in the request.

**Two controllers, deliberately on different base paths to avoid a route-ordering hazard** — `PagesModule`'s own public/admin controllers share one base path and depend on registration order in the module's `controllers` array to keep the wildcard `:id` route from swallowing the more specific one; `ChurchCalendarMemberController` sidesteps that entirely by mounting at `church-calendar/member` instead of sharing `church-calendar` with the admin controller's `:id` wildcard.

- `ChurchCalendarAdminController` (`AdminGuard` + `CHURCH_CALENDAR_READ`/`WRITE`, `@RequiresModule('church_calendar')`, **and** `@RequiresPlan(PlanFeature.CHURCH_CALENDAR)` + `PlanGuard` — unlike Pages, Church Calendar is a normal Pro-plan feature, not override-only early access): full CRUD plus `POST /church-calendar/:id/images`, a generic multipart upload reused by every entry's photo slot (mirrors `PageAdminController`'s image endpoint exactly — `{ url, publicId }` only, doesn't touch the calendar row; the caller embeds the url into whichever entry it belongs to on the next save). Same "no orphan-cleanup sweep for an abandoned upload" accepted tradeoff as Pages' section images, for the same reason (admin-only, low volume).
- `ChurchCalendarMemberController` (`JwtAuthGuard`, member+worker, same `@RequiresModule`/`@RequiresPlan`/`PlanGuard` gating): `GET /church-calendar/member/current` — published calendars whose `endDate` hasn't passed yet, ordered by `startDate` ascending (so a shorter "this month" calendar and a longer-running "this year" one can both surface together). "Today" is computed via a new `DateService.today()` method (see below) rather than a bare `new Date()`, so a calendar doesn't disappear a few hours early/late for a church whose timezone differs from the server's.

**Plan/permission plumbing — the same three pieces Pages needed, done proactively this time instead of as a follow-up fix:**
- `AdminPermission.CHURCH_CALENDAR_READ`/`CHURCH_CALENDAR_WRITE`, a new `Church Calendar` permission group.
- `KNOWN_MODULES` key `church_calendar`.
- `PlanFeature.CHURCH_CALENDAR`, added to **all four** Pro plan variants' `features` by `AddChurchCalendarToProPlans1793908800000` — `AddFormsToProPlan` (the precedent) only targeted the bare `pro` row, leaving `pro-annual`/`pro-usd`/`pro-usd-annual` without `forms`; this one covers all four so the feature isn't inconsistently available depending on which Pro variant a tenant happens to be subscribed to.
- `GrantChurchCalendarPermissions1796367600000` backfills `church_calendar:read`/`write` onto every existing tenant's `SuperAdmin` role. This is the exact fix `GrantPagesPermissions` had to ship as a follow-up after the Pages sidebar entry silently never appeared for any pre-existing tenant — done as part of the same PR here instead of after the fact.

New `CloudinaryFolder` member `'church-calendar-images'` and new `PlatformSettingKey.MAX_CHURCH_CALENDAR_IMAGE_UPLOAD_MB` (default 5MB, same shape as `MAX_PAGE_IMAGE_UPLOAD_MB`).

The member app's list-page header is its own `KNOWN_ASSETS` entry (`church-calendar-hero`, `src/tenant/constants/known-assets.constant.ts`), overridable from discuva-admin's Mobile App Appearance page like every other page header. It was initially built reusing the existing `events-hero` key to save a step — fixed once flagged, since that would have meant a church customizing the Events page's header silently changed Church Calendar's too (or vice versa). Each page header gets its own key unless it's one of the few *deliberately* shared ones (e.g. `prayer-hands-bible` across prayer/prayer-requests/evangelism) — reusing one should be a conscious choice, not a shortcut.

**`DateService.today()`** (new): today's date as a plain `'yyyy-MM-dd'` string in the church's configured timezone, for comparing against a `date`-typed column. Added because nothing on `DateService` already did this — `format(new Date(), 'yyyy-MM-dd')` renders using the *server process's* timezone, which can land on the wrong calendar day near midnight for a church whose timezone differs from the server's; `today()` runs `new Date()` through the same `toZonedTime` shift `startOfDay()`/`endOfDay()` already use before formatting, so the date components come out right regardless of what timezone the Node process itself is running in.

| Method | Route | Auth | Notes |
|--------|-------|------|-------|
| POST   | `/church-calendar`                  | AdminGuard (CHURCH_CALENDAR_WRITE) | Create a calendar with its entries in one call |
| GET    | `/church-calendar`                  | AdminGuard (CHURCH_CALENDAR_READ)  | List all calendars — unpaginated, same policy as Pages/Forms |
| GET    | `/church-calendar/:id`               | AdminGuard (CHURCH_CALENDAR_READ)  | Get one calendar with entries |
| PATCH  | `/church-calendar/:id`               | AdminGuard (CHURCH_CALENDAR_WRITE) | Update calendar. `entries` omitted = untouched, an array = replace wholesale |
| DELETE | `/church-calendar/:id`               | AdminGuard (CHURCH_CALENDAR_WRITE) | Delete a calendar |
| POST   | `/church-calendar/:id/images`        | AdminGuard (CHURCH_CALENDAR_WRITE) | Multipart, field name `file`, max size `MAX_CHURCH_CALENDAR_IMAGE_UPLOAD_MB`. Generic upload for any entry's photo slot — returns `{ url, publicId }` only |
| GET    | `/church-calendar/member/current`    | JwtAuthGuard (member+worker)       | Published calendars with `endDate >= today` (church-timezone-aware), ordered `startDate` ascending |

### Social Media Module (`src/social-media/`)

Central, tenant-scoped connector framework for cross-posting to a church's social accounts from one compose box.
All the **shared OAuth/media/scheduling infrastructure** is real and fully wired — platform-level app credentials,
per-tenant encrypted token storage, the connect/callback flow, real multi-file upload, per-placement validation,
retention, and scheduled publishing. **Facebook, Instagram, and YouTube have real publishers**
(`FacebookGraphPublisher`/`InstagramGraphPublisher`, backed by the Meta Graph API; `YouTubePublisher`, backed by
the YouTube Data API v3 — see below for both); `X` and `TIKTOK` still resolve to `NotConnectedPublisher` (or
`PlatformDisabledPublisher` if a platform-admin has switched it off) via `SocialPublisherRegistry`, which always
fails honestly rather than pretending to succeed. `X`'s API dropped its free tier entirely in February 2026
(pay-per-use, ~$0.015–$0.20 per post) — wiring it in is a pricing decision (who absorbs that per-post cost:
Discuva or the church?) as much as an engineering one, not scheduled yet. `TIKTOK`'s Content Posting API restricts
any unaudited app to `SELF_ONLY` (private) visibility until TikTok completes its own audit, so there's nothing
meaningful to test until that's done — also not scheduled yet. Wiring in either is the same shape either way — see
the publisher extension point below; `SocialPostService` and every controller stay unchanged when that lands.

**Entities:**

- `SocialAccount` (`social_accounts`) — `platform` (`SocialPlatform`: `FACEBOOK`/`INSTAGRAM`/`X`/`YOUTUBE`/`TIKTOK`),
  `displayName`, `externalAccountId` (nullable — Page/Channel/user id, resolved during the OAuth exchange),
  `isConnected`, `connectedAt`/`connectedBy`. Also carries the OAuth token itself, all `select: false` so a normal
  `find()` never returns them: `accessTokenEncrypted`, `refreshTokenEncrypted` (nullable — not every platform
  issues one), `tokenExpiresAt`, `scope`. Encrypted via `EncryptionService` (AES-256-GCM), same convention as
  `TenantCommunicationProviderConfig.credentialsEncrypted`.
- `SocialPost` (`social_posts`) — `content`, `status` (`SocialPostStatus`: `DRAFT` → `SCHEDULED`/`PUBLISHING` →
  `PUBLISHED`/`PARTIALLY_PUBLISHED`/`FAILED`), `createdBy` (nullable FK → `admins`, `SET NULL`), `publishedAt`,
  `scheduledFor` (nullable — set only while `SCHEDULED`). No longer has `imageUrl`; see `SocialPostMedia`.
- `SocialPostTarget` (`social_post_targets`) — one row per `(post, account, placement)`, so a single post's
  per-platform *and* per-placement outcome is tracked independently: `status` (`SocialPostTargetStatus`:
  `PENDING`/`SUCCESS`/`FAILED`), `placement` (`SocialPlacement`: `FEED`/`STORY`/`REEL` — Instagram Stories/Reels and
  YouTube Shorts are genuinely different publish surfaces from a feed post, not just a platform distinction; one
  connected account can have multiple targets across placements for the same post), `errorMessage`, `publishedAt`,
  `externalPostId` (nullable — the platform's own id for the published post/video, set from a successful
  `PublishResult`; what a stats fetch or any future "open this on the platform" link looks up). Also carries the
  composer's per-target customization: `contentOverride` (nullable text — `null` means this target still shares
  `SocialPost.content`) and `mediaFocalX`/`mediaFocalY` (nullable numeric, 0-1 — a click-to-crop-focus point, only
  meaningful for `STORY`/`REEL`; both `null` means "let Cloudinary's `g_auto` content-aware cropping choose," not
  "no crop" — see `SocialMediaCropService` below).
- `SocialPostMedia` (`social_post_media`) — real Cloudinary-backed attachments, replacing the old free-text
  `imageUrl`. `url`, `publicId` (needed to delete the actual asset, not just the row), `mimeType`, `sizeBytes`,
  `width`/`height`/`durationSeconds` (nullable, used by `SocialMediaValidationService`), `order`.
- `SocialPlatformApp` (`social_platform_apps`, **public schema**, control-plane) — one row per `SocialPlatform`
  holding Discuva's own OAuth app credentials (`clientId`, `clientSecretEncrypted`, `redirectUri`, `scopes`).
  Unlike email/SMS BYOK, a tenant cannot register their own Meta/Google/X developer app, so this is
  platform-owned, not per-tenant. `isActive` is the platform-admin kill switch — see below.

**OAuth connect + callback flow:**

- `GET /social-media/accounts/:id/authorize-url` (tenant-authenticated, `AdminGuard`) — `SocialOAuthConnectService`
  looks up the account's platform, confirms its `SocialPlatformApp` is registered and active, encodes
  `{accountId, tenantId, nonce, issuedAt}` into a `state` token via `OAuthStateService` (AES-256-GCM encrypt — the
  auth tag makes it tamper-evident, doubling as OAuth's CSRF protection without a separate HMAC/JWT; 10-minute
  expiry), and returns the platform's authorize URL for the frontend to redirect to.
- `GET /v1/integrations/social/:platform/oauth/callback` — `@Public()`, added to `TenantMiddleware`'s exclude list
  (`src/tenant/tenant.module.ts` — **do not remove this without also removing the exclude**, the documented
  failure mode is a silent 404 in production, previously hit for the YouTube WebSub callback). Called directly by
  Meta/Google/X's redirect, which carries no tenant subdomain — `state` is decoded to recover `tenantId`/
  `accountId`, the tenant's `schemaName` is looked up, and the rest runs inside `runInTenantContext(...)` (same
  pattern as the giving-checkout webhook): exchange the code for tokens, encrypt and store them on the matching
  `SocialAccount`, set `isConnected`/`connectedAt`, then redirect the browser back to discuva-admin
  (`ADMIN_LOGIN_URL` + `/social-media?connected=<platform>` or `?error=<reason>`). Never throws past the top level
  — the caller is a browser mid-redirect, not an API client — failures are logged server-side and surfaced to the
  browser as a generic `?error=connection-failed`.

**The publisher extension point** (`publisher/social-platform-publisher.interface.ts`): `SocialPlatformPublisher`
is a one-method interface (`publish(account, post, placement): Promise<{success, error?, externalPostId?}>`),
resolved per `SocialPlatform` by `SocialPublisherRegistry`. `placement` is the specific `SocialPostTarget`'s
placement (`FEED`/`STORY`/`REEL`) — a single account can have multiple targets across placements for the same
post, so this is the only way a publisher knows which one a given call is for; a publisher that doesn't support a
placement `SocialMediaValidationService` allows should fail that call explicitly via `PublishResult.error`, not
silently substitute `FEED`. On every `resolve()` call the registry also checks
`PlatformSocialAppService.isPlatformDisabled(platform)` — if a platform-admin has switched a platform off, it
returns `PlatformDisabledPublisher` (distinct wording from `NotConnectedPublisher`: "temporarily disabled by
Discuva," not "this church hasn't set this up") instead of whatever publisher is registered, without touching any
tenant's already-stored tokens. Wiring in a real platform means implementing this interface plus a matching
`SocialTokenRefresher` (`token/`, for transparent access-token renewal) and `SocialOAuthExchanger` (`oauth/`, for
the authorize-URL/code-exchange mechanics) — `SocialPostService`, the controllers, and `SocialTokenResolverService`
never change.

**Meta (Facebook/Instagram) implementation** (`platform/meta/meta-graph-api.service.ts`) — `MetaGraphApiService`
holds the Graph API mechanics shared by both `FacebookOAuthExchanger`/`InstagramOAuthExchanger` and
`FacebookGraphPublisher`/`InstagramGraphPublisher`, since Instagram Business publishing runs on the same Meta App,
the same Business Login OAuth dialog, and the same Page access token as Facebook — only which node you call (a
Page vs. its linked IG Business Account) differs:
- `resolvePageAccessToken` — code → short-lived user token → long-lived user token (`fb_exchange_token`) → `GET
  /me/accounts` for the Page(s) granted. Exactly one Page is the expected/supported outcome (a church connects one
  Page); zero or multiple both throw a clear, actionable error rather than guessing which one to use. The Page
  token returned this way doesn't expire in practice and Meta issues no `refresh_token` for it — `FacebookOAuthExchanger`
  and `InstagramOAuthExchanger` both omit `expiresInSeconds`/`refreshToken` from their `OAuthExchangeResult`, so
  `tokenExpiresAt` stays `null` and `SocialTokenResolverService` never attempts a refresh (both platforms stay
  registered to `NoRefresherAvailable` — nothing to implement there).
- `getInstagramBusinessAccountId` — one extra call (`GET /{pageId}?fields=instagram_business_account`) is all that
  separates `InstagramOAuthExchanger` from `FacebookOAuthExchanger`; `externalAccountId` ends up being the IG
  Business Account id instead of the Page id, but the stored token is the same Page access token either way.
- `publishToFacebookPage(pageId, pageAccessToken, content, media, placement)` — only `FEED` is implemented; any
  other placement throws immediately, before any request is made (`SocialMediaValidationService`'s constraints
  table only defines `FEED` for Facebook today, so this isn't reachable yet, but the rejection is real, not
  assumed). FEED: text-only → `/feed`; single image → `/photos`; single video → `/videos` (checked in that
  preference order if a post somehow carries both). No multi-image gallery support yet — matches what validation
  actually checks today (`primaryVideo`, not a gallery).
- `publishToInstagram(igUserId, pageAccessToken, content, media, placement)` — always two calls: create a media
  container (`/media`), then `/media_publish`. What differs by `placement` is the container's `media_type`:
  `STORY` → `'STORIES'` (image or video); `FEED`/`REEL` are, as far as this API is concerned, the same call — a
  video posted via the Content Publishing API always processes as a Reel (`media_type: 'REELS'`) even when it also
  appears in the normal feed, and an image needs no `media_type` at all (defaults to `IMAGE`) in either placement.
  Video containers process asynchronously on Meta's side, so a bounded poll (`status_code` via `GET
  /{containerId}`, 3s interval, 20 attempts) waits for `FINISHED` before publishing rather than racing Meta's own
  processing. Stories don't visibly render the `caption` field, but it's passed through anyway rather than
  silently dropping content the admin typed.

Every failure path in both publishers resolves to `{success: false, error}` — never throws. This matters because
`SocialPostService.publish()` calls `publisher.publish()` with no `try`/`catch`; a thrown error there would abort
every remaining target's publish attempt, not just the one platform that failed, breaking the documented "one
platform failing never blocks the others" guarantee.

Not live-tested against a real Meta account from this environment (no outbound network access to
`graph.facebook.com` in the sandbox this was built in) — written correctly against Meta's documented Graph API
contract and covered by unit tests mocking `fetch`, but the first real connect→publish run against an actual
connected Page/Instagram account is the real end-to-end verification.

**YouTube implementation** (`platform/youtube/youtube-api.service.ts`) — `YouTubeApiService` holds the Google
OAuth2 + YouTube Data API v3 mechanics for `YouTubeOAuthExchanger`, `YouTubePublisher`, and (unlike Meta)
`YouTubeTokenRefresher`:
- `buildAuthorizeUrl` sets `access_type=offline` and `prompt=consent` — without both, Google only issues a
  `refresh_token` on a user's very first-ever consent for the app; a later reconnect after revoking access would
  silently come back with no `refresh_token` at all otherwise, and there'd be nothing for `SocialTokenResolverService`
  to renew against once the short-lived `access_token` expires.
- `resolveChannel` mirrors `resolvePageAccessToken`'s "exactly one expected" pattern — a Google account can have
  multiple channels/brand accounts, same as a Facebook user managing multiple Pages; zero or multiple both throw a
  clear, actionable error.
- **No URL-passthrough upload.** Unlike Meta's Graph API (`file_url`/`image_url`, Meta fetches the asset itself),
  the YouTube Data API has no such option — `publishVideo` downloads the attachment from its Cloudinary URL into
  memory, then streams those bytes to Google via the resumable upload protocol (`POST .../videos?uploadType=resumable`
  to start a session and get a `Location` header, then `PUT` the raw bytes to that URL). Loading the full file into
  memory rather than piping the download directly into the upload is a real, deliberate simplification — correct
  and fine at the scale a church's social posts run at (the existing 200MB attachment cap), but worth knowing about
  if that cap ever grows.
- `REEL` gets `"#Shorts"` appended to the description — the documented, best-effort signal for YouTube's Shorts
  shelf, not a guaranteed classification; YouTube's own aspect-ratio/duration heuristics still decide.
- **Google access tokens genuinely expire** (~1 hour), unlike a Meta Page token — `YouTubeTokenRefresher` is the
  first real (non-`NoRefresherAvailable`) `SocialTokenRefresher` implementation. `SocialTokenRefresher.refresh()`
  only receives the bare refresh token, not the platform app/`clientSecret` a Google refresh request needs, so it
  looks its own `SocialPlatformApp` row up directly via `PlatformSocialAppService` rather than requiring an
  interface change every other platform would have to accommodate too — it's already irreducibly YouTube-specific
  by being this class at all.
- `content` maps onto YouTube's separate `title`/`description` fields (Discuva's data model has only one caption
  field) as `title = content.slice(0, 100)` (YouTube's title cap), `description = content` (`+ "#Shorts"` for
  `REEL`).

Also not live-tested from this environment, for the same no-outbound-network reason as Meta — written against
Google's documented OAuth2 and YouTube Data API v3 contracts, covered by unit tests mocking `fetch`.

**`SocialTokenResolverService`** — every publisher calls `getValidAccessToken(accountId)` instead of touching
`SocialAccount`'s encrypted columns directly. Takes an id, not an entity, since the token columns are `select:
false` and a `SocialAccount` loaded via a normal relation (e.g. `post.targets[].account`) never carries them.
Decrypts and returns the token if not expired (60s safety margin); if expired and a refresh token exists, resolves
that platform's `SocialTokenRefresher` (`YouTubeTokenRefresher` for `YOUTUBE`; `NoRefresherAvailable`, which throws,
for every platform with no real refresh flow — Meta Page tokens included, since they don't expire) and persists the
renewed token.

**Media validation (`SocialMediaValidationService`)** — keyed on `(platform, placement)`, not platform alone,
informed by researched per-platform specs (image/video size & duration caps, caption length, max image count).
`validate(media, targets)` takes `content` *per target entry* (not one shared param) — a target with its own
`contentOverride` validates against that override, not `SocialPost.content`, so two targets in the same call can
have entirely different caption lengths. Two-tier model: **errors** (wrong content type for the placement, over a
hard size/duration/caption limit) block that specific target before it ever reaches its publisher; **warnings**
(e.g. an Instagram Reel over the ~3-minute "ideal" length) surface without blocking. Enforced inside
`SocialPostService.publish()`, not just a frontend nicety — a target with unresolved errors is marked `FAILED`
with the validation message, and its publisher is never called. `getConstraints()` returns the same table as
JSON — `GET /social-media/constraints` exposes it so the composer can show a live per-target character counter
against the exact numbers enforced at publish time, without a round-trip per keystroke.

**Per-target customization — override and crop.** Most targets share `SocialPost.content` and its media
untouched; two independent, opt-in per-target adjustments exist for when a platform's constraints don't fit the
shared version:
- **`contentOverride`** (`PATCH /social-media/posts/:id/targets/:targetId/override`, body `{contentOverride:
  string | null}`, `DRAFT` posts only) — a target-specific caption, e.g. a shortened version for X's 280-char
  limit while Facebook/Instagram keep the full text. `null` explicitly clears it, reverting to the shared
  content. Can also be set at creation time via `CreateSocialPostDto.targets[].contentOverride`.
- **Crop focal point** (`PATCH /social-media/posts/:id/targets/:targetId/focal-point`, body `{x, y: number | null}`,
  `DRAFT` posts only, both set or cleared together) — only meaningful for `STORY`/`REEL`. `SocialMediaCropService`
  crops to `9:16` (the one universal, strict requirement both placements share across every platform that
  supports them — `FEED` is deliberately never cropped, since no platform enforces a single "correct" feed aspect
  ratio the way Stories/Reels do) using Cloudinary's `g_auto` content-aware/saliency cropping (core product, no
  add-on) by default, or `g_xy_center` at the stored `x`/`y` if a focal point is set. `x`/`y` are normalized
  (0-1) floats — Cloudinary accepts gravity offsets as float percentages directly, so a click position on the
  composer's rendered preview maps straight through with no pixel-dimension math on either side. The
  transformation is inserted into the existing Cloudinary delivery URL as a path segment
  (`.../upload/c_fill,ar_9:16,g_auto/...`) — no re-upload, no second stored asset per placement.

`SocialPostService.publish()` resolves both — `target.contentOverride ?? post.content` and
`SocialMediaCropService.resolveMediaForPlacement(post.media, target.placement, focalPoint)` — exactly once per
target, before validation and before calling that target's publisher. A publisher never sees `SocialPost`/
`SocialPostTarget` directly, only the already-resolved `content: string` and `media: SocialPostMedia[]` (see
`SocialPlatformPublisher`'s own comment) — so a publisher can't forget to apply an override or a crop, and
resolution logic lives in exactly one place regardless of how many platforms get wired in later.

**Scheduled publishing** — `POST /social-media/posts/:id/schedule` (`{scheduledFor: ISO string}`) sets `status =
SCHEDULED` and adds a delayed job to the `social-post-publish` Bull queue (`jobId` = the post's own id, both to
prevent double-scheduling and so `cancelSchedule` can find it again without a separate stored column). When the
delay elapses, `SocialPostPublishProcessor` enters the job's tenant context (`runInTenantContext`, envelope carried
via `buildJobEnvelope`) and calls the *exact same* `SocialPostService.publish()` "Publish Now" calls — scheduling
only decides *when* that call happens, there is no second publish path. `POST
/social-media/posts/:id/schedule/cancel` removes the pending job and reverts the post to `DRAFT`.

**Draft media retention (`SocialMediaRetentionScheduler`)** — daily sweep (`@Cron('0 3 * * *')`) across every
active tenant: any `DRAFT`-status post whose `updatedAt` is older than a configurable window
(`PlatformSettingKey.SOCIAL_MEDIA_DRAFT_RETENTION_DAYS`, default 30, platform-admin adjustable via the existing
`PlatformSettingsService`) has its `SocialPostMedia` rows and their Cloudinary assets deleted. `SCHEDULED` and
published posts are never touched — only abandoned drafts age out. Closes a gap the researched incumbents
(Buffer/Hootsuite/Later) don't document clearly.

**Publish semantics (`SocialPostService.publish`):** every target is attempted independently — one platform (or
validation) failing never blocks the others. The post's overall `status` is derived from how many targets actually
succeeded: `FAILED` if none did, `PUBLISHED` if all did, `PARTIALLY_PUBLISHED` otherwise. `publishedAt` on the post
is set whenever at least one target succeeded. A successful `PublishResult.externalPostId` (the platform's own id
for the post/video) is persisted onto the target as `externalPostId` — a failed republish attempt leaves a prior
`externalPostId` untouched rather than clearing it.

**Stats extension point (`stats/social-stats-fetcher.interface.ts`)** — `SocialStatsFetcher` is a one-method
interface (`getStats(account, externalPostId): Promise<PostStats>`), resolved per `SocialPlatform` by
`SocialStatsFetcherRegistry`, same shape as the publisher/exchanger/refresher extension points.
`GET /social-media/posts/:id/targets/:targetId/stats` (`SocialPostService.getTargetStats`) resolves a target's
platform fetcher and returns whatever it reports; throws `BadRequestException` if the target has no
`externalPostId` yet (never published). **`YouTubeStatsFetcher` is the only real implementation today** — it
calls `YouTubeApiService.getVideoStats` (`videos.list?part=statistics`), returning `viewCount`/`likeCount`/
`commentCount` only (`dislikeCount` has been private since December 2021; `favoriteCount` is permanently 0). This
is deliberately the *Data API v3's* own statistics, not the separate **YouTube Analytics API**
(`youtubeAnalytics/v2`) — that's a genuinely different product (its own scope `yt-analytics.readonly`, its own
base URL, enabled separately in Google Cloud Console) needed for anything richer: watch time, audience retention,
traffic sources. Not wired in — a deliberate, discussed scope decision, not an oversight. Facebook/Instagram stats
would reuse the *same* Graph API `MetaGraphApiService` already talks to (different permissions —
`pages_read_engagement`, `instagram_manage_insights` — not a separate product the way YouTube's Analytics API is),
but no `FacebookStatsFetcher`/`InstagramStatsFetcher` exists yet; both platforms resolve to `NoStatsAvailable`
(throws) via the registry, same honest-failure posture as `NotConnectedPublisher`.

**Deleting a post** is only allowed while `DRAFT` or fully `FAILED` — a `PUBLISHED`/`PARTIALLY_PUBLISHED`/
`PUBLISHING` post's target history is kept, not deletable, since it's the record of what was actually attempted.

| Method | Route | Auth | Notes |
|--------|-------|------|-------|
| POST   | `/social-media/accounts`                    | AdminGuard (SOCIAL_MEDIA_WRITE) | Register an account to post to; `isConnected` is always `false` on create — connecting is a separate step |
| GET    | `/social-media/accounts`                    | AdminGuard (SOCIAL_MEDIA_READ)  | List all registered accounts |
| DELETE | `/social-media/accounts/:id`                | AdminGuard (SOCIAL_MEDIA_WRITE) | Remove an account |
| GET    | `/social-media/accounts/:id/authorize-url`  | AdminGuard (SOCIAL_MEDIA_WRITE) | Returns `{url}` — the platform's OAuth authorize URL, `state`-encoded to this account/tenant |
| GET    | `/v1/integrations/social/:platform/oauth/callback` | `@Public()`, tenant-excluded | Called by the OAuth provider's redirect, not the frontend directly — see above |
| GET    | `/social-media/constraints`                 | AdminGuard (SOCIAL_MEDIA_READ)  | The `(platform, placement)` constraints table as JSON — for the composer's live per-target counters |
| GET    | `/social-media/platform-enabled`            | AdminGuard (SOCIAL_MEDIA_READ)  | `{enabled: boolean}` — the platform-wide composer readiness gate; see below and "Platform Settings" |
| GET    | `/social-media/available-platforms`         | AdminGuard (SOCIAL_MEDIA_READ)  | `{platforms: SocialPlatform[]}` — which platforms the "Add Account" picker should offer; see below |
| POST   | `/social-media/posts`                       | AdminGuard (SOCIAL_MEDIA_WRITE) | `{content, targets: {accountId, placement, contentOverride?}[]}` — creates a `DRAFT` with one `PENDING` target per (account, placement) pair |
| GET    | `/social-media/posts`                       | AdminGuard (SOCIAL_MEDIA_READ)  | Paginated (`?page=&limit=`) |
| GET    | `/social-media/posts/:id`                   | AdminGuard (SOCIAL_MEDIA_READ)  | One post with its targets, each target's account, and its media |
| POST   | `/social-media/posts/:id/media`             | AdminGuard (SOCIAL_MEDIA_WRITE) | Multipart, field `files` (up to 10, 200MB cap, image/video only) — `DRAFT` posts only |
| DELETE | `/social-media/posts/:id/media/:mediaId`    | AdminGuard (SOCIAL_MEDIA_WRITE) | `DRAFT` posts only |
| PATCH  | `/social-media/posts/:id/targets/:targetId/override` | AdminGuard (SOCIAL_MEDIA_WRITE) | `{contentOverride: string \| null}` — `DRAFT` posts only, `null` clears it |
| PATCH  | `/social-media/posts/:id/targets/:targetId/focal-point` | AdminGuard (SOCIAL_MEDIA_WRITE) | `{x, y: number \| null}`, 0-1 — `DRAFT` posts only, must be set/cleared together |
| POST   | `/social-media/posts/:id/publish`           | AdminGuard (SOCIAL_MEDIA_WRITE) | Attempts every target; see publish semantics above |
| GET    | `/social-media/posts/:id/targets/:targetId/stats` | AdminGuard (SOCIAL_MEDIA_READ) | `{viewCount?, likeCount?, commentCount?}` — YouTube only today; 400 if the target hasn't published yet |
| POST   | `/social-media/posts/:id/schedule`          | AdminGuard (SOCIAL_MEDIA_WRITE) | `{scheduledFor: ISO string}` — `DRAFT` only, must be in the future |
| POST   | `/social-media/posts/:id/schedule/cancel`   | AdminGuard (SOCIAL_MEDIA_WRITE) | Reverts to `DRAFT`, removes the queued job |
| DELETE | `/social-media/posts/:id`                   | AdminGuard (SOCIAL_MEDIA_WRITE) | `DRAFT`/`FAILED` only |

`social_media` is a toggleable module (`KNOWN_MODULES`, `ModuleEnabledGuard`). New `social_media:read`/
`social_media:write` permissions, backfilled onto existing `SuperAdmin` roles by
`GrantSocialMediaPermissions1791504000000` (same class of fix as `GrantFormsPermissions` — a brand-new permission
is only auto-granted to a SuperAdmin role at the moment that role is *created*).

**`GET /social-media/platform-enabled` — a guard-access ping, not a standalone switch.** Originally paired with a
global `PlatformSettingKey.SOCIAL_MEDIA_ENABLED` kill switch (an all-tenants-at-once readiness gate, separate from
a tenant's own module toggle) — retired once `Tenant.moduleOverrides` (see "Per-tenant manual override" above)
shipped, since plan-features-exclusion plus a per-tenant override achieves the same "not ready for everyone yet"
rollout control with actual per-church granularity, and with real backend enforcement (the old global switch only
ever gated this one frontend check, never the API itself — a technically-inclined tenant could always reach the
real endpoints regardless of what it was set to). The route stays: `ModuleEnabledGuard` above it already 403s
before the handler runs if the tenant's own toggle is off, their plan doesn't include `social_media`, and no
override grants it — so simply reaching the handler at all already proves access, and it unconditionally returns
`{enabled: true}`. discuva-admin's `/social-media` page still fetches this on load and shows "Coming Soon" on
any failure (including the `403` this guard produces), so the frontend behavior is unchanged even though what's
being checked underneath is now the real per-tenant module/plan/override chain instead of a separate global flag.

**Per-platform availability.** The module/plan/override chain above is all-or-nothing across every platform at
once — it can't hide just X/TikTok while shipping Facebook/Instagram/YouTube. `GET
/social-media/available-platforms` fills that gap: it intersects `IMPLEMENTED_PLATFORMS`
(`src/social-media/constant/implemented-platforms.constant.ts` — platforms with a real
`SocialOAuthExchanger`/`SocialPlatformPublisher`, currently Facebook/Instagram/YouTube; X/TikTok resolve to
`NoExchangerAvailable`/`NotConnectedPublisher` regardless of what's registered for them) with
`PlatformSocialAppService.listActivePlatforms()` (registered **and** `isActive` in `social_platform_apps`).
discuva-admin's `AccountsPanel` filters its "Add Account" platform `<select>` down to this list — a platform stays
unselectable until it's both built and deliberately activated from discuva-platform's existing Deactivate/Reactivate
toggle, with no new admin UI needed for it. This is a frontend picker restriction only — `POST
/social-media/accounts` itself still accepts any `SocialPlatform` enum value; connecting an account for an
unavailable platform still fails honestly via `NoExchangerAvailable` either way, same as before this endpoint
existed.

**Platform-admin surface (`/platform/social-media-apps`, discuva-platform):** separate from the tenant-side module
toggle above — Discuva staff register each platform's OAuth app credentials here (one app per platform, not
per-tenant) and flip the kill switch. New `PlatformAdminPermission.SOCIAL_MEDIA_APPS_READ`/`WRITE` (a distinct,
disjoint enum from tenant-side `AdminPermission.SOCIAL_MEDIA_READ`/`WRITE` — a tenant admin composing/publishing
posts never needs to see Discuva's own app secrets).

| Method | Route | Auth | Notes |
|--------|-------|------|-------|
| GET   | `/platform/social-media-apps`            | PlatformAdminGuard (SOCIAL_MEDIA_APPS_READ)  | Never returns `clientSecretEncrypted` — `select: false` |
| GET   | `/platform/social-media-apps/scope-catalog` | PlatformAdminGuard (no extra permission — metadata, same posture as `permissions/groups`) | `{[platform]: {scopes: {value,label,required}[], separator}}` — drives the register form's scope picker |
| POST  | `/platform/social-media-apps`            | PlatformAdminGuard (SOCIAL_MEDIA_APPS_WRITE) | `{platform, clientId, clientSecret, redirectUri, scopes: string[]}` — upserts (one row per platform) |
| PATCH | `/platform/social-media-apps/:platform`  | PlatformAdminGuard (SOCIAL_MEDIA_APPS_WRITE) | `{isActive}` — the kill switch; never touches already-connected tenants' `SocialAccount` tokens either way |
| DELETE | `/platform/social-media-apps/:platform` | PlatformAdminGuard (SOCIAL_MEDIA_APPS_WRITE) | Hard delete — `204`, `404` if not registered. Safe: `SocialAccount` has no FK to this table (just a platform enum string), so nothing orphans; an already-connected tenant's tokens are untouched, same as deactivating |

**Scope validation.** `scopes` used to be a raw free-text string, passed straight into the OAuth `scope` query
parameter with no validation beyond "not empty" — a typo or wrong separator saved silently and only surfaced later,
either as Meta quietly dropping unrecognized permissions (no error at all, just fewer permissions than intended) or
Google's consent screen showing `invalid_scope`. It's now `scopes: string[]`, one OAuth permission per entry, checked
in `PlatformSocialAppService.upsertApp()` against `KNOWN_SOCIAL_SCOPES`
(`src/platform-admin/constant/known-social-scopes.constant.ts`) — a per-platform whitelist with a `required` flag per
scope, verified against Meta's and Google's own permission docs (Facebook: `pages_show_list`,
`pages_read_engagement`, `pages_manage_posts`; Instagram: those three plus `pages_read_user_content`,
`instagram_basic`, `instagram_content_publish`; YouTube: `.../auth/youtube.upload` required,
`.../auth/youtube.readonly` optional — needed only for the stats extension point). `upsertApp()` rejects (400) any
unrecognized scope and any submission missing a required one, then joins the array with that platform's own
separator (`SCOPE_SEPARATOR` — comma for Meta, space for Google, matching each platform's own OAuth dialog
convention) before storing — the DB column itself is unchanged, still a single string. Platforms with no exchanger
built yet (X, TikTok) have no catalog entry, so any non-empty list is accepted rather than guessed at.

**Frontend:** `RegisterAppPanel` replaced the free-text scopes input with a checkbox list fetched from the scope
catalog — required scopes are pre-checked and disabled (can't be unchecked, since submitting without one always
400s anyway), so the most common mistake is now structurally impossible rather than just validated after the fact.
Platforms with no catalog fall back to a comma-separated free-text input. The apps list table gained a "Scopes"
column rendering each granted scope's catalog label (falling back to the raw value for anything not in the catalog,
e.g. a scope later removed from it) — previously scopes weren't visible anywhere in the UI at all.

**Facebook Login for Business vs. classic scope-based login
(`SocialPlatformApp.configId`).** Discovered live against a real Meta App: the "Manage everything on your Page"
use case (Facebook Login for Business) does not grant permissions via the classic `scope` query parameter at all —
it requires a Configuration ID, created in the Meta App dashboard (Facebook Login for Business product >
Configurations), where the actual permission list lives. Sending `scope` alongside/instead of `config_id` on a
Business Login app produces a partial, confusing failure — some permissions silently rejected as "Invalid Scopes"
(Meta's own error, shown only to developers) rather than a clean success or a clean rejection of the whole request.
`configId` is a new nullable column on `SocialPlatformApp`; `MetaGraphApiService.buildAuthorizeUrl()` sends
`config_id` instead of `scope` whenever it's set, and only falls back to the classic `scope` param when it's null —
the two are mutually exclusive on the dialog, never sent together. `scopes` is still recorded and validated even
when `configId` is set — useful as a record of what the Configuration is expected to grant, even though it isn't
what's literally sent in that case.

**Frontend:** `RegisterAppPanel` shows a "Configuration ID" field for FACEBOOK/INSTAGRAM specifically, with guidance
on where to find it in the Meta dashboard; the Scopes field's label changes to clarify it's reference-only once a
Configuration ID is set. The apps list table shows a "Business Login (config_id)" badge in place of the scope pills
for any row that has one, so which mode a registered app is in is visible at a glance instead of requiring a DB
query to diagnose the next time this exact class of error shows up.

**Bug found and fixed while wiring this up:** `PlatformSocialAppService.getDecryptedApp()` — the one method that
reads `SocialPlatformApp` for actual OAuth use — passes an explicit column `select` array (needed to opt back into
`clientSecretEncrypted`'s `select: false`), and `configId` was never added to it. TypeORM silently omits any column
not in an explicit select list, so `app.configId` came back `undefined` on the object `buildAuthorizeUrl()` actually
receives at connect time — meaning the fix above would have compiled, passed its own unit tests (which mock the
repository directly, bypassing this), and still silently done nothing in production. Added `configId` to the select
list and a regression test asserting it's present, specifically because this class of bug — correct in isolation,
broken through one specific read path — doesn't show up any other way.

**Edit and delete for a registered app.** Neither existed before this — the only way to "edit" was re-registering
blind for the same platform (a full overwrite via the same upsert, requiring every field retyped including a
Client Secret that's never returned by any GET), and there was no way to remove a platform app at all, only
deactivate it. `DELETE /platform/social-media-apps/:platform` is a genuine hard delete (see routes table above) —
safe specifically because `SocialAccount` has no FK to `SocialPlatformApp`, only a plain platform enum string, so
nothing relational can orphan; an already-connected tenant's stored tokens are untouched either way, identical to
deactivating. `RegisterAppPanel` now accepts an `editingApp` prop: platform is locked (can't retarget an edit to a
different platform — delete and re-register instead), Client ID/Redirect URI/Configuration ID pre-fill from the
existing row, and stored scopes are parsed back into the checkbox picker using that platform's catalog separator.
Client Secret still can't be pre-filled (never returned by the API) and must be re-entered to save any change,
same constraint the upsert endpoint always had. The apps list table gained Edit (pencil) and Delete (trash, with a
native `confirm()` warning what deleting affects) actions alongside the existing Deactivate/Reactivate toggle.

**Meta Data Deletion Callback (`src/social-media/service/meta-data-deletion.service.ts`,
`controller/meta-data-deletion.controller.ts`).** Meta's Platform Terms §3(d)(i) require every app to either
periodically process a manual list of app-scoped user IDs to purge, or implement a Data Deletion Callback URL that
automates it — registered in the Meta App dashboard's Advanced settings as the "Data Deletion Request URL". Meta
POSTs `application/x-www-form-urlencoded` with a single `signed_request` field
(`{base64url_sig}.{base64url_json_payload}`, HMAC-SHA256 signed with the app's client secret) whenever a user
deauthorizes the app or requests deletion from their Facebook Account Settings.

`MetaDataDeletionService.verifySignedRequest()` tries the signature against every registered Meta-platform app's
secret (Facebook, then Instagram — both typically share one Meta App, tried independently in case they were ever
registered with different credentials), using `timingSafeEqual` on equal-length buffers, and rejects (throws
`BadRequestException`, never silently no-ops) anything malformed, unsigned, or signed with an unrecognized secret —
a forged POST to this public URL must never appear to succeed. `PlatformSocialAppService.getDecryptedApp()` supplies
the plaintext secret (same decrypt-on-demand pattern the OAuth exchange flow already uses).

The actual "deletion" is close to a no-op by design: `SocialAccount.externalAccountId` stores the connected Facebook
**Page's** id, never the authorizing person's own Facebook-scoped user id, and `connectedBy` is our own internal
`Admin` FK, not a Meta identifier — so there is structurally nothing in Discuva's database keyed to the `user_id`
Meta's signed_request identifies. `recordRequest()` just persists a `SocialDataDeletionRequest` row (public schema,
no tenant context — same reasoning as `SocialOAuthCallbackController`) so the status URL Meta's response contract
requires isn't a dead link, and returns a confirmation code immediately; no async job needed. `GET
.../data-deletion/status/:code` renders a small human-readable HTML page (Meta's contract explicitly requires a
person be able to read it, not just machines) explaining that no personal data was retained.

| Method | Route | Auth | Notes |
|--------|-------|------|-------|
| POST | `/integrations/social/meta/data-deletion` | `@Public()`, tenant-excluded | Meta calls this directly; body is form-encoded `signed_request`, not JSON. Responds `{url, confirmation_code}` |
| GET | `/integrations/social/meta/data-deletion/status/:code` | `@Public()`, tenant-excluded | Human-readable HTML status page — the URL returned above |

`META_DATA_DELETION_STATUS_BASE_URL` (optional env var, matching `YOUTUBE_WEBSUB_CALLBACK_URL`'s own
`Joi.string().uri().allow('').optional()` convention) supplies the public base URL used to build the status link;
falls back to the incoming request's own protocol/host when unset, which is fine for local testing but not behind a
proxy that rewrites those.

### Utility Module

Shared infrastructure used across the entire application.

**Idle-queue Redis load (`BullModule.forRootAsync` in `app.module.ts`):** Bull runs three independent per-queue background timers (`drainDelay`, `guardInterval`, `stalledInterval` — confirmed unrelated to each other in `bull/lib/queue.js`: `drainDelay` is a `BRPOPLPUSH` blocking-timeout argument, `guardInterval` drives a self-rescheduling delayed-job `setTimeout` chain, `stalledInterval` is a plain `setInterval`) that hit Redis on a fixed schedule the moment a queue's `.process()` handler is registered — completely independent of whether any job is ever enqueued. Left at Bull's defaults (5s/5s/30s) across this app's 7 queues, that's on the order of 250k+ idle Redis commands/day, which is what exhausted the production Upstash request quota with zero tenants live (2026-08-12) — not tenant traffic. Fixed via the shared root `settings`: `drainDelay`/`guardInterval` pushed to their practical max (`3600`s / `3600000`ms) since both have **zero real latency cost at any value** — Redis's blocking `BRPOPLPUSH` wakes immediately the instant a real job is pushed regardless of the polling ceiling, and `guardInterval`'s ceiling self-adjusts down whenever a delayed job is actually scheduled (none exist anywhere in this codebase — no call site uses Bull's `delay`/`repeat` job options). `stalledInterval` is the one setting with a genuine trade-off (how long a crashed worker's job sits unclaimed before Bull reclaims and retries it), kept at `600000`ms (10 min) — a non-issue given the single always-on machine and short-lived handlers this app uses. The `follow-up` queue defines its own `settings` object (needed for its longer `lockDuration`), which fully replaces rather than merges with the root config, so all three values are repeated there explicitly (its `stalledInterval` was previously a bespoke `60000`ms with no documented reason for the faster recovery — aligned to the same `600000`ms as every other queue).

**Bull Board (queue dashboard):** Mounted at `GET /queues` on the NestJS HTTP server. Provides a standalone web UI showing all six queues (`email`, `push-notifications`, `follow-up`, `tithe`, `finance-reconciliation`, `audit-log`) with pending/active/completed/failed job counts and per-job retry controls. Protected by HTTP Basic Auth (`BULL_BOARD_USER` / `BULL_BOARD_PASSWORD` env vars). If either env var is absent the dashboard is not mounted. Registered before Helmet so the `/queues` path is exempt from the strict Content Security Policy.

**Email queue (`EmailQueueService` + `EmailProcessor`):** All outbound email goes through a Bull queue backed by Redis. `EmailQueueService.queueEmailWithTemplate()` compiles the HTML template using **Handlebars** and adds a job to the `email` queue. The platform-wide default email provider is resolved at startup from `EMAIL_PROVIDER` and injected via `EMAIL_PROVIDER_TOKEN`; per-send, `EmailProcessor` may instead resolve a tenant's own BYOK provider — see "Email BYOK send path" under Communication Providers above. Five providers are available — see the table under Communication Providers above — all accepting optional per-call BYOK credentials. Bull handles retries automatically — 5 attempts, 5-second fixed backoff. On success or permanent failure, a row is written to `email_logs` with the `provider` field set to whichever provider actually processed that specific job.

**Per-tenant branding (`church_name`/`church_address`/`logo_url`/`support_email`):** resolved fresh per email by `EmailQueueService.resolveBrandingData()`, not read once at boot — the HTML is fully rendered before the job is queued, so this happens at enqueue time via `cls.get('tenantId')` → `Tenant` row lookup, cached under `tenant-branding:${tenantId}` (`CACHE_TTL_REFERENCE_SECONDS`, same TTL/pattern as `PlanGuard`'s `plan-features:${tenantId}` cache). Any write to a tenant's name/logo/tagline/address (`PATCH /tenant/info`, `POST`/`DELETE /tenant/logo`, platform-admin's `PATCH /platform/tenants/:id`) must invalidate this same key or emails keep stale branding for up to the TTL — all four call sites already do. A tenant field left unset (`null`) falls back to that one field's `CHURCH_NAME`/`CHURCH_ADDRESS`/`LOGO_URL` env default, not the whole record — except `support_email`, which has no env fallback at all (empty string when unset) since a wrong/generic contact address would be actively misleading, not just generic; the 43 member/worker-facing templates that reference it gate the line behind `{{#if support_email}}` so it's simply omitted rather than showing nothing useful. `product_name` always comes from `PRODUCT_NAME` (the SaaS product name) regardless of tenant — it's platform-wide, not per-church. **Bug fixed (2026-08-04):** five templates (`tithe-proof-{confirmed,declined,submitted}`, `pledge-contribution-{confirmed,declined}`) had a hardcoded external logo URL instead of `{{logo_url}}` — every tenant's emails from those five showed the same wrong logo, not their own. `annual-giving-statement.html` had no logo image at all. Both fixed; all 61 templates now reference `{{logo_url}}`. **Formerly a known gap, now fixed:** every `@Cron` scheduler in the codebase that touches tenant-scoped data (`FollowUpScheduler` included) now wraps its per-run body in `forEachActiveTenant()` (`src/tenant/utility/for-each-active-tenant.ts`), which fetches every active `Tenant` and re-enters that tenant's CLS/`SET LOCAL search_path` context (via the existing `runInTenantContext()` helper) once per tenant before running the body — so branding, currency, and every other tenant-scoped lookup inside a scheduled job now resolves correctly per tenant instead of falling back to env defaults or reading the wrong schema. One tenant's failure is caught and logged per-tenant so it doesn't stop the rest of the batch. Only `YoutubeSubscriptionScheduler` (genuinely control-plane data) and `SubscriptionLapseScheduler`'s top-level query (also control-plane) are exempt.

**Tenant-aware login URLs (`login_url`/`admin_login_url`, added 2026-08-04, `admin_login_url` mechanism changed 2026-08 — Phase 9l):** `LOGIN_URL`/`ADMIN_LOGIN_URL` are configured as bare base URLs — every caller used to read them straight from `ConfigService` and pass the bare value into a template, which meant every tenant's login links pointed at the same non-tenant-scoped host. `resolveBrandingData()` auto-injects both into every email, but the two now use **different** rewriting mechanisms, not the same one:
- `login_url` (discuva-member — a real per-tenant wildcard): `buildTenantUrl()` (`src/tenant/utility/tenant-url.ts`) inserts the subdomain as the leftmost host label — `https://discuva.org/login` → `https://church-alpha.discuva.org/login`.
- `admin_login_url` (discuva-admin — a single fixed host, no wildcard): `buildAdminUrl()` (same file) instead adds the subdomain as a `?subdomain=` query param, since there's no per-tenant host to prepend it onto anymore — `https://admin.discuva.org/login` → `https://admin.discuva.org/login?subdomain=church-alpha`. discuva-admin's login/set-password forms read this param to pre-fill their "Church Subdomain" field.

All ~17 call sites that used to compute these themselves (`AuthService`, `AdminService`, `MemberService`, `MemberImportService`, `IncidentReportService`, and four schedulers) were simplified to rely on the auto-injected value instead — a call site should never read `LOGIN_URL`/`ADMIN_LOGIN_URL` from `ConfigService` directly. The one exception is `AuthService.sendSessionSecurityAlert()`, which has to pick between the two based on which surface (member/admin) a session belongs to — it calls `UtilityService.resolveTenantLoginUrl('member' | 'admin')` (delegates to `EmailQueueService.resolveTenantUrl()`, which internally branches to `buildTenantUrl`/`buildAdminUrl` the same way `resolveBrandingData()` does) directly instead. `TenantProvisioningService.sendWelcomeEmail()`'s set-password link is a separate case again — it builds its URL from the `Tenant` object already in hand (`buildAdminUrl(ADMIN_LOGIN_URL, '/set-password', { email, otp, subdomain: tenant.subdomain })`) rather than through CLS, since it can run from a Bull job or a synchronous platform-admin call with no tenant CLS context active; the `path` argument *replaces* `ADMIN_LOGIN_URL`'s own path rather than appending onto it, which also incidentally fixed a pre-existing `/login/set-password` double-path bug the old string-concatenation version had. `PLATFORM_LOGIN_URL` is deliberately untouched — platform admins aren't tied to any tenant.

**Tenant-aware email subject lines (`EmailQueueService.resolveChurchName()`/`UtilityService.resolveChurchName()`, added 2026-09-05):** Same class of bug as the login-URL one above, just for the SUBJECT line rather than the body. A template body already gets the correct per-tenant `{{ church_name }}` automatically via `resolveBrandingData()`, but a subject is a plain string built in TypeScript *before* any template is touched — six services (`MemberService`, `RequestLeaveService`, `AttendanceService`, `AuthService`, `MemberImportService`, `ChildrenChurchService`) instead cached `PRODUCT_NAME`/`CHURCH_NAME` once in their own constructor from `ConfigService` and interpolated that into the subject directly. Two symptoms: (1) most of these used `PRODUCT_NAME` (e.g. a worker's promotion email read "Welcome to Discuva Workforce" instead of naming their own church), and (2) even the ones already using `CHURCH_NAME` showed the same single env-configured value for every tenant on the platform, not the recipient's actual church. `EmailQueueService.resolveChurchName()` (public — resolves the current tenant via the same CLS + `tenant-branding` cache `getCurrentTenant()` already uses, falling back to env `CHURCH_NAME` only when there's no tenant context) and its `UtilityService` delegate replace all ~20 affected subject-line interpolations across those six files; each caller does `const churchName = await this.utilityService.resolveChurchName();` once before building the subject (once per request/batch, not once per recipient in a loop). Every now-dead `private readonly productName`/`ConfigService` constructor plumbing that had no other use in its file was removed alongside it (`RequestLeaveService` and `ChildrenChurchService` no longer inject `ConfigService` at all).

### Domain map (discuva.org)

| Host | App | Notes |
|---|---|---|
| `discuva.org`, `www.discuva.org` | Homepage/marketing + self-serve signup | Bare root — `extractSubdomain` returns `null`, so tenant-aware URL helpers fall back to the bare base URL here too. |
| `platform.discuva.org` | discuva-platform | `platform` is in `RESERVED_SUBDOMAINS` on both frontend and backend — no tenant can ever claim it. No tenant logic in this app at all (confirmed: no `middleware.ts`, no Host-header parsing anywhere) — every route it calls is `/v1/platform/*`, already excluded from `TenantMiddleware`. |
| `{tenant}.discuva.org` | discuva-member | Real per-tenant wildcard for the app's *own hosting* — `extractSubdomain` resolves it the normal way, unchanged. discuva-member's *outgoing* API calls no longer need to share this host: they target `api.discuva.org` directly, carrying the subdomain as an `X-Tenant-Subdomain` header (pre-auth) or a JWT tenant claim (authenticated) instead of via the URL's own hostname (Phase 9m). No router/path-split needed in front of this host anymore. |
| `admin.discuva.org` | discuva-admin | **Fixed, single origin — no wildcard needed.** See "Fallback resolution for a fixed, non-wildcard host" above: tenant identity travels in the JWT (post-login) or an explicit `X-Tenant-Subdomain` header (login only), not the hostname, so this app doesn't need — and structurally can't use — a per-tenant subdomain of its own. |
| `api.discuva.org` | discuva-api | Reachable directly by every app, always — discuva-admin's and discuva-member's tenant resolution both work over this fixed host (see "Fallback resolution for a fixed, non-wildcard host" above), plus discuva-platform, discuva-web's `POST /v1/signup`, third-party webhook URLs (Paystack/Flutterwave/YouTube dashboards), health/docs. |

Only **one** DNS zone needs wildcard coverage — `*.discuva.org`, and only for discuva-member's own hosting, not for
any traffic bound for the API. `admin.discuva.org` and `api.discuva.org` are both plain, single DNS records, and
neither needs a router in front of it splitting by path — a design an earlier draft of this table used to describe,
which existed only to work around discuva-admin and discuva-member both needing to reach the API without a
subdomain of their own to carry a tenant on. `LOGIN_URL` should be configured against the `discuva.org` zone;
`ADMIN_LOGIN_URL` against `admin.discuva.org` (no longer the `discuva.org` zone — the admin app moved to its own
dedicated host).

**Email category gating:** `queueEmail*` methods accept an optional `category?: EmailCategory` argument. If no category is supplied the email always sends (used for security-critical auth emails: OTP, password reset, account locked, etc.). Optional categories are gated by boolean config flags (`EMAIL_*_ENABLED`); setting a flag to `false` suppresses that category without touching any call sites. Current categories:

| Category | Flag | Default |
|---|---|---|
| `ATTENDANCE_CHECKIN` | `EMAIL_ATTENDANCE_CHECKIN_ENABLED` | `true` |
| `BIRTHDAY` | `EMAIL_BIRTHDAY_ENABLED` | `true` |
| `EVENT_REMINDER` | `EMAIL_EVENT_REMINDER_ENABLED` | `true` |
| `PRAYER_REMINDER` | `EMAIL_PRAYER_REMINDER_ENABLED` | `true` |
| `FOLLOW_UP` | `EMAIL_FOLLOW_UP_ENABLED` | `true` |
| `ASSET_ALERTS` | `EMAIL_ASSET_ALERTS_ENABLED` | `true` |
| `GIVING_RECEIPT` | `EMAIL_GIVING_RECEIPT_ENABLED` | `true` |
| `FINANCE_ALERTS` | `EMAIL_FINANCE_ALERTS_ENABLED` | `true` |
| `SESSION_REPORT` | `EMAIL_SESSION_REPORT_ENABLED` | `true` |
| `INCIDENT_REPORT` | `EMAIL_INCIDENT_REPORT_ENABLED` | `true` |
| `CHILDREN_CHURCH` | `EMAIL_CHILDREN_CHURCH_ENABLED` | `true` |
| `LOGIN_ALERT` | `EMAIL_LOGIN_ALERT_ENABLED` | `true` |
| `SERVICE_PROGRAMME_ASSIGNMENT` | `EMAIL_SERVICE_PROGRAMME_ASSIGNMENT_ENABLED` | `true` |
| `PASTOR_FEEDBACK` | `EMAIL_PASTOR_FEEDBACK_ENABLED` | `true` |
| `ASSIGNMENT_REMINDER` | `EMAIL_ASSIGNMENT_REMINDER_ENABLED` | `true` |
| `CLASS_SESSION_REMINDER` | `EMAIL_CLASS_SESSION_REMINDER_ENABLED` | `true` |
| `FORM_SUBMISSION` | `EMAIL_FORM_SUBMISSION_ENABLED` | `true` |

Template files live in `src/utility/templates/*.html` and use `{{variable}}` for simple substitution, `{{#if}}` for
conditionals, and `{{#each}}` for loops. Values are HTML-escaped automatically; use `{{{variable}}}` only for
intentional raw HTML.

**Calendar invites (`.ics`) — `buildIcsEvent`, `src/utility/util/ics-builder.ts`:** a small, dependency-free
builder (`BEGIN:VCALENDAR`/`VEVENT` text assembly, no npm ics package) shared by every feature that emails someone
about a specific dated event. Takes `{ uid, startTime, endTime, summary, description, location? }` and returns a
`Buffer` — pass it to `UtilityService.sendEmailWithAttachment(to, subject, templateName, templateData, [{ filename, content }], category?)`
(→ `EmailQueueService.queueEmailWithTemplateAndAttachments`) alongside the usual templated email. The builder
doesn't own event identity — `uid` is the caller's full string (e.g. `` `${slotId}@service-programme` ``), so a
recipient's calendar app can tell "this is an update to an event I already have" from "this is a new event" based
entirely on whether the caller reuses the same `uid` across sends. Two consumers today:
- **Service Programme** (`ServiceProgrammeService.notifySlotAssignment`, `ServiceProgrammeReminderScheduler`) —
  `uid: ` `` `${slotId}@service-programme` `` ``, attached whenever the underlying `ServiceSlot` has both a
  `startTime`/`endTime`; skipped otherwise (no time range to build an event from).
- **Classes** (`ClassSessionReminderScheduler`) — see the Classes Module reminder-scheduler notes below;
  `ChurchClass` has no explicit session-duration field, so this consumer defaults `endTime` to `startTime + 1h`
  rather than omitting the invite.

**Cloudinary (`CloudinaryService`):** Streams file uploads to Cloudinary via `upload_stream` with `resource_type: 'auto'`. Used for finance request attachments, payment proofs, and tithe payment proofs. `uploadBuffer(buffer, folder, filename?)` returns `{secureUrl, publicId, resourceType}` — callers must persist `publicId` and `resourceType` so that assets can be deleted without re-parsing the URL. `deleteByPublicId(publicId, resourceType)` destroys the asset using the stored values (replaces the old `deleteByUrl` which hardcoded `resource_type: 'raw'`). The service validates all three credentials on module init and throws if any are missing. Credentials are read from `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`.

**Cache (`CacheService`):** A Redis-backed key-value cache. All read operations (`get`) are awaited — the result is
needed before the request can continue. Write operations (`set`, `del`) are **fire-and-forget** for non-critical
data (cache population after a DB fetch, cache invalidation on mutations) — if the Redis write is lost, the worst
case is a cache miss on the next request, which falls through to the database. Rate-limit reads are always awaited;
rate-limit counter clears and increments are fire-and-forget.

**Caching strategy by data type:**

| Data              | Key pattern                     | TTL                              | Invalidation |
|-------------------|---------------------------------|----------------------------------|--------------|
| Department list   | `departments:all`               | `CACHE_TTL_REFERENCE_SECONDS`    | On any CRUD  |
| Venue list        | `venues:all`                    | `CACHE_TTL_REFERENCE_SECONDS`    | On any CRUD  |
| Event config list | `event-config:all`              | `CACHE_TTL_REFERENCE_SECONDS`    | On any CRUD  |
| Leaderboard       | `leaderboard:{days}:{limit}`    | `CACHE_TTL_LEADERBOARD_SECONDS`  | TTL only     |
| Rate limit keys   | `login_fail:{email}` etc.       | Per-window duration              | On success   |

### Birthday Module

Automatically greets members on their birthday with an email and a congregation-wide announcement. Other members can
send personal wishes that persist permanently in the member's birthday book.

**Cron:** Runs daily at 6 AM. Queries all active members whose `birthMonth` and `birthDay` match today and whose `birthdayGreetedYear` is not the current year, then for each member (in an isolated try/catch):

- Creates an `ALL`-audience announcement with `expiresAt = 23:59:59` tonight
- Updates `birthdayGreetedYear` to the current year (only after the announcement saves)
- Sends the birthday email (fire-and-forget via email queue)

**Resilience:** `BirthdayService` implements `OnApplicationBootstrap`. On startup, if the hour is ≥ 6, it fires `triggerBirthdayGreetings()` as a background task (fire-and-forget, guarded by a separate `lock:birthday-catchup` Redis lock). This recovers greetings missed because the app was down at 6 AM — the `birthdayGreetedYear` field prevents re-sending to members already greeted. Per-member isolation means one member's failure never blocks the rest.

**`birthdayGreetedYear`:** Integer column (`smallint`) on the `Member` entity. Null for members who have never been greeted. Set to the current year after a successful greeting. The cron and catch-up both filter `WHERE birthdayGreetedYear IS NULL OR birthdayGreetedYear != currentYear` to skip already-greeted members.

**Wish wall:** Wishes persist in `birthday_wishes` regardless of announcement expiry. Rate-limited to `WISH_DAILY_LIMIT`
wishes per sender per day (default: 20). Input is DOMPurify-sanitized.

**Fields returned by `/birthday/upcoming`** (admin-only): `id`, `firstname`, `lastname`, `email`, `phoneNumber`, `birthMonth`, `birthDay`, `birthYear`. `birthYear` is nullable — members aren't required to disclose it, so the endpoint only ever uses `birthMonth`/`birthDay` (recurring, year-independent) to determine "is today/upcoming a birthday"; `birthYear` is included purely so callers can render a full date when it's known, falling back to a day+month-only display when it's not.

**Fields returned by `/birthday/today`** (member-facing, `BirthdayCelebrant`): `id`, `firstname`, `lastname`, `birthMonth`, `birthDay`, `birthYear`, `role`, `departmentName`, `clergyTitleName`, `alreadyWishedByMe`, `photoUrl`. Deliberately does **not** include `email`/`phoneNumber` — those are fine for the admin-only `/birthday/upcoming` view but not for a response every member can call. Same-named celebrants are disambiguated instead via `role`/`departmentName` (from `workerProfile.department`, loaded via the `workerProfile` and `workerProfile.department` relations), `clergyTitleName` (from the `clergy.title` relation — a flat string, unlike `MemberDto`'s nested `clergy`, since this is pure display and never drives a form), and now `photoUrl` (from `Member.photoUrl` — see Member Module) — the mobile UI shows the photo when set, falling back to initials.

**`alreadyWishedByMe` on `/birthday/today`:** computed per request from the caller's own JWT identity (not present on `/birthday/upcoming`, which is admin-only and has no "sender" concept) — `true` when the calling member already has a `BirthdayWish` row for that recipient this calendar year. `sendWish()` already enforced one-wish-per-sender-per-recipient-per-year at the DB level (`@Unique(['recipient', 'sender', 'year'])` on `BirthdayWish`) and rejected a second attempt with 400 — this field just surfaces that same state proactively on load, computed via a single extra query (`BirthdayWish.find({ sender, year, recipient: In(todaysBirthdayIds) })`) rather than the client only discovering it reactively after a failed second send.

**Routes prefix:** `/birthday`

### Membership Anniversary Module

Background-only (no controller/routes) — automated congratulatory announcement + email when a member reaches a
join-date anniversary, keyed off `Member.dateJoinedChurch` rather than `createdAt` (a member's system-account
creation date can differ from their actual join date, e.g. for admin-backfilled historical records).
Structurally a clone of the Birthday Module's mechanics rather than a new pattern: same lock-key/catch-up/daily-cron
shape (`@Cron('0 6 * * *')`, `onApplicationBootstrap` catch-up for missed runs, Redis lock to prevent double-sends
across instances), same `memberGreetedYear`-style dedup marker (`Member.anniversaryGreetedYear`, mirrors
`birthdayGreetedYear`). Differs from Birthday in one way: greeting delivery goes through
`AnnouncementService.createSystemAnnouncement()` (ALL-audience, push-notifies automatically) rather than Birthday's
older direct-repository-insert pattern, which predates that helper and doesn't push-notify.

**Eligibility:** `ACTIVE` members with a non-null `dateJoinedChurch` whose join month/day matches today, excluding
the join year itself (a member who joined today this year has "0 years," not an anniversary), and not already
greeted this calendar year.

**Email:** `membership-anniversary` template, `EmailCategory.MEMBERSHIP_ANNIVERSARY` (togglable via
`EMAIL_MEMBERSHIP_ANNIVERSARY_ENABLED`, default `true`, same convention as every other email category).

**Audit:** `MEMBERSHIP_ANNIVERSARY_GREETED` per member greeted (`metadata: { years }`).

### Dashboard Module

Aggregated data endpoints per role. Does not store data — assembles from other services.

**Routes prefix:** `/dashboard`

### Sunday School Module

Manages permanent Sunday School classes, class membership, and session-based attendance. Classes have no graduation —
members stay assigned indefinitely. Both teachers and enrolled students can mark attendance, but self-mark requires that
a staff member has opened the window on the session.

**Key flows:**

- Admin or SS-dept worker creates a class and assigns a teacher (optional).
- Members are assigned to a class via the members sub-resource. Assignments are permanent until explicitly removed.
- A session is created per class per date. Staff open a timed self-mark window via `PATCH /sessions/:id/open` (body: `{ closesInMinutes: 5–480 }`); members may self-mark only while `selfMarkClosesAt` is non-null and in the future. Staff can close the window early via `PATCH /sessions/:id/close`. No cron job required — the window expires automatically at query time.
- Bulk marking is used by teachers/staff; self-mark (`POST /sunday-school/sessions/:id/checkin`) is used by individual
  members.

**Lesson material (`SundaySchoolSession.documentUrl`):** optional link to that date's lesson material (Google Drive,
PDF link, etc.) — validated as a URL (`@IsUrl()`), settable only at session creation (`POST .../sessions`), same as
the pre-existing `notes` field — neither has an update-after-creation route. Set via either the worker/teacher
controller (mobile) or the admin controller; both share `CreateSundaySchoolSessionDto`. Surfaced as "View Lesson
Material" on the teacher's roster panel (`discuva-member` mobile) and via a small link icon in the admin sessions table.

**Routes prefix:** `/sunday-school` (worker/member routes) and `/admin/sunday-school` (admin routes)

**Admin controller (`/admin/sunday-school`):** All routes require `AdminGuard`. Provides the same class and session management as the worker controller but bypasses the `requireSundaySchoolAuth` check so that admins can manage any class regardless of department or teacher assignment.

### Tithe Module

Enables the finance team to manage bank accounts, upload Excel tithe payment sheets, and review member proof submissions. Members can view their own records, request PDF statements, and submit proof of offline payments.

**Account management:** The finance team maintains a list of tithe bank accounts (`TitheAccount`) — one per physical bank account. Each account has its own currency (ISO 4217), enabling the church to accept NGN, USD, and any other currency simultaneously. Members and workers can browse active accounts at `GET /tithes/accounts`. Admins manage accounts via:

| Method | Route | Permission | Notes |
|--------|-------|------------|-------|
| `POST` | `/admin/tithes/accounts` | `FINANCE_WRITE` | Create account. 409 if `(accountNumber, bankName)` already exists. |
| `GET` | `/admin/tithes/accounts` | `FINANCE_READ` | Lists all accounts (active and inactive), ordered by `currency ASC, bankName ASC`. |
| `PATCH` | `/admin/tithes/accounts/:id` | `FINANCE_WRITE` | Update account details. |
| `GET` | `/admin/tithes/accounts/:id/summary` | `FINANCE_READ` | Aggregate totals for one account. See below. |

**Account summary (`GET /admin/tithes/accounts/:id/summary`):** Accepts optional `fromMonth` / `toMonth` (`YYYY-MM`) query params and returns:
```json
{
  "account": { "...": "TitheAccount fields" },
  "fromMonth": "2026-01",
  "toMonth": "2026-06",
  "bulkTotal": 500000,
  "bulkCount": 45,
  "proofTotal": 75000,
  "proofCount": 8,
  "grandTotal": 575000
}
```
`bulkTotal`/`bulkCount` aggregate confirmed `TitheRecord` rows whose batch is linked to this account. `proofTotal`/`proofCount` aggregate `CONFIRMED` `TithePaymentProof` rows linked directly to this account.

**Upload flow:**
1. Finance admin selects a `TitheAccount` and uploads `.xlsx` via `POST /admin/tithes/upload` (multipart, field name `file`; body field `titheAccountId`).
2. Service validates that the account exists and is active, validates required columns (`Email`, `Amount`, `Payment Date`), and returns 400 immediately for invalid input.
3. A `TitheUploadBatch` record is created (linked to the account, with parsed rows stored as JSONB for safe requeue) and a Bull job (`tithe` queue, `process-batch` job) is dispatched with `attempts: 3, removeOnFail: false`.
4. The processor runs asynchronously inside a **database transaction**: matches each row to a member by email (case-insensitive), creates `TitheRecord` for matches, `TitheUnmatchedRecord` for no-match rows, and `TitheDisputeRecord` for rows that duplicate an existing record by `(memberId, paymentDate, amount)`. The transaction ensures idempotent retries — a mid-batch failure rolls back all inserts so the next attempt starts from a clean slate.

**Failed batch requeue:** If a batch reaches `FAILED` status, a finance admin can requeue it via `POST /admin/tithes/batches/:id/requeue`. The stored `rows` JSONB field is used to reconstruct the job without re-uploading the file.

**Excel template:** Three-sheet workbook — `Tithe Template` (headers only), `Instructions`, `Sample`. Served at `GET /admin/tithes/template`.

**Admin records list:** `GET /admin/tithes/records` returns all confirmed tithe records (paginated, `FINANCE_READ`). Supports the following query params:

| Param | Type | Description |
|---|---|---|
| `memberId` | UUID | Filter to one specific member |
| `departmentId` | UUID | Filter to tithes paid by workers in that department |
| `fromMonth` | `YYYY-MM` | Start of payment date range (inclusive) |
| `toMonth` | `YYYY-MM` | End of payment date range (inclusive, last day of month) |
| `search` | string | Wildcard match on member firstname, lastname, or email |
| `accountId` | UUID | Filter to records tied to a specific tithe account |
| `page` / `limit` | int | Pagination (default 1 / 20) |

`GET /admin/tithes/records/download` accepts the same filters (no pagination) and returns an `.xlsx` file with columns: Member Name, Email, Account (bank name), Currency, Amount, Payment Date, Sender Bank, Reference.

**Member visibility:** Members view their own tithes at `GET /tithes/me` (loads `batch.titheAccount` and `givingOption` relations so the frontend can label each row correctly — see "Giving Statement" below) and request a PDF statement emailed to them at `POST /tithes/me/statement/send` (`TitheService.emailGivingStatement` — renamed from `emailTitheStatement`/`/tithes/me/download`; the route itself is unchanged since it's an internal detail no member ever sees, only the method and everything member-visible were renamed). Optional query params `fromMonth` and `toMonth` (format `YYYY-MM`) filter the records included in the statement and display a period range in the PDF (e.g. `?fromMonth=2026-01&toMonth=2026-06`). If only one bound is supplied the other is open-ended. Returns `{ message, recordCount }` (200 OK) — previously returned `204 No Content`, which meant the frontend's success message could never actually render since HTTP clients discard the body of a 204 regardless of what the server sends. The email body itself (not just the attached PDF) also states the period in prose (`formatStatementPeriod()` — "January 2026 – June 2026" / "March 2026 onwards" / "Up to June 2026") and the record count, falling back to "all N giving records on file" when no range was requested, so the email is accurate on its own without needing to open the PDF.

**Giving Statement — not just a "Tithe Statement" (added 2026-09-01):** the emailed PDF is called "Giving Statement," not "Tithe Statement" — `TitheRecord` already holds every type of online/manual giving (Tithe, Offering, General Giving, a `GivingOption` like "Building Fund"), and calling the whole document "Tithe Statement" wrongly implied it covered only one type. `emailGivingStatement` also merges in the member's CONFIRMED `PledgeContribution`s for the same date range — pledge-designated gifts live in a separate table (see Finance Module's Pledge section) and were previously invisible on this statement entirely, understating a member's real total giving. Each line gets a `Type` column via one shared rule (also used by the frontend history list, see `discuva-member`'s `giving.tsx`):
- A `PAYMENT_GATEWAY` `TitheRecord` with `givingOption` set → the option's name (e.g. "Building Fund").
- A `PAYMENT_GATEWAY` `TitheRecord` with no `givingOption` → "General Giving".
- A `MANUAL_PROOF` `TitheRecord` matched to a `TitheAccount`, or with a `bankName` on file → that account/bank name.
- A `MANUAL_PROOF` `TitheRecord` with neither → "Tithe" (manual bank-proof reconciliation has always specifically meant tithes; `GivingOption` designation only ever applies to online checkout).
- A `PledgeContribution` → "Pledge: {campaign name}".

`Offering` (`finance_offerings`) is deliberately excluded — it has no member relation (anonymous in-service collection), so it can't be attributed to an individual's personal statement. This is a different feature from the annual `POST /finance/me/giving-statement/send` (summary-only, previous calendar year, see Finance Module below) — that one already merged `TitheRecord` + `PledgeContribution` totals, just without line items or a member-triggered range.

**Tithe payment proof:** Members and workers submit proof of an offline tithe payment via `POST /tithes/proof` (multipart, field: `file`, max 2 MB; body field `titheAccountId` — the account they paid into). The file is uploaded to Cloudinary and a `TithePaymentProof` record is created with status `PENDING` and `expiresAt` set to `TITHE_PROOF_EXPIRY_DAYS` days from submission (default 90). Finance team admins review proofs at `GET /admin/tithes/proofs` and can `CONFIRM` or `DECLINE` each one. Confirming or declining triggers an email to the member that includes the bank name and account-level currency. A daily cron at `03:00` (church-local time, see [Timezone](#timezone)) (with distributed Redis lock `lock:tithe-proof-cleanup`) finds all expired proofs (`expiresAt ≤ now`), deletes each file from Cloudinary using the stored `publicId` + `resourceType`, and removes the DB rows.

**Routes prefix (admin):** `/admin/tithes`  
**Routes prefix (member):** `/tithes`

### Finance Module

Full double-entry accounting system for the church. All financial data is fund-scoped (RESTRICTED / UNRESTRICTED). Every posted entry has balanced debit and credit lines; the balance is enforced at the service layer before posting, and a DB-level `CHECK (current_balance >= -0.01)` on `finance_accounts` is a last-resort safety net.

**Core concepts:**

| Concept | Description |
|---|---|
| **Fund** | RESTRICTED or UNRESTRICTED pool of money. Every account, offering, budget, and pledge belongs to a fund. Back-office accounting data only — never exposed to members directly (see GivingOption). |
| **GivingOption** (`finance_giving_options`) | Donor-facing "what is this gift for" selector for online giving-checkout (Tithe, Offering, General Giving, Building Fund, etc.) — admin-managed (`admin/finance/giving-options`, `FINANCE_READ`/`FINANCE_WRITE`), member-readable (`GET finance/giving-options`, active only). Each option carries an optional `fund` for accounting purposes only — a member never sees the fund's id/type, matching how `PledgeCampaign` already surfaces only `fundName` as a display string, not raw `Fund`. A `TitheRecord` created from a `PAYMENT_GATEWAY` checkout gets `givingOption` set when the member picked one; `null` means "General Giving," no forced default row. |
| **AccountingPeriod** | A calendar month (year + month). Entries can only be posted to OPEN periods. Closing a period is irreversible by design (only admins with `FINANCE_RECONCILE` can close or reopen). |
| **Chart of Accounts** | `finance_accounts` table. Each account has an optional unique `code` (e.g. `1001`), a type (ASSET / LIABILITY / INCOME / EXPENSE), subtype, normal balance (DEBIT or CREDIT), and an optional fund assignment. `code` is nullable but unique when provided — 409 if a duplicate code is submitted. |
| **JournalEntry** | The root transaction record. Must be BALANCED (sum of debits = sum of credits) before posting. Created as `PENDING_APPROVAL`; a separate admin with `FINANCE_APPROVE` (who is not the creator — segregation of duties) approves and posts it. |
| **JournalEntryLine** | One debit or credit line on a journal entry. Linked to an account. `journal_entry_id` and `account_id` are both indexed. |
| **JournalEntryLink** | Polymorphic association table attaching a journal entry to members, departments, service events, external payees, or finance requests. Stored as a separate table to preserve FK integrity and allow multiple associations per transaction. `linkType: FINANCE_REQUEST` uses a bare `financeRequestId` UUID column rather than a relation, deliberately avoiding an entity import from the separate `finance-request` module. |
| **ExternalPayee** | Tracks global church remittances, vendors, utilities, contractors, government bodies. |
| **Offering** | Records Sunday cash + expected transfer amounts. Reconciled separately by finance team. `fund_id` is indexed. |
| **Budget** | Scoped to an account + fund. Actuals computed at query time from posted entries. |
| **PledgeCampaign / Pledge** | Campaign-level targets and per-member pledge commitments. |
| **RecurringEntry** | Template for entries that repeat weekly / monthly / quarterly. A daily scheduler generates draft entries for due recurring templates. |
| **PettyCashReplenishment** | Request/approve flow for topping up petty cash accounts. Self-approve is blocked. Approving creates a `PENDING_APPROVAL` journal entry (debit `toCashAccount`, credit `fromAccount`) with idempotency key `petty-cash-replenishment:{id}`. |
| **BankImportProfile** | Configurable CSV parsing profile. Stores column indices, date format, delimiter, and amount convention (SIGNED, SEPARATE_COLUMNS, or AMOUNT_WITH_TYPE). One profile can be flagged `isDefault`. |

**Race condition protection:**

- `SELECT FOR UPDATE` (pessimistic locking) on `finance_accounts` rows during approval and void operations — prevents concurrent writes from losing updates.
- Unique `idempotency_key` column on `finance_journal_entries` — duplicate submissions return `409 Conflict`.
- `CHECK (current_balance >= -0.01)` DB constraint — last-resort guard.

**Void / reversal pattern:** Voiding a posted entry does NOT delete it. A new reversing entry (equal and opposite lines) is created with `entryType = REVERSAL` and both entries remain in the ledger. The original entry status becomes `VOIDED`. Voiding an entry in a CLOSED accounting period throws `400 Bad Request`.

**Tithe virtual accounts — removed.** A dedicated-bank-account-per-member giving mechanism was scaffolded (entity,
stub service, webhook controller) but never implemented beyond `NotImplementedException` on every method, and the
member app's card was labeled "Coming Soon." Deleted entirely rather than finished — replaced by the tenant-owned
Giving Checkout flow below.

### Giving Checkout (Tenant-Owned, BYOK) — `src/giving-checkout/`

A member pays the church directly via a hosted checkout page — Paystack, Flutterwave, Korapay, or Stripe, using the
*church's own* merchant credentials, never a platform account. Pure BYOK, same shape as Communication Providers: no
platform default exists, so the "Give via Checkout" option is simply absent from the member app until a tenant
configures and activates one provider.

**Provider abstraction (`src/giving-checkout/interface/giving-provider.interface.ts`):**

```ts
type GivingProviderCredentials = Record<string, string>; // e.g. Paystack's { secretKey }, Stripe's { secretKey, webhookSecret }

interface IGivingProvider {
  readonly providerName: string;
  createCheckoutSession(params: {
    amountCents: number; currency: string; payerEmail: string; payerName: string;
    reference: string; successUrl: string; cancelUrl: string; credentials: GivingProviderCredentials;
  }): Promise<{ checkoutUrl: string }>;
  verifyAndParseWebhook(rawBody: Buffer, signatureHeader: string, credentials: GivingProviderCredentials): NormalizedGivingEvent;
}
```

`GivingProviderRegistryService` (same shape as `PaymentProviderRegistryService`/`SmsProviderRegistryService`) holds
all four vendors live simultaneously; `GivingCheckoutService` resolves which one to use per call from the tenant's
active `TenantGivingProviderConfig.providerId`. Credentials are always passed as a call parameter, never injected
from `ConfigService` — there is no platform merchant account behind any of these.

**The four providers** (`src/giving-checkout/provider/`) —

| `providerId`  | Class                     | Credential shape                    | Amount unit sent to vendor          |
|---------------|----------------------------|--------------------------------------|---------------------------------------|
| `paystack`    | `PaystackGivingProvider`   | `{ secretKey }`                     | Smallest unit (kobo) — `amountCents` as-is |
| `flutterwave` | `FlutterwaveGivingProvider`| `{ secretKey, secretHash }`         | Major unit (naira) — `amountCents / 100` |
| `kora`        | `KoraGivingProvider`       | `{ secretKey }`                     | Major unit (naira) — `amountCents / 100` |
| `stripe`      | `StripeGivingProvider`     | `{ secretKey, webhookSecret }`      | Smallest unit (cents) — `amountCents` as-is |

Webhook signature verification differs per vendor: Paystack HMAC-SHA512 over the raw body
(`x-paystack-signature`); Flutterwave a direct shared-secret string compare (`verif-hash`, not an HMAC); Korapay
HMAC-SHA256 over just the `data` object, not the full envelope (`x-korapay-signature`); Stripe HMAC-SHA256 over
`${timestamp}.${rawBody}` using a signing secret distinct from the API key, header format `t=…,v1=…`
(`Stripe-Signature`). Each is entirely self-verifying — none of the shared "never trust the payload" discipline
below depends on which scheme a given vendor uses.

**Entities — all control-plane** (`public`, never a `search_path` target — same reasoning as
`TenantCommunicationProviderConfig`/`BillingCheckoutSession`: the inbound webhook has no Host header/subdomain to
resolve a tenant from, only a `:tenantId` path param, so these must be resolvable with zero tenant (schema) context):

- **`GivingProvider`** (`giving_providers`) — platform-wide catalog, mirrors `CommunicationProvider`.
- **`TenantGivingProviderConfig`** (`tenant_giving_provider_configs`) — one row per (tenant, provider),
  `credentialsEncrypted` (jsonb, `select: false`, `EncryptionService` AES-256-GCM — same encryption as
  Communication Providers), `isActive`. **Only one provider active per tenant at a time**, enforced the identical
  way as Communication Providers: `TenantGivingProviderService.upsertConfig()`/`setActive()` (when activating) run
  inside a transaction that also deactivates every other config row for that tenant.
- **`GivingCheckoutSession`** (`giving_checkout_sessions`) — mirrors `BillingCheckoutSession` exactly: primary
  keyed by the provider's own reference, recorded at checkout-*initiation* time (before the member ever reaches the
  provider's hosted page) — the webhook only ever confirms/denies a session this row already describes, never a
  source of truth for amount/member/tenant identity itself. `memberId`/`givingOptionId`/`pledgeId`
  are plain UUID columns, not FK-enforced relations — `Member`/`GivingOption`/`Pledge` all live in
  the tenant's own schema, which a public-schema table can't foreign-key into. `givingOptionId` and `pledgeId` are
  mutually exclusive (see below). A legacy `titheAccountId` column still exists on the table but is unused —
  checkout no longer lets a member pick a `TitheAccount` (see below).

**Checkout initiation (`GivingCheckoutService.initiateCheckout`, member-facing, normal in-app request — tenant
context already resolved by `TenantMiddleware`):** resolves the tenant's active config (cached 300s per tenant,
invalidated on write — identical pattern to `SmsCredentialResolverService`, joined against `GivingProvider` and
requiring `provider.isActive = true` too, not just the tenant's own config row — see "Giving Providers:
deactivation has real consequences" below), throws `403 GIVING_PROVIDER_NOT_CONFIGURED` if none is active, looks
up the member for email/name, resolves currency from `CURRENCY_CODE` (checkout is single-currency per tenant —
there is no per-transaction currency picker), generates a `giving_{uuid}` reference, and calls the resolved
provider. Saves a `PENDING` `GivingCheckoutSession` row before returning `{ checkoutUrl }`.

**Why checkout has no `TitheAccount`/currency picker (unlike the manual proof-of-payment flow, which does):** a
`TitheAccount` is one of the church's real named bank accounts, meaningful only when a member is telling the
system which one they manually deposited into for reconciliation (`ProofOfPaymentForm`). Gateway checkout never
deposits into a specific `TitheAccount` — the money always settles to the tenant's configured BYOK merchant
account for that provider — so a dropdown of account names in the checkout flow looked like it controlled where
the money went when it never did; it only silently overrode the charged currency. Removed entirely rather than
kept as "informational."

**Giving purpose designation — `givingOptionId` / `pledgeId` (mutually exclusive):** a member may optionally
designate the payment at checkout, never both at once (`400 Bad Request` if both are given):
- `givingOptionId` — validated against the tenant's active `GivingOption`s (`404` if missing/inactive). On webhook
  success, the resulting `TitheRecord.givingOption` is set to it.
- `pledgeId` — validated as one of *this member's own* `Pledge`s with `status = ACTIVE` (`404` if not found/not
  theirs, `400` if not active — checkout never auto-creates a pledge on the fly). On webhook success, **no
  `TitheRecord` is created at all** — instead `PledgeService.recordConfirmedContribution()` records a
  `PledgeContribution` with `status = CONFIRMED` directly (skipping the `PENDING`/admin-review step
  `submitContribution()` uses for member-self-reported payments, since the webhook has already verified the money
  actually cleared) and runs the same pledge-auto-complete check `confirmContribution()` does. This keeps online
  giving and pledge fulfillment as genuinely separate ledgers — see TitheRecord's own note above.

Neither field set → the resulting `TitheRecord.givingOption` is `null`, displayed as "General Giving."

**Giving Providers: deactivation has real consequences (added 2026-08, same pass as Communication Providers'
equivalent above).** `PlatformGivingProviderService.setActive()` (`PATCH /platform/giving-providers/:id`) mirrors
`PlatformCommunicationProviderService.setActive()` exactly, minus the channel dimension:

1. **`TenantGivingProviderService.listProviders()`** excludes an inactive provider from the catalog a tenant can
   newly select, unless that tenant already has a config against it (kept visible — `discuva-admin`'s giving
   providers page renders one row per catalog entry, same as its communication-providers page).
2. **`GivingCheckoutService.resolveActiveConfig()`** now joins `GivingProvider` and requires `provider.isActive =
   true`, not just `config.isActive`. A deactivated provider genuinely stops accepting new checkout initiations.
   **Deliberately not applied to `handleWebhook`** — an in-flight checkout that already charged the member on the
   provider's own side must still complete and credit the church's `TitheRecord` even if the provider gets
   deactivated in the interim; rejecting that webhook would take the member's money without crediting it anywhere,
   a worse outcome than letting one already-charged transaction finish.
3. **`setActive()`** invalidates the 300s cache immediately for every tenant with an active config against the
   provider (`givingProviderCacheKey`, extracted as a shared utility for the same reason
   `communicationProviderCacheKey` was — two places already computed the identical string independently) and
   emails those tenants via `TenantBroadcastService.notifyTenants()`, targeted at only the affected tenants.

A tenant's own `TenantGivingProviderConfig` row is never touched by any of this.

**Webhook handling (`GivingCheckoutService.handleWebhook`, `POST /webhooks/giving/:tenantId/:provider`,
`@Public()`, excluded from `TenantMiddleware`):** no CLS/tenant context exists at all when this fires — `tenantId`
comes straight from the path param. Looks up that tenant's *own* active config for `:provider` first (verified
credentials before anything else is trusted), decrypts, resolves the `IGivingProvider`, and calls
`verifyAndParseWebhook()` (throws on a bad signature). A non-`charge.succeeded` event marks the matching session
`FAILED` and returns — never an error response, so the provider doesn't retry forever. On success: row-locks the
`PENDING` `GivingCheckoutSession` by the event's own reference (idempotent against webhook redelivery — a second
delivery for an already-`COMPLETED` session finds nothing to lock, safe no-op), flips it to `COMPLETED`, looks up
the `Tenant` row for its `schemaName`, then `runInTenantContext()`s into that tenant's own schema purely to write
the resulting `TitheRecord` (`source: PAYMENT_GATEWAY`, `externalReference` = the session id, `paymentChannel` =
the provider id, `batch: null` — same "webhook-created records have no batch" shape as reconciliation-imported
rows). This is the only place SMS/email BYOK's "resolve credentials, dispatch to the right vendor class" pattern
and the tenant-context-entry pattern (normally only seen in Bull processors, via `runInTenantContext`) are combined
in the same request.

**Routes:**

| Method | Path                                       | Auth                     | Permission        | Description |
|--------|----------------------------------------------|---------------------------|--------------------|--------------|
| GET    | `/finance/giving-providers`                 | `AdminGuard`, tenant-scoped | `TITHE_READ`      | `{ tenantId, catalog, ownConfigs }` — `ownConfigs` never includes credentials. `tenantId` lets the frontend build this tenant's own webhook URL (`{apiHost}/v1/webhooks/giving/:tenantId/:provider`, no subdomain — see webhook route below) to hand to Paystack/Flutterwave/etc, since nothing else on this tenant-scoped surface otherwise exposes the tenant's own id to itself |
| PUT    | `/finance/giving-providers/:providerId`     | `AdminGuard`, tenant-scoped | `TITHE_WRITE`     | Body `{ credentials }` — upserts and activates, deactivating any other active provider |
| PATCH  | `/finance/giving-providers/:providerId`     | `AdminGuard`, tenant-scoped | `TITHE_WRITE`     | Body `{ isActive }` — enable/disable without touching stored credentials |
| GET    | `/finance/giving/checkout/provider`         | Member JWT                | —                  | `{ providerId, providerName } \| null` — whether to show "Give via Checkout" at all |
| POST   | `/finance/giving/checkout`                  | Member JWT                | —                  | Body `{ amountCents, givingOptionId?, pledgeId?, successUrl, cancelUrl }` — returns `{ checkoutUrl }` |
| POST   | `/webhooks/giving/:tenantId/:provider`      | None (per-vendor signature) | —                | Provider webhook — creates a `TitheRecord` on a verified successful charge |

Both `finance/giving-providers` and `finance/giving/checkout` are gated behind `@RequiresModule('tithe')` —
disabled entirely if a church has turned off the Tithe & Giving module.

`discuva-admin`'s Giving Providers page shows a read-only, copyable "Webhook URL" field per provider (inside the
same Configure/Edit Credentials panel as the credential inputs) — built client-side from `tenantId` (now returned
above) and `NEXT_PUBLIC_API_URL`, deliberately **not** `getTenantApiBaseUrl()`'s subdomain-prefixed variant, since
the webhook route itself has no subdomain to resolve a tenant from.

**Platform-admin visibility (`PlatformGivingProviderService`, `PlatformAnalyticsService.getGiving`):** the platform
operator's own "full overview" across every tenant, mirroring Communication Providers' and Billing's existing
platform-support surfaces —

| Method | Path                                        | Permission     | Description |
|--------|-----------------------------------------------|-----------------|--------------|
| GET    | `/platform/giving-providers`                 | `BILLING_READ`  | List the platform-wide giving-provider catalog. |
| POST   | `/platform/giving-providers`                 | `BILLING_WRITE` | Register a new provider — `{ id, name }`. |
| PATCH  | `/platform/giving-providers/:id`             | `BILLING_WRITE` | `{ isActive }` — activate/deactivate. See "Giving Providers: deactivation has real consequences" above. |
| GET    | `/platform/tenants/:id/giving-providers`     | `BILLING_READ`  | This tenant's configured giving provider(s) and active status — never credentials. Reuses `BILLING_READ` (giving-checkout is a money concern) rather than adding a dedicated permission for one lookup — same reasoning now extended to the three routes above. |
| GET    | `/platform/analytics/giving`                 | `ANALYTICS_READ`| `?period=&months=` — `{ period, totals, byProvider, byTenant, trend }`, every array grouped by `currency` — completed sessions only, **never blended across currencies** (a Stripe/USD tenant summed against a Paystack/NGN one would be meaningless). `totals` is all-time; `trend` is windowed by `months`. |

`PlatformAnalyticsService.getAdoption()` also gained `givingAdoption: ChannelAdoption` (distinct-tenant count with
an active `TenantGivingProviderConfig`, no `channel` filter needed unlike SMS/email since giving-checkout has only
the one implicit channel) — same shape as the existing `smsAdoption`/`emailAdoption`.

**Env vars:** none — pure BYOK, no platform-default credentials for any of the four vendors, so nothing is
env-driven here at all (contrast SMS's `TERMII_BASE_URL`, which stays env-driven only because it's infrastructure,
not a secret — none of these four vendors have an equivalent fixed-but-non-secret host worth externalizing).

**Not built yet:** Kora/Stripe integrations are written against each vendor's documented API shape but have not
been exercised against live sandbox credentials (same "documented reasoning, not guessed silently" caveat already
attached to Paystack/Flutterwave's own subscription-webhook gaps elsewhere in this doc) — worth a live smoke test
before a tenant relies on either in production. discuva-admin's Giving Providers settings page, discuva-member's
"Give via Checkout" card, and discuva-platform's tenant-detail "Giving Provider" panel + analytics "Giving Checkout"
section are all built.

**CSV reconciliation (bank statement import):**

Bank Import Profiles (`finance_bank_import_profiles`) make CSV parsing bank-agnostic. A profile stores the delimiter, number of header rows to skip, column indices for date/narration/amount, the date format (`YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY`, `MM/DD/YYYY`), and the amount convention:

| Convention | Description |
|---|---|
| `SIGNED` | Single column; negative value = debit, positive = credit |
| `SEPARATE_COLUMNS` | Separate debit and credit columns; whichever is non-zero wins |
| `AMOUNT_WITH_TYPE` | Amount column + type indicator column (e.g. `DR`/`CR`) configurable per profile |

One profile can be flagged `isDefault`. Upload accepts optional `?profileId` query param; if omitted the default profile is used. A 400 error with `{firstFailure: {row, column, expected, found}}` is returned synchronously (before any job is created) if the file cannot be parsed by the selected profile — books are never affected by an unrecognisable file.

`PATCH /admin/finance/reconciliation/jobs/:jobId/rows/:rowId/confirm` stages a row by linking it to a ledger account (`confirmedAccount`). `POST /admin/finance/reconciliation/jobs/:id/post-confirmed` creates one `PENDING_APPROVAL` journal entry per confirmed row using `bankAccountId` + `accountingPeriodId` from the request body. Each row gets idempotency key `reconciliation-row:{rowId}`; re-calling the endpoint is safe.

**Posting is batched on the read side, per-row on the write side (deliberately).** `ReconciliationService.postConfirmedRows` resolves which rows are already posted in one batched query up front (instead of one idempotency lookup per row), but each row's actual posting (journal entry + 2 lines + row status update) still runs in its own transaction. This is intentional, unlike the fully-batched bulk operations elsewhere in the codebase: a bad row in a bank-import batch (e.g. a stale account reference) shouldn't block the rest of the batch from posting, so rows remain independent units of work. The `idempotency_key` column's DB-level `UNIQUE` constraint — not the batched pre-check — is the actual guard against double-posting under a race (e.g. the endpoint invoked twice concurrently); a unique-violation on insert is caught and treated the same as "already posted."

A row fingerprint (`sha256` of date+narration+amount+creditDebit) prevents duplicate rows within the same job. A transaction fingerprint (`sha256` of date+amount+creditDebit) prevents the same transaction appearing across different upload jobs.

Admin-configurable profile endpoints (`FINANCE_RECONCILE` permission):
- `POST /admin/finance/bank-import-profiles` — create profile
- `GET /admin/finance/bank-import-profiles` — list all profiles
- `GET /admin/finance/bank-import-profiles/:id` — get one profile
- `PATCH /admin/finance/bank-import-profiles/:id` — update profile
- `GET /admin/finance/bank-import-profiles/:id/template` — download a pre-filled CSV template with correct column headers and two sample rows for the profile

**Annual giving statements:** Gated by `ANNUAL_GIVING_STATEMENT_ENABLED` (default `false`). When enabled, a cron fires on January 1st at 08:00 (with distributed Redis lock) and emails each active member a summary of their total giving for the previous year, using the `annual-giving-statement.html` template. Members can also trigger their own statement on demand via `POST /finance/me/giving-statement/send` regardless of the env var flag; this endpoint now returns a `message` field describing the outcome (sent, or "no recorded giving for `{year}` yet").

`fetchMemberTotals()` sums directly from the actual giving records — `TitheRecord` (all of a member's tithes in the date range) plus `PledgeContribution` with `status = CONFIRMED` (joined through `Pledge` for `member_id`) — merged in-memory by member. This intentionally does **not** go through `finance_journal_entry_links`: that link table is only ever populated by fully-manual journal entry creation (`JournalEntryService`) — bank reconciliation, offering auto-journal, and tithe recording never create one — so a link-based total would be 0 or wildly incomplete for almost every member. `GET /admin/finance/reports/member-giving` (an admin-facing report, distinct from this member-facing statement) still uses the `finance_journal_entry_links` path deliberately — it's a strict "show me actual posted GL lines linked to this member" audit view, not a giving total, and carries the same underlying limitation by design until/unless tithes and offerings get their own automatic journal-linking.

The `annual-giving-statement.html` template was also silently rendering with a blank church name/address and no currency symbol — it referenced `{{ churchName }}`/`{{ churchAddress }}` (camelCase) and `{{ currency }}`, but `EmailQueueService.compileTemplate()` only ever injects `church_name`/`church_address`/`logo_url` (snake_case), and the scheduler never passed `currency`. Handlebars renders unresolved variables as an empty string, not literal `{{ }}` text, so this went unnoticed. Fixed: template now references the snake_case globals, and both `sendForMember()` and `run()` pass `currency: configService.get('CURRENCY_CODE')`.

**Recurring entry scheduler:** Runs daily at 08:00 (Redis lock), looping per active tenant via `forEachActiveTenant()`. For each active `RecurringEntry` where `nextDueAt ≤ now`, generates a `PENDING_APPROVAL` journal entry in the current month's open accounting period and advances `nextDueAt` to the next due date. The journal entry creation, line saves, and `nextDueAt` update run against the ambient per-tenant transaction (`this.txHost.tx`, already holding the correct `SET LOCAL search_path`) rather than opening a fresh `dataSource.transaction()`, which would silently write to the wrong schema — each entry is still wrapped in its own Postgres `SAVEPOINT`/`RELEASE`/`ROLLBACK TO SAVEPOINT` so one entry's failure rolls back in isolation instead of aborting the rest of that tenant's batch.

**Vehicle-specific asset fields:** Two new optional fields added to `assets` table:
- `insurance_expiry` (date) — insurance policy expiry date
- `roadworthiness_expiry` (date) — roadworthiness certificate expiry date

Eight notification-timestamp columns track when each alert was last sent (to prevent repeat alerts on re-runs):
`insurance_notified_30_days_at`, `insurance_notified_14_days_at`, `insurance_notified_7_days_at`, `insurance_notified_1_day_at`, and the equivalent four for `roadworthiness_`.

**Vehicle expiry alert scheduler:** Runs daily at 08:00 (with distributed Redis lock). For each asset that has an `insuranceExpiry` or `roadworthinessExpiry` value, alerts are dispatched at **30, 14, 7, and 1 day(s)** before expiry. Each threshold is tracked by its own timestamp column; once set it prevents a duplicate alert. Recipients: admins with `ASSET_MAINTENANCE_ALERT` permission. Email template: `asset-vehicle-expiry-alert.html`.

**Permissions added:**

| Permission | Scope |
|---|---|
| `FINANCE_APPROVE` | Approve journal entries and petty cash replenishments (cannot be the creator) |
| `FINANCE_RECONCILE` | Upload CSV bank statements, confirm/skip reconciliation rows, close/reopen accounting periods, reconcile offerings |
| `FINANCE_REPORT` | Access all 8 finance reporting endpoints |
| `TITHE_READ` | View individual member tithe records, giving history, annual giving statements |
| `TITHE_WRITE` | Manage tithe accounts and this church's giving-checkout provider credentials |

**Routes prefix (admin):** `/admin/finance/...`

| Resource | Prefix |
|---|---|
| Funds | `/admin/finance/funds` |
| Giving options | `/admin/finance/giving-options` |
| Accounting periods | `/admin/finance/accounting-periods` |
| Chart of accounts | `/admin/finance/accounts` |
| External payees | `/admin/finance/external-payees` |
| Journal entries | `/admin/finance/journal-entries` |
| Offerings | `/admin/finance/offerings` |
| Budgets | `/admin/finance/budgets` |
| Pledge campaigns + pledges | `/admin/finance/pledges` |
| Pledge contribution review queue | `/admin/finance/pledges/contributions` |
| Recurring entries | `/admin/finance/recurring-entries` |
| Petty cash | `/admin/finance/petty-cash` |
| Reconciliation (CSV upload) | `/admin/finance/reconciliation` |
| Bank import profiles | `/admin/finance/bank-import-profiles` |
| Reports | `/admin/finance/reports` |

**Reporting endpoints** (`FINANCE_REPORT` required, `TITHE_READ` for member-giving):

| Endpoint | Description |
|---|---|
| `GET /admin/finance/reports/income-expense` | Income & expenditure by account, filter by `periodId` + `fundId` |
| `GET /admin/finance/reports/cash-flow` | Line-by-line cash movement for an account (`accountId` required) |
| `GET /admin/finance/reports/trial-balance` | All accounts with current balances. Without `periodId` returns `currentBalance` from each account row. With `periodId` computes period-specific balances by summing posted journal lines within that period only — accounts with no activity in the period appear with balance 0. |
| `GET /admin/finance/reports/fund-balance` | Per-fund total balance |
| `GET /admin/finance/reports/account-ledger` | Full ledger for an account with date range filter |
| `GET /admin/finance/reports/budget-actuals` | Budget vs actual spend (`budgetId` required) |
| `GET /admin/finance/reports/pledge-summary` | Pledge totals for a campaign (`campaignId` required) |
| `GET /admin/finance/reports/member-giving` | Giving history for a member (`memberId` required, `TITHE_READ`) |
| `GET /admin/finance/reports/dashboard` | Finance dashboard snapshot: MTD income/expenses, pending entries, budget utilisation, outstanding pledges |

**`cash-flow`, `account-ledger`, `member-giving` default to a bounded ~365-day lookback.** Omitting `fromDate` previously scanned every posted journal line ever recorded against the account/member — each now defaults `fromDate` to 365 days ago (via `FinanceReportService.defaultReportFromDate()`) when the caller doesn't supply one, and echoes the effective `fromDate`/`toDate` actually used back in the response so a caller can tell a default was applied. `member-giving` skips the default entirely when `periodId` is given, since a period already bounds the query. Passing an explicit `fromDate` (however old) is honored as-is — the default only kicks in when both date filters are omitted.

**Offering reconciliation — auto-journal (optional):**

`PATCH /admin/finance/offerings/:id/reconcile` accepts optional fields `autoJournal`, `debitAccountId`, `creditAccountId`, and `accountingPeriodId`. When `autoJournal: true` all three IDs are required. A double-entry journal entry is created as `PENDING_APPROVAL` (not auto-posted — segregation of duties: a different admin must approve via the normal journal approval flow). Idempotency key: `offering-auto-journal:{offeringId}`. The reconciling admin is recorded in `reconciledBy` on the offering. The total equals `cashAmount + expectedTransferAmount`. Creation runs inside a `dataSource.transaction()` to prevent duplicate journals under concurrent requests. Account balances are updated only when the journal entry is subsequently approved — not at creation.

**Member finance endpoints (member JWT required):**

| Method | Path | Description |
|---|---|---|
| `GET` | `/finance/giving-options` | List active `GivingOption`s for the online-checkout "what is this for" selector — no `fund` exposed |
| `GET` | `/finance/pledge-campaigns` | List active, non-lapsed pledge campaigns a member can pledge against (member-safe subset of the admin campaign shape — no `createdBy`) |
| `POST` | `/finance/me/pledges` | Self-service pledge — member commits a pledge to a campaign |
| `GET` | `/finance/me/pledges` | List the authenticated member's pledges |
| `POST` | `/finance/me/pledges/:id/contributions` | Log a payment claim toward one of the member's own pledges (`amount`, `paymentDate`, optional `reference`) |
| `GET` | `/finance/me/pledges/:id/contributions` | List the contribution claims (any status) for one of the member's own pledges |
| `GET` | `/finance/me/giving-summary` | YTD tithe total, active pledges, last tithe — cross-type giving view |
| `POST` | `/finance/me/giving-statement/send` | Trigger annual giving statement email for the previous year (on-demand, always available) |

**Pledge campaign discovery (`GET /finance/pledge-campaigns`):** Filters to `isActive = true AND endDate >= CURRENT_DATE` — a campaign that's lapsed or been deactivated is never pledge-able even if a member still has the ID. Not paginated (bounded, admin-controlled reference data, same category as departments/venues). This is distinct from `GET /admin/finance/pledges/campaigns`, which is admin-only and returns the full entity including `createdBy`.

**Deactivating a campaign (`PATCH /admin/finance/pledges/campaigns/:id/active`, `FINANCE_WRITE`):** Body `{ isActive: boolean }`. This is the only way to edit a campaign after creation — there is no general update endpoint. Deactivating a campaign only removes it from `GET /finance/pledge-campaigns` (members can no longer start new pledges against it); it does not touch any existing pledges under that campaign, which keep whatever status/contributions they already have.

**Manual pledge completion vs. contribution-confirmed completion (important distinction):** `PATCH /admin/finance/pledges/:id/status` and the pledge-contribution confirm flow are two independent mechanisms that can both result in `status: COMPLETED`, and they are **not reconciled with each other by design**. Manually setting a pledge to `COMPLETED`/`CANCELLED` via the status endpoint does not touch `amountPaid` or any pending contributions — a pledge can be manually marked `COMPLETED` while `amountPaid` is still 0 and a contribution is still sitting `PENDING`. The only way to reach `COMPLETED` *with `amountPaid` guaranteed to equal `totalAmount`* is via the contribution-confirm auto-complete path (`PledgeService.maybeAutoCompletePledge`, triggered after `confirmContribution`). Admins using the manual status endpoint should understand it as a pure administrative override, independent of payment tracking.

**Pledge self-service:** `MakePledgeDto` requires `campaignId`, `totalAmount`, `frequency` (`ONE_OFF | MONTHLY | QUARTERLY`), `startDate`. Pledges created this way are identical in schema to admin-created pledges; the audit log records `source: 'member-self-service'`.

**Pledge status transitions:** `COMPLETED` and `CANCELLED` are terminal states — once a pledge reaches either status, `PATCH /admin/finance/pledges/:id/status` throws `400 Bad Request`. This prevents accidental reactivation of fulfilled or cancelled commitments.

**Pledge reminder scheduler:** Runs daily at 08:00 (Redis lock `lock:pledge-reminders`). For each `ACTIVE` pledge, calculates the next due date (rolling forward from `startDate` by `frequency`). Sends a `pledge-reminder` email when `diffDays` is 7 (upcoming), 0 (due today), or −3 (overdue). Redis cache key `pledge-reminder:{pledgeId}:{dueDateKey}:{diffDays}` with 2-day TTL prevents duplicate sends.

**Pledge contributions (tracking actual payments):** `Pledge.status` alone never reflected whether a pledge had actually been paid — it was a manual admin flag. `finance_pledge_contributions` closes that gap with a claim-and-confirm flow mirroring the tithe payment-proof pattern:

- `POST /finance/me/pledges/:id/contributions` — the pledge's own member logs a payment claim (`amount`, `paymentDate`, optional `reference`). 403s if the pledge belongs to someone else; 400s if the pledge isn't `ACTIVE`. Starts as `PENDING`.
- `GET /admin/finance/pledges/contributions` (`FINANCE_READ`) — paginated review queue, filterable by `status`/`pledgeId`/`campaignId`.
- `POST /admin/finance/pledges/contributions/:id/confirm` / `.../decline` (`FINANCE_WRITE`) — finance reviews each claim. Confirming stamps `reviewedBy`/`reviewedAt`, emails the member (`pledge-contribution-confirmed`), and re-sums that pledge's `CONFIRMED` contributions — if the sum reaches `totalAmount`, the pledge is automatically flipped to `COMPLETED` (no manual status click needed). Declining requires a `financeNote` and emails `pledge-contribution-declined`.
- Only `CONFIRMED` contributions count. `amountPaid` (per pledge, on `GET /finance/me/pledges` and `GET /admin/finance/pledges`) and `totalPaid` (per campaign, on both campaign-list endpoints) are always computed live from `SUM(amount) WHERE status = 'CONFIRMED'` — never stored/denormalized, same approach as the existing `totalPledged`/`pledgeCount` subqueries on `PledgeCampaign`.
- A pledge's committed `totalAmount` and its actually-paid `amountPaid` are deliberately distinct fields — a pledge can be `ACTIVE` with `amountPaid` anywhere from 0 up to (but not yet reaching) `totalAmount`.

**Budget utilisation alerts:** Runs daily at 08:00 (Redis lock `lock:budget-utilization-alerts`). Calculates actuals for each active budget by summing posted journal entry lines for the budget's account within the budget date range. Sends `finance-budget-alert` email to all admins with `FINANCE_READ` permission at 80% and 100% utilisation thresholds. Dedup via `alert_80_sent_at` / `alert_100_sent_at` columns on `finance_budgets` (persists across Redis flushes). Each threshold fires at most once per budget.

**Finance dashboard summary (`GET /admin/finance/reports/dashboard`, `FINANCE_REPORT` permission):**

Returns a point-in-time snapshot:
- `mtdIncome` / `mtdExpenses` / `mtdNet` — month-to-date totals from posted journal lines
- `pendingJournalEntries` — count of entries in `PENDING_APPROVAL` status
- `pendingPettyCash` — count of replenishments in `PENDING` status
- `budgetsNearLimit` — all active budgets ≥ 80% utilised (sorted desc), each with `name`, `amount`, `actuals`, `utilizationPct`
- `totalOutstandingPledges` / `activePledgeCount` — sum and count of `ACTIVE` pledges
- `generatedAt` — server timestamp

**Environment variables added:**

| Variable | Default | Description |
|---|---|---|
| `ASSET_OVERDUE_NOTIFICATION_DAYS` | `1,3,7` | Comma-separated days-overdue thresholds for checkout reminders. Empty string disables. |
| `ANNUAL_GIVING_STATEMENT_ENABLED` | `false` | Set to `true` to enable the Jan 1 batch annual giving statement emails to all members |

**Entities:** `finance_funds`, `finance_accounting_periods`, `finance_accounts`, `finance_external_payees`, `finance_journal_entries`, `finance_journal_entry_lines`, `finance_journal_entry_links`, `finance_offerings`, `finance_budgets`, `finance_pledge_campaigns`, `finance_pledges`, `finance_recurring_entries`, `finance_petty_cash_replenishments`, `finance_bulk_upload_jobs`, `finance_reconciliation_rows`, `finance_bank_import_profiles`. New FK on `finance_offerings`: `reconciled_by_id`. New FK on `finance_bulk_upload_jobs`: `profile_id`. New columns on `tithe_records`: `source`, `external_reference`, `payment_channel`; `batch_id` is now nullable (webhook-created records have no batch). New columns on `assets`: `insurance_expiry`, `roadworthiness_expiry`, plus 8 notification-timestamp columns (`insurance_notified_*`, `roadworthiness_notified_*`).

Giving Checkout's three entities (`giving_providers`, `tenant_giving_provider_configs`, `giving_checkout_sessions`
— §9 Phase 9h) are deliberately **not** `finance_*`-prefixed despite living under `src/giving-checkout/` — they're
control-plane (`public` schema), same category as `communication_providers`/`billing_checkout_sessions`, not
tenant-schema `finance_*` data.

`member_virtual_accounts` (and `tithe_records.virtual_account_id`) existed here through `1784592000000-CreateMemberVirtualAccountsAndTitheSource` but were dropped by tenant migration `1792108800000-DropMemberVirtualAccounts` — see "Tithe virtual accounts — removed" above.

**Migrations:**
- `1783641600000-CreateFinanceFunds`
- `1783728000000-CreateFinanceAccountingPeriods`
- `1783814400000-CreateFinanceAccounts`
- `1783900800000-CreateFinanceExternalPayees`
- `1783987200000-CreateFinanceJournalEntries`
- `1784073600000-CreateFinanceOfferings`
- `1784160000000-CreateFinanceBudgets`
- `1784246400000-CreateFinancePledges`
- `1784332800000-CreateFinanceRecurringEntries`
- `1784419200000-CreateFinancePettyCash`
- `1784505600000-CreateFinanceBulkUpload`
- `1784592000000-CreateMemberVirtualAccountsAndTitheSource`
- `1784678400000-AssetVehicleFields`
- `1784764800000-AssetVehicleNotificationColumns`
- `1784851200000-TitheRecordBatchNullable`
- `1784937600000-AddTimestampsToJournalEntryLinesAndLinks`
- `1785024000000-BudgetAlertColumns`
- `1785110400000-CreateBankImportProfiles` *(creates `finance_bank_import_profiles` + seeds canonical default profile)*
- `1785196800000-BulkUploadJobProfileFK` *(adds `profile_id` nullable FK to `finance_bulk_upload_jobs`)*
- `1785283200000-OfferingReconciledBy` *(adds `reconciled_by_id` nullable FK to `finance_offerings`)*

---

### Finance Request Module

Manages expense requests raised by department heads (HODs) through a finance team review lifecycle.

**Lifecycle:** `PENDING → APPROVED / REJECTED`. On approval, the finance team attaches proof of payment via a
separate `PATCH /:id/proof` endpoint.

**Self-approve guard:** An admin cannot approve a request they submitted. Returns `403 Forbidden`.

**Proof replacement:** If `PATCH /:id/proof` is called on a request that already has a proof file, the old Cloudinary asset is deleted before uploading the new one. If the delete fails (network error, already removed), the error is logged and the upload proceeds anyway — the old asset may be orphaned but the request is not blocked.

**Posting to the ledger (`PATCH /:id/proof` with `postToJournal: true`):** optional — proof-attachment time, not
approve/reject, is when this is offered, since that's when there's actual evidence money moved (reject never moves
money; approval alone doesn't either). When set, the caller also sends `debitAccountId` (an active `EXPENSE`
account) and `creditAccountId` (the account paid from) in the same multipart body. Mirrors
`PettyCashReplenishment`'s approve-time posting exactly: creates one `PENDING_APPROVAL` `JournalEntry` with two
`JournalEntryLine`s (DEBIT the expense account, CREDIT the paying account, both for `request.amount`) and a
`JournalEntryLink` (`linkType: FINANCE_REQUEST`, `role: RECIPIENT`, `financeRequestId`) back to the request, guarded
by idempotency key `finance-request:{id}` — a repeat call with `postToJournal: true` on an already-posted request
just re-links the existing entry rather than erroring or duplicating it. `FinanceRequest.journalEntry` is set to the
created entry. A **second, different** admin still has to approve the entry via the normal Journal Entries flow
(`PATCH /admin/finance/journal-entries/:id/approve`) before it posts to `Account.currentBalance` — segregation of
duties is unchanged. Requires an OPEN `AccountingPeriod` for the current month (`400` otherwise) and the tenant's
plan to include `PlanFeature.FINANCE` (`403 PLAN_UPGRADE_REQUIRED` otherwise) — proof upload *without* posting stays
available regardless of plan, since `FinanceAdminController` itself carries no `PlanGuard`.

**Email notifications:**
- On creation → all active admins with `FINANCE_WRITE` permission are notified (filtered in SQL via `ANY(r.permissions)`)
- On approve/reject/proof → the HOD who raised the request is notified

**HOD enforcement:** Only workers with a lead assignment (`DepartmentLead` record) can create or view department
requests. A worker can only raise a request for their own department (verified server-side).

**Admin list filters:** `GET /admin/finance/requests` now accepts additional query params for richer filtering:

| Param | Type | Description |
|---|---|---|
| `status` | enum | `PENDING \| APPROVED \| REJECTED` |
| `categoryId` | UUID | Filter to a specific expense category |
| `memberId` | UUID | Filter to requests raised by a specific member |
| `departmentId` | UUID | Filter to requests raised by a specific department |
| `search` | string | Wildcard match on requester name, email, or reason text |
| `page` / `limit` | int | Pagination (default 1 / 20) |

`GET /admin/finance/requests/download` accepts the same filters (no pagination) and returns an `.xlsx` file with columns: Requester, Email, Department, Category, Amount (NGN), Status, Reason, Reviewed By, Reviewed At, Rejection Reason.

**Routes prefix (admin):** `/admin/finance`  
**Routes prefix (worker):** `/finance`

### Follow-Up Module

Handles first-timer registration, follow-up task management, and post-event engagement workflows.

**First-timer registration** is available on both the worker mobile app (workers in the FOLLOW_UP department) and the admin portal (admins with `FOLLOW_UP_WRITE`). On creation, a `FollowUpTask` of type `FIRST_TIMER` is automatically created and assigned via round-robin to the FOLLOW_UP-department worker with the fewest open tasks. The pick and task creation run inside a single transaction protected by a PostgreSQL advisory lock (`pg_advisory_xact_lock(hashtext('follow-up:round-robin'))`), serializing concurrent registrations so the open-task count is always accurate.

**Post-event jobs (Bull queue `follow-up`):**

1. After `markAbsentees()` completes for an event, a `post-event` Bull job is dispatched.
2. `PostEventProcessor.handlePostEvent` sends thank-you emails to all PRESENT/LATE members if `event.thankYouSentAt` is null, then sets `thankYouSentAt` — preventing duplicate sends on re-trigger.
3. If `event.onlineAttendanceEnabled = true`: sends online-confirm request emails to ABSENT members, sets `event.onlineNotificationSentAt`, and schedules a `online-window-closed` delayed job (`ONLINE_CHECKIN_WINDOW_HOURS` hours later, default 3).
4. `handleOnlineWindowClosed` creates `ONLINE_NO_RESPONSE` follow-up tasks for all members still marked ABSENT.

**Online confirm flow:**

Members receive an email after an online-attendance-enabled event. They confirm via `POST /attendances/online-confirm { eventId }`. The system:
1. Checks `event.onlineAttendanceEnabled = true`
2. Validates that `now ≤ onlineNotificationSentAt + ONLINE_CHECKIN_WINDOW_HOURS`
3. Finds the ABSENT record for `(member, event)` and updates status to `ATTENDED_ONLINE`

**Task assignment email:** When a `FollowUpTask` is created (first-timer registration or online non-responder) or reassigned, an email is sent to the assigned worker using the `follow-up-task-assigned` template. Includes the first-timer's name, phone, email, and due date. Fire-and-forget via the `email` Bull queue.

**Overdue escalation (daily cron at 08:00):** `FollowUpScheduler.escalateOverdueTasks` runs every day at 08:00. It finds all tasks with status `PENDING` or `IN_PROGRESS` where `dueDate < NOW()`. Each affected worker receives a digest email (`follow-up-overdue-worker`) listing all their overdue contacts. All active admins with `FOLLOW_UP_WRITE` permission receive a summary count email (`follow-up-overdue-admin`).

**Inactive task detection (daily cron at 09:00):** `FollowUpScheduler.notifyInactiveTasks` runs every day at 09:00. It finds open tasks whose `lastActivityAt < NOW() - FOLLOW_UP_STALE_DAYS` (default 7 days). All active admins with `FOLLOW_UP_WRITE` permission receive a count email (`follow-up-stale-admin`). `GET /admin/follow-up/tasks/stale` also exposes this list on demand.

**Due date:** Tasks auto-set `dueDate = createdAt + FOLLOW_UP_DUE_DAYS` (default 3 days).

**Pastoral report:** `GET /admin/follow-up/report?from=&to=` (requires `FOLLOW_UP_READ`) returns aggregate stats: first-timer totals, source breakdown, wants-to-join counts, task status/outcome breakdown, overdue snapshot, conversion rate, per-worker performance, and per-event first-timer counts. Date range is optional; omitting it returns all-time stats.

**Membership invitation:** `POST /admin/follow-up/first-timers/:id/invite-to-membership` (requires `FOLLOW_UP_WRITE`) queues a personalised invitation email to the first-timer. Returns `{ queued: true }` on success or `{ queued: false }` if the invitation was already sent (`inviteSentAt` is set). Throws `404` if the first-timer is not found or `400` if no email address is on record. Sets `FirstTimer.inviteSentAt` on first send to prevent duplicate emails.

**First-timer conversion:** `PATCH /admin/follow-up/first-timers/:id/mark-converted` (requires `FOLLOW_UP_WRITE`) marks a first-timer as having joined the congregation. Accepts an optional `memberId` (UUID) body field to link the first-timer to their new `Member` record. Sets `FirstTimer.convertedAt` and optionally `FirstTimer.convertedMember`.

**Admin task update:** `PATCH /admin/follow-up/tasks/:id` (requires `FOLLOW_UP_WRITE`) lets an admin update any task's `status`, `outcome`, `outcomeNotes`, `dueDate`, and add a `noteContent` (with optional `contactMethod`) note. Unlike the worker endpoint, this is not restricted by assignment. Also sets `lastActivityAt`.

**Worker standalone note:** `POST /follow-up/tasks/:id/notes` (FOLLOW_UP dept worker) adds a note with an optional `contactMethod` (PHONE_CALL \| WHATSAPP \| IN_PERSON \| SMS \| EMAIL) without requiring a status change. Updates `lastActivityAt`.

**Return visit tracking:** `POST /admin/follow-up/first-timers/:id/visits` (requires `FOLLOW_UP_WRITE`) records that a first-timer attended again. Body: `{ eventId?, notes?, visitedAt? }` — `visitedAt` defaults to today.

**No dedicated first-timer SMS route.** Texting first-timers is done by adding them to a Group (see Groups Module's phone-only entries, sourced "from First-Timers" over a date range) and sending via `POST /announcements/sms-broadcast` with `audience: GROUP` — this superseded a former one-off `POST /admin/follow-up/first-timers/sms` route, consolidating all SMS sending into the Announcements module.

**Pipeline report:** `GET /admin/follow-up/first-timers/pipeline?from=&to=` (requires `FOLLOW_UP_READ`) returns a funnel breakdown: `{ total, untouched, contacted, returned, invited, converted }`. Each first-timer is placed in the highest stage they have reached.

**Stale task list:** `GET /admin/follow-up/tasks/stale?daysInactive=7&page=1&limit=20` (requires `FOLLOW_UP_READ`) returns open tasks with no activity for ≥ N days, ordered oldest-activity-first.

**Routes (worker mobile):** `/follow-up/first-timers`, `/follow-up/tasks/mine`, `/follow-up/tasks/:id`, `/follow-up/tasks/:id/notes`
**First-timer list filtering:** `GET /admin/follow-up/first-timers` accepts optional `dateFrom` and `dateTo` (YYYY-MM-DD) to restrict results to first-timers registered within that date range. Both are optional; omitting either removes the respective bound.

**Routes (admin portal):** `/admin/follow-up/first-timers`, `/admin/follow-up/first-timers/pipeline`, `/admin/follow-up/first-timers/:id/invite-to-membership`, `/admin/follow-up/first-timers/:id/mark-converted`, `/admin/follow-up/first-timers/:id/visits`, `/admin/follow-up/tasks`, `/admin/follow-up/tasks/:id`, `/admin/follow-up/tasks/stale`, `/admin/follow-up/tasks/:id/reassign`, `/admin/follow-up/tasks/bulk`, `/admin/follow-up/report`

### Evangelism Module

Tracks converts from initial outreach contact through to becoming a church member — distinct from the Follow-Up
module above, which is scoped to first-timers who visited a service. A convert here is not assumed to be an
existing `Member`; they may just be a name and phone number an outreach worker captured in the field.

**Entities:** `Convert` (`converts`) — `name`, `phone` (nullable), `notes` (nullable), `status`
(`UNSAVED` \| `SAVED` \| `UNDERGOING_DISCIPLESHIP`, default `UNSAVED`), `onboardedBy`/`onboardedByName` (who
uploaded them, snapshotted), `assignedTo` (ManyToOne → `WorkerProfile`, nullable `SET NULL` — who is currently
following up, mirrors `FollowUpTask.assignedTo`), `member`/`linkedAt` (set once the convert becomes an actual
`Member`, mirrors `first_timers.converted_member_id`/`converted_at`), `lastContactedAt` (denormalized, updated on
every new follow-up log). `ConvertFollowUpLog` (`convert_follow_up_logs`) — one row per contact attempt: `convert`
(CASCADE), `loggedBy`/`loggedByName`, `note` (nullable), `contactedAt` — mirrors the `FirstTimerVisit` idiom.

**Access model:**
- **Uploading a convert** (`POST evangelism/converts`) is open to any authenticated worker — deliberately as
  simple as possible (only `name` is required).
- **Team inbox and follow-up logging** (`GET evangelism/converts/team`, `POST
  evangelism/converts/:id/follow-up`, `PATCH evangelism/converts/:id/status`) require the caller to be a worker
  whose primary or secondary department has the `MANAGE_EVANGELISM_CONVERTS` capability — enforced by
  `ConvertService.assertIsEvangelismDeptWorker()`, a direct copy of `assertIsAdminDeptWorker()`
  (`service-programme/service/service-session.service.ts`) with the capability swapped.
- **Admin portal** (`AdminGuard` + new `EVANGELISM_READ`/`EVANGELISM_WRITE` permissions) — cross-member view of
  every convert, plus `PATCH evangelism/converts/admin/:id/reassign` (validates the target `workerProfileId`
  resolves to an Evangelism-department worker, else `400`) and `PATCH
  evangelism/converts/admin/:id/link-member` (links a convert to a real `Member` once they join).

**Follow-up staleness (no cron):** `GET evangelism/converts/team` computes `daysSinceLastContact` and `isOverdue`
per convert on every read (overdue = no contact in the last 7 days, and not yet linked to a member) — a UI
indicator only, not a background job or notification.

**Follow-up history:** every `ConvertFollowUpLog` row written by `POST evangelism/converts/:id/follow-up` is
readable back via `GET evangelism/converts/:id/follow-up-history` (mobile, Evangelism-dept worker) and `GET
evangelism/converts/admin/:id/follow-up-history` (admin, `EVANGELISM_READ`) — paginated, newest first. Both share
`ConvertService.getFollowUpHistory()`.

**Routes (mobile, worker/team):** `POST evangelism/converts`, `GET evangelism/converts/team?status=&page=&limit=`,
`POST evangelism/converts/:id/follow-up`, `PATCH evangelism/converts/:id/status`, `GET
evangelism/converts/:id/follow-up-history?page=&limit=`
**Routes (admin portal):** `GET evangelism/converts/admin?status=&page=&limit=`, `PATCH
evangelism/converts/admin/:id/reassign`, `PATCH evangelism/converts/admin/:id/link-member`, `GET
evangelism/converts/admin/:id/follow-up-history?page=&limit=`

### Sermon Module

A link-based sermon archive — no file uploads. Each `Sermon` (`title`, `speakerName`, `date`, optional `description`,
`series`, `youtubeUrl`, `mixlrUrl`) stores links to where the content actually lives (YouTube, Mixlr) rather than
hosting media itself. At least one of `youtubeUrl`/`mixlrUrl` is required on create, and an update that would clear
both (leaving neither set) is rejected with `400` — a sermon archive entry with no link anywhere is not useful.
`series` is a plain string tag, not its own entity — deliberately, since nothing in this feature needs series-level
metadata beyond a filterable label. Paginated (grows unboundedly, same policy as members/attendance).

**"Announce Live" manual trigger (`POST admin/sermons/announce-live`):** the MVP for "auto-trigger an announcement
when we go live" — an admin clicks "We're Live on YouTube" or "We're Live on Mixlr" on the Sermons page, providing
the livestream URL. This calls `AnnouncementService.createSystemAnnouncement()` directly (see Announcements Module)
with a default title (`🔴 Live Now on YouTube` / `🔴 Live Now on Mixlr`, overridable) and a body containing the URL.
Zero external-API risk, works identically for both platforms today, and doubles as the fallback path for the planned
YouTube WebSub automation (a channel actually going live still needs a human-clickable escape hatch for when the
automated detection misses a stream or a platform's API is unavailable).

**Routes (admin, `AdminGuard`):** `POST/GET/PATCH/DELETE admin/sermons`(`/:id` for single-record routes) —
`SERMON_READ`/`SERMON_WRITE`; `POST admin/sermons/announce-live` — `SERMON_WRITE`.
**Routes (member, `JwtAuthGuard` + `@RequiresModule('sermons')`):** `GET sermons?page=&limit=&series=`,
`GET sermons/:id` — any authenticated member/worker, no department or class gating (sermons are for everyone).

**Sermon notes (`SermonNote` entity, same module):** a private per-member journal entry on a sermon — `sermon` (CASCADE),
`member` (CASCADE), `note` (text), unique on `(sermon, member)` so a member has exactly one editable note per sermon
(upsert, not a multi-entry thread — matches "notes on this sermon" rather than a running journal). No admin-facing
surface and no separate permission: `GET/PUT/DELETE sermons/:id/note` are gated only by `JwtAuthGuard` and the
module's existing `@RequiresModule('sermons')` check, since a note is the requesting member's own data.

### YouTube Live Detection (`src/integrations/youtube/`)

Automated follow-up to the Sermon Module's manual "Announce Live" trigger — detects when a tenant's configured
YouTube channel goes live and calls `AnnouncementService.createSystemAnnouncement()` automatically, no admin click
needed. Per-tenant BYOK, redesigned from an earlier single-global-channel version (`docs/MULTI_TENANT_MIGRATION.md`
§9 Phase 8b) — every tenant sets their own channel (and optionally their own Data API key) via
`PUT /v1/youtube-integration`; there is no platform-wide default channel.

**Entity — `TenantYoutubeIntegration` (`tenant_youtube_integrations`, `public` schema, not tenant-schema):**

| Field                    | Type                 | Notes |
|--------------------------|----------------------|-------|
| id                       | UUID                 | PK |
| tenantId                 | UUID, unique         | FK → `tenants.id`, `CASCADE` — one integration per tenant |
| channelId                | varchar, unique      | The tenant's YouTube channel id |
| apiKeyEncrypted          | varchar \| null, `select: false` | AES-256-GCM (`EncryptionService`); `null` means live-detection is a no-op until the tenant sets one — no platform-wide fallback |
| lastAnnouncedVideoId     | varchar \| null      | Idempotency key — prevents double-announcing the same livestream |
| subscriptionExpiresAt    | timestamptz \| null  | Estimated WebSub lease expiry (informational; re-subscription runs daily regardless) |
| isActive                 | boolean, default true | Toggled via `PATCH /v1/youtube-integration` — subscribes/unsubscribes the WebSub lease accordingly |

**Lives in `public`, not the tenant schema, on purpose:** a WebSub notification arrives from Google's hub with no
`Host` header or any other tenant-identifying context — only a channel id inside the Atom XML payload. "Which tenant
owns this channel" has to be answerable *before* the tenant is known, which per-tenant-schema data structurally can't
support (same reasoning as `TenantCommunicationProviderConfig`, `docs/MULTI_TENANT_MIGRATION.md` §4.12).
`channel_id` is `UNIQUE` across the whole table, which is exactly what makes the webhook's tenant lookup a single
indexed query. Consequently `v1/integrations/youtube/callback` is excluded from `TenantMiddleware` (§4.3) — it's
never resolved against a `Host` header, and tenant context for it is entered manually (below).

**Platform-wide pieces (env vars):** `YOUTUBE_WEBSUB_CALLBACK_URL` and `YOUTUBE_WEBSUB_SECRET` — the callback URL is
one physical endpoint regardless of how many tenants use it, and the HMAC secret authenticates the hub itself, not
any particular tenant. There is deliberately no platform-wide Data API key: a tenant who hasn't set their own gets
no live-detection, silently, rather than quietly borrowing shared platform quota (`YOUTUBE_API_KEY` was removed —
see "No platform-wide API key fallback" below). With `YOUTUBE_WEBSUB_CALLBACK_URL`/`YOUTUBE_WEBSUB_SECRET` unset,
`YoutubeSubscriptionService.isWebSubConfigured()` is false and `subscribe()`/`unsubscribe()` are no-ops (logged at
debug level) — nothing breaks for a deployment that hasn't set these, tenants just fall back to the Sermon Module's
manual "Announce Live" trigger.

**No platform-wide API key fallback:** `YoutubeLiveDetectionService.handleNotification` returns immediately if
`apiKeyEncrypted` is unset — it never falls back to a shared key, even though any valid Data API key can technically
look up any public channel's snippet. Each tenant's own Google API quota is consumed by their own traffic only.

**Pro-only, module + plan gated** (`@RequiresModule('youtube_integration')` + `@RequiresPlan` — same treatment as
Tithe/Giving and Social Media: a BYOK integration gated on business-value grounds, since it costs Discuva nothing
regardless of a tenant's usage). Gating stops at the config controller — an already-configured integration from
before this module existed keeps running in the background (webhook processing doesn't re-check plan/module state),
same limitation as every other feature's pre-existing data surviving a later gate.

**Tenant self-service routes** (`AdminGuard` + `ModuleEnabledGuard` + `PlanGuard`, tenant-scoped — single resource
per tenant, no `:id`/`:channel` param):

| Method | Path                       | Permission                 | Description |
|--------|-----------------------------|-----------------------------|--------------|
| GET    | `/youtube-integration`      | YOUTUBE_INTEGRATION_READ   | Returns `{ channelId, hasOwnApiKey, isActive, subscriptionExpiresAt } \| null` — never the key itself |
| PUT    | `/youtube-integration`      | YOUTUBE_INTEGRATION_WRITE  | Body `{ channelId, apiKey? }` — upserts this tenant's config, encrypting `apiKey` if given. Rejects (`409`) a `channelId` already owned by a different tenant. Switching channels unsubscribes the old one before subscribing the new one |
| PATCH  | `/youtube-integration`      | YOUTUBE_INTEGRATION_WRITE  | Body `{ isActive }` — enable/disable without touching the stored channel/key; subscribes on enable, unsubscribes on disable |

**WebSub (PubSubHubbub) flow:**
1. Whenever a tenant's integration is created/enabled (`TenantYoutubeIntegrationService.upsert()`/`setActive(true)`),
   `YoutubeSubscriptionService.subscribe(channelId)` POSTs a subscribe request to Google's public hub
   (`https://pubsubhubbub.appspot.com/subscribe`) for that channel's video-feed topic, including `hub.secret`
   (`YOUTUBE_WEBSUB_SECRET`) — the hub then HMAC-SHA1-signs every notification it sends with that secret. Daily at
   2am church time, `YoutubeSubscriptionScheduler` (distributed-lock guarded the same way `FollowUpScheduler` is)
   calls `renewAllActive()`, which re-subscribes every `isActive` tenant integration — WebSub leases expire
   (~5-10 days), so daily renewal keeps every tenant comfortably ahead of expiry regardless of what the hub grants.
2. `GET integrations/youtube/callback` handles the hub's verification handshake — echoes back `hub.challenge`
   verbatim (required by the WebSub spec) for `subscribe`/`unsubscribe` modes, `404` otherwise.
3. `POST integrations/youtube/callback` receives the actual "video published" notification — an Atom XML body
   containing both a `<yt:videoId>` and a `<yt:channelId>`. Before doing anything else, `YoutubeWebhookController`
   verifies the `X-Hub-Signature` header (`sha1=<hex>`) against an HMAC-SHA1 of the raw body computed with
   `YOUTUBE_WEBSUB_SECRET`, using `timingSafeEqual` — without this, the public callback URL would accept a forged
   POST with an arbitrary video/channel id from anyone who discovers it, triggering a fake "we're live" push to a
   tenant's members. A missing/mismatched signature, or no secret configured at all, is dropped silently. Both ids
   are extracted via small regexes (a full XML parser dependency wasn't worth adding for two fixed fields). Always
   acks fast (`204`, no body) regardless of what happens next —
   `YoutubeLiveDetectionService.handleNotification(videoId, channelId)` runs without being awaited by the response.
4. `YoutubeLiveDetectionService` takes a short Redis lock (`lock:youtube-notification:{videoId}`, 60s TTL) before
   doing anything else — WebSub hubs routinely redeliver the same notification, and without this, two concurrent
   deliveries could both pass the idempotency check below before either write lands, double-announcing the same
   stream. It looks up the `TenantYoutubeIntegration` owning the notified `channelId` (`isActive: true`) — an
   unrecognized or inactive channel is dropped silently, no error. It then checks that integration's
   `lastAnnouncedVideoId` (the actual idempotency check — the same video can generate multiple WebSub pings across
   retries/redeliveries). If new, requires the tenant's own decrypted API key — returns silently if none is
   configured, no fallback — and calls the YouTube Data API (`videos.list?part=snippet`) to confirm
   `snippet.liveBroadcastContent === 'live'` — the WebSub ping alone fires for regular uploads too, not just
   livestreams — **and** that `snippet.channelId` matches the notified channel id, since a forged/mismatched payload
   could otherwise attribute someone else's video to this tenant's announcement. Only then does it look up the owning
   `Tenant`, manually enter that tenant's CLS/transaction context (`cls.runWith({tenantId, schemaName}, () =>
   txHost.withTransaction(async () => { SET LOCAL search_path; ... }))` — the same pattern
   `PlatformTenantService.impersonateTenant` uses; a webhook has no request-scoped `TenantMiddleware` run to inherit
   tenant context from, so it has to open one itself), call `createSystemAnnouncement()` inside it, and persist the
   video id as the new `lastAnnouncedVideoId` on the (public-schema) integration row afterward.
5. All external-call failures (hub POST, Data API call) are caught and logged as warnings, never thrown — a webhook
   handler that 500s risks the hub retrying or giving up on the subscription entirely.

**Mixlr is not automated** — it was never tightly coupled to begin with (a per-sermon manual URL field, already
tenant-scoped) and no confirmed public webhook/API was found; the manual "Announce Live" trigger remains the only
path for Mixlr-only streams. Facebook Live is not a built feature at all.

**Routes:** `GET integrations/youtube/callback` — no guard, verified implicitly by the WebSub handshake itself
(same trust model as `POST webhooks/billing`'s own signature verification). `POST integrations/youtube/callback` — no
NestJS guard either, but is signature-verified in the controller itself as described above (a `Public()`-style route
whose actual authentication is the HMAC check, not a bearer token). Both are excluded from `TenantMiddleware` (§4.3)
since the hub never sends a `Host` header identifying a tenant.

**Env vars:** `YOUTUBE_WEBSUB_CALLBACK_URL`, `YOUTUBE_WEBSUB_SECRET` — see Environment Variables.

### ServiceHeadcount Module

Records and retrieves physical attendance counts for services, broken down by demographic group. All routes are admin-portal only (`AdminGuard`). Headcount data can be filtered by service slot, date range, or slot name; trends are bucketed by week, month, or quarter.

**Entity:** `ServiceHeadcount` — one record per service slot (`OneToOne`, enforced by a unique constraint on `service_slot_id`). `POST /service-headcount` is an upsert: recording again for a slot that already has a headcount edits that row in place instead of creating a sibling, so summing across a service's sub-services never double-counts.

**Computed total:** Every response includes a `total` field (sum of fixed groups + all `customGroups` values). Not stored in DB.

**Event-level summary (`GET /service-headcount/event/:eventId/summary`):** The service-level view for a multi-service Sunday — returns every sub-service (`ServiceSlot`) under the event ordered by `startTime`, each with its headcount if recorded (`null` otherwise), plus an aggregate `total` summed across whichever sub-services have been recorded so far (`recordedCount`/`slotCount` show how many are still outstanding). This is the primary admin-facing view (`app/service-headcount`'s "By Event" tab) — an admin picks the Event once and records each sub-service's count inline without leaving the page, and sees the full-service total without adding sub-services up by hand. Reuses the same 5-field-plus-custom-groups form as the flat `POST` route; no new DTO.

**No separate correction endpoint (by design):** `PATCH /service-headcount/:id` existed early on for correcting a record, consumed only by the Records tab's now-removed "Edit" button (a flat historical list, separate from the "By Event" tab). Once headcount became upsert-on-`POST`, that PATCH route had no remaining frontend caller — removed entirely (controller route, service method, `UpdateServiceHeadcountDto`) rather than left as dead, unconsumed admin API surface. Corrections now happen exactly one way: re-recording the same sub-service through the "By Event" tab, which pre-fills the existing values and edits in place.

**Trends:** `GET /service-headcount/trends` returns bucketed data. Each bucket is keyed by `periodLabel + serviceSlotName` so multiple slots on the same Sunday appear as separate series. `customGroups`' dynamic per-church keys mean the per-bucket aggregation stays in-memory rather than SQL `GROUP BY`, but omitting `from` now defaults to a bounded ~365-day lookback (`defaultTrendsFrom()`) instead of scanning every headcount record ever logged — an explicit `from` is always honored as-is.

**Email export (`POST /service-headcount/export-email`):** Reuses the same filtered query as the flat `GET /service-headcount` list (no pagination), builds an `.xlsx` via the shared `ExcelService.buildWorkbook`, and queues it as an email attachment via `EmailQueueService.queueEmailWithTemplateAndAttachments` using the shared `report-export` template (`src/utility/templates/report-export.html`, reused by every report's export endpoint — not headcount-specific). Deliberately one-off: no recurring/scheduled export exists or is planned as part of this feature.

**Trends charts (discuva-admin, `app/service-headcount/page.tsx`):** the Trends tab has a Chart/Table toggle (defaults to Chart) consuming the same `GET /service-headcount/trends` response the table already used — no new backend endpoint, since `HeadcountTrendPoint` already carries every field the reference dashboard needed (`maleAdults`/`femaleAdults`/`teenagers`/`children`/`serviceSlotName`/`periodLabel`/`total`). Renders via three new reusable wrapper components (`components/charts/bar-chart.tsx`, `pie-chart.tsx`, `trend-line-chart.tsx`, thin wrappers over the new `recharts` dependency): a total-attendance trend line across period buckets, a per-service total bar chart, a gender-split pie chart, and a teens-vs-children bar chart — all aggregated client-side from the same trends payload. Fixed a pre-existing bug while wiring this up: the frontend's `Period` type allowed `"yearly"`, which isn't a value the backend's `HeadcountPeriod` recognizes — since the controller doesn't validate/whitelist the query param, selecting "Yearly" silently fell through to quarterly bucketing server-side. Now `"weekly" | "monthly" | "quarterly"` on both sides.

**Routes prefix:** `/service-headcount`

### Prayer Roster Module

Manages monthly prayer meeting rosters across one or more named programs. Each program has its own audience type (`WORKERS`, `MEMBERS`, or `ALL`), day configs, schedule rules, and roster entries. Multiple programs can run concurrently (e.g. a worker-only intercessory program alongside an open member prayer program).

**Key flows:**

- Admin creates programs via `POST /prayer/admin/programs`. All subsequent operations pass `?programId=` to scope to one program.
- Admin configures prayer days (`POST /prayer/admin/day-configs?programId=`) and frequency rules (`POST /prayer/admin/rules?programId=`).
- Admin generates meetings for a month (`POST /prayer/admin/meetings/generate?programId=`). Fixed assignments are auto-applied at generation time.
- Admin opens the self-selection window (`POST /prayer/admin/meetings/open-selection?programId=`); workers and/or members browse open slots and submit their preference (`POST /prayer/select?programId=`). Members can only self-select on programs with `audience = MEMBERS` or `ALL`.
- Admin runs auto-assign (`POST /prayer/admin/roster/auto-assign?programId=&month=&year=`) to fill remaining gaps. Auto-assign is available for `WORKERS` and `ALL` programs; it clears all `AUTO_ASSIGNED` entries first (idempotent), then re-runs the algorithm on clean state. Returns `{ assigned, unassignable }`.
- Admin may manually assign any worker or member via `POST /prayer/admin/roster/manual-assign?programId=` with `{ meetingId, workerProfileId? | memberId? }`.
- Admin may remove any non-FIXED `SCHEDULED` entry via `DELETE /prayer/admin/roster/entries/:id`.
- **Exact frequency enforcement (WORKERS/ALL programs):** Every worker must be assigned to exactly their required number of slots. `GET /prayer/my-status?programId=` returns `{ required, selected, canSubmit }`.
- **Concurrent self-selection:** The `selfSelect` flow runs inside a `DataSource.transaction()` with a `pessimistic_write` lock on the meeting row to prevent capacity over-booking under concurrent requests.
- **Reschedule (soft-delete):** `PATCH /prayer/admin/roster/entries/:id/reschedule` marks the old entry `RESCHEDULED`, creates a new entry with `rescheduledFrom` FK, and adjusts `currentCapacity` on both meetings.
- Admin validates the completed roster (`GET /prayer/admin/roster/validate?programId=&month=&year=`). Returns `{ valid, issues[] }` with per-worker frequency and per-meeting leader checks.

**Reminder scheduler (daily at 08:00):**
Queries `prayer_roster_entries` where the meeting date is 2 days or 1 day away and the corresponding flag (`reminderTwoDaySent` / `reminderDaySent`) is `false`. Queues email via `UtilityService.sendEmailWithTemplate` (fire-and-forget). All flag updates are batched into a single `save()` call after the loop. Template: `prayer-reminder.html`.

**Routes prefix (admin):** `/prayer/admin`  
**Routes prefix (worker):** `/prayer`

**Entities:** `prayer_programs`, `prayer_schedule_configs`, `prayer_day_configs`, `prayer_schedule_rules`, `prayer_fixed_assignments`, `prayer_meetings`, `prayer_roster_entries`.

**Migrations:**
- `1785369600000-CreatePrayerScheduleConfig`
- `1785456000000-CreatePrayerDayConfigs`
- `1785542400000-CreatePrayerScheduleRules` *(also seeds 5 default rules)*
- `1785628800000-CreatePrayerFixedAssignments`
- `1785715200000-CreatePrayerMeetings`
- `1785801600000-CreatePrayerRosterEntries`
- `1785888000000-AddPrayerIndexes` *(indexes on `reminder_two_day_sent`, `reminder_day_sent`, `status` on roster entries; `status`, `selection_status` on meetings)*
- `1785974400000-PrayerColumnsToSnakeCase` *(renames all prayer table columns from camelCase SQL names to snake_case for TypeORM SnakeNamingStrategy compatibility)*
- `1786233600000-AddPrayerPrograms` *(creates `prayer_programs` table; adds `program_id` FK to day configs, rules, meetings; adds `member_id` to roster entries; makes `worker_profile_id` nullable; backfills with a default "Prayer Program" row)*
- `1786320000000-AddFirstTimerConversionFields`
- `1786406400000-AddEventThankYouSentAt`
- `1786492800000-AddFirstTimerVisits`
- `1786579200000-AddFollowUpEnhancements`
- `1786665600000-AddAuditLogTargetName`
- `1786752000000-AddFollowUpTaskIndexes` *(indexes on `assigned_to_id`, `status`, `type` on `follow_up_tasks`)*
- `1786838400000-AddEmailLogProvider`
- `1786924800000-AddPushSubscriptions`
- `1787011200000-AddFinanceAccountCode`
- `1787097600000-AddPledgeGuestName`
- `1787184000000-AddMissingFkIndexes` *(13 FK indexes across high-traffic tables: `attendances.service_slot_id`, `follow_up_tasks.(member_id, event_id)`, `first_timer_visits.(first_timer_id, event_id)`, `follow_up_notes.task_id`, `finance_journal_entry_lines.(journal_entry_id, account_id)`, `finance_offerings.fund_id`, `finance_reconciliation_rows.job_id`, `tithe_records.(batch_id)`, composite `tithe_records(member_id, payment_date)`, `asset_checkouts.asset_id`)*
- `1787875200000-CreatePledgeContributions` *(creates `finance_pledge_contributions`: `pledge_id` FK `CASCADE`, `submitted_by_id` FK to `members` `RESTRICT`, `reviewed_by` FK to `admins` `SET NULL`, `amount`, `payment_date`, `reference`, `status` default `PENDING`, `reviewed_at`, `finance_note`)*
- `1788393600000-AddPerformanceIndexes` *(composite `members(birth_month, birth_day)` for upcoming-birthday lookups; `first_timers.created_at` for date-range queries; composite `follow_up_tasks(status, due_date)`; single-column `status` indexes on `tithe_upload_batches`, `tithe_unmatched_records`, `tithe_dispute_records`, `tithe_payment_proofs`; `finance_requests.category_id`)*
- `1792652400000-AddEmailLogSource` *(adds nullable `email_logs.source` — `tenant` vs `platform_default`; existing rows are `NULL`)*
- `1792738800000-AddSocialAccountOAuthTokens` *(tenant — adds `social_accounts.access_token_encrypted`/`refresh_token_encrypted`/`token_expires_at`/`scope`)*
- `1792825200000-AddSocialPostMediaPlacementScheduling` *(tenant — adds `social_post_targets.placement`, `social_posts.scheduled_for`, drops `social_posts.image_url`, creates `social_post_media`)*
- `1792911600000-AddMemberDirectoryProfiles` *(tenant — creates `member_directory_profiles`, indexed on `is_visible`)*
- `1793217600000-AddSocialPlatformApps` *(public/control-plane — creates `social_platform_apps`, the platform-admin-owned OAuth app catalog)*
- `1793304000000-AddMemberDirectoryToProPlan` *(public/control-plane — appends `'member_directory'` to the `pro` plan's `features` array)*

---

### Push Notification Module

Delivers Web Push notifications to members and workers via the standard Web Push protocol (VAPID). Backed by the `web-push` npm package and a dedicated Bull queue (`push-notifications`).

**Key flows:**
- **Subscribe (once, on first device registration):** After `POST /auth/login` registers the device for the first time (`deviceId` transitions from `null`), the PWA service worker calls `pushManager.subscribe()` and POSTs the result to `POST /v1/notifications/subscribe`. This is a one-time setup per device — not called on every login. Calling subscribe again replaces the existing row.
- **Subscription lifecycle:** The subscription persists through logouts. Push notifications are delivered via the browser service worker and fire even when the member is **not logged in**. The subscription is removed only in these cases:
  - **Admin device purge** (`DELETE /admin/members/:id/device`): backend deletes the subscription automatically. The frontend must re-subscribe after the member's next login on the new device.
  - **OTP device reset** (`POST /auth/device-reset/verify`): backend deletes the subscription automatically. The frontend must re-subscribe after the member's next login on the new device.
  - **Explicit opt-out:** member calls `DELETE /v1/notifications/subscribe`.
  - **Stale subscription:** push service returns `410 Gone` or `404` — processor deletes it automatically, no retry.
- `PushNotificationService.dispatchToMemberIds(memberIds, payload)` finds subscriptions and enqueues all subscribers' jobs in a single `queue.addBulk()` call (each still keeps its own stable `jobId`, `push:{memberId}:{idempotencyKey}`, for deduplication) rather than one `queue.add()` round trip per subscriber — matters most for large-fanout sends (e.g. an `ALL` audience announcement to thousands of members).
- `PushNotificationService.dispatchToWorkerProfileIds(workerProfileIds, payload)` resolves worker profile IDs to member IDs via a single SQL query, then delegates to `dispatchToMemberIds`.
- `PushNotificationProcessor` processes each job: checks a Redis idempotency key (`notif:sent:{memberId}:{idempotencyKey}`, 24 h TTL) before sending. On `410 Gone` or `404` from the push service, the stale subscription is deleted — no retry. Any other error is re-thrown for Bull to retry (3 attempts, exponential backoff).
- **`NotificationDispatchService`** (`src/utility/service/notification-dispatch.service.ts`, exported from the `@Global()` `UtilityModule`) — `notifyMember({ category, email?, push? })` fires the email and push legs of one notification *together*, gated by the same `EmailCategorySettingsService.isEnabled(category)` check on both. Introduced because several call sites (`ServiceProgrammeService.notifySlotAssignment`, `EventReminderService.fireReminder`) queued email through that gate but dispatched `PushNotificationService.dispatchToMemberIds()` completely unconditionally — an admin disabling a category's emails silently left push still firing for the same event. Either `email`/`push` option is independently optional (send email-only, push-only, or both — e.g. `fireReminder` only sets `push` when `recipientIds` is non-empty), but the category gate always applies to both uniformly; there's no per-channel opt-out below the category level. New notification-worthy events should be wired through this rather than calling `EmailQueueService`/`PushNotificationService` directly, to get the same-gate guarantee for free.

**Trigger points:**

| Event | Who is notified |
|---|---|
| Selection window opened (`openSelectionWindow`) | All active workers |
| Auto-assign completes (`autoAssign`) | Each newly assigned worker (via `notifySlotAssignment`, alongside email — see note below) |
| Manual assignment (`manualAssign`) | The assigned worker or member (via `notifySlotAssignment`, alongside email — see note below) |
| Entry removed (`removeEntry`) | The affected worker or member |
| Entry rescheduled (`reschedule`) | The affected worker or member (via `notifySlotAssignment`, alongside email — see note below) |
| Prayer reminder — 2 days before (`PrayerReminderScheduler`) | The assigned worker (alongside email) |
| Prayer reminder — day of (`PrayerReminderScheduler`) | The assigned worker (alongside email) |
| Service/event reminder (`EventReminderService`) | All eligible members per audience scope (alongside email — see note below) |

`ServiceProgrammeService.notifySlotAssignment` (create/auto-assign/manual-assign/reschedule paths) and `EventReminderService.fireReminder` both route through `NotificationDispatchService.notifyMember()` (see "Notification Dispatch Service" above) — their push leg is gated by `EmailCategorySettingsService.isEnabled(...)` the same way their email leg always was, instead of firing unconditionally. The other rows above (selection window, entry removed, prayer reminders) call `PushNotificationService` directly and remain ungated by category preference — candidates for the same migration in a future pass, per the progressive rollout this was scoped to.

**Entity:** `push_subscriptions` — `id`, `member_id` (unique FK → members), `endpoint`, `p256dh`, `auth`, `created_at`, `updated_at`.

**Environment variables required:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (see §10).

### Facility Rental Module

Manages bookable facility slots (halls, rooms, etc.) for members and workers, with tier-based discounts, add-ons, and payment tracking.

**Key flows:**

- Admin configures facilities (`POST /facility-rental/admin/facilities`), pricing tiers (`POST /facility-rental/admin/pricing-tiers`), add-ons (`POST /facility-rental/admin/addons`), and calendar blackout blocks (`POST /facility-rental/admin/calendar-blocks`).
- Members/workers browse active facilities and available add-ons, check availability via `GET /facility-rental/facilities/:id/availability?from=&to=`, and submit a booking (`POST /facility-rental/bookings`).
- On booking creation, the service resolves the member's category (LEADER if a `DepartmentLead` record exists, WORKER if `role = WORKER`, otherwise MEMBER), looks up the matching pricing tier, and computes a price snapshot. Caution amounts are **never discounted**.
- **Pricing formula:** `serviceFee = (basePrice + sum(addon prices)) × (1 - discount)`, `grandTotal = serviceFee + sum(addon caution amounts)`.
- On creation, two `RentalPayment` rows are generated — one `SERVICE_FEE` and one `CAUTION` (skipped if caution total is zero). Both start `PENDING`.
- **Overlap check:** `createBooking` and calendar blocks both use a time-range overlap query (`start < newEnd AND end > newStart`) against all non-cancelled/rejected bookings. A calendar block also blocks the slot.
- Admin confirms (`PATCH .../confirm`), rejects (`PATCH .../reject`), or applies a one-off discount override (`PATCH .../discount`). Overrides recompute and update the `SERVICE_FEE` payment record in place.
- Admin marks payments as paid (`PATCH /facility-rental/admin/payments/:id/paid`) and marks caution refunded (`PATCH /facility-rental/admin/payments/:id/refund`) after the booking completes.

**Status scheduler (every 10 minutes):** `RentalStatusScheduler` auto-transitions `CONFIRMED → IN_PROGRESS` when `startDateTime ≤ now < endDateTime`, and `IN_PROGRESS → COMPLETED` when `endDateTime ≤ now`.

**Routes prefix (admin):** `/facility-rental/admin`  
**Routes prefix (member/worker):** `/facility-rental`

**Entities:** `rental_facilities`, `rental_pricing_tiers`, `rental_addons`, `rental_bookings`, `rental_booking_addons`, `rental_payments`, `rental_calendar_blocks`.

**Migration:** `1782303229675-CreateFacilityRental`

**Permissions:** `FACILITY_RENTAL_READ`, `FACILITY_RENTAL_WRITE`

---

### Children Church Module

Provides a security-grade check-in/check-out system for children. Key features:

- Children are automatically assigned to an age group and class group based on date of birth. Running
  `POST /children-church/age-groups/recompute` re-evaluates all children against current age-group rules.
- Each check-in generates a unique 6-character pickup code. The code is emailed to all registered guardians at check-in
  time.
- Pickup is verified by code via `GET /children-church/checkin/verify/:code` before the checkout is submitted.
- Any check-in can be flagged with `PATCH /children-church/checkin/:id/flag` (e.g. unknown pickup attempt).
- Multiple guardians can be registered per child; `isAuthorizedPickup` controls who may collect.
- Admins (not workers) can view live active check-ins across all classes via `GET /children-church/admin/checkin/active` and paginated history via `GET /children-church/admin/checkin/history`.

**Routes prefix:** `/children-church`

---

### ServiceProgramme Module

Backend replacement for the Firebase-based Service Timer POC. Manages service programme creation, live session control, real-time state broadcast, and post-session analytics.

**Architecture:**
- `ServiceProgramme` and its slots are authored during the week (DRAFT status).
- When a session starts, the programme transitions to LIVE and a `ServiceSession` is created along with `ServiceSessionSlot` snapshot rows (one per programme slot).
- Live state (current slot, timer anchor, pause state) is held in Redis. Clients compute the display timer locally using: `elapsed = slotBaseSeconds + (Date.now() - slotStartedAt) / 1000`.
- Every state change (advance, rewind, pause, resume, adjust-time, reorder, override) updates Redis and writes durable records to the DB.
- Live sessions support ad-hoc time adjustment (`adjustTime`, ± seconds applied to the running slot's elapsed time — reuses the same recompute pattern as `resume()`) and reordering of the not-yet-started (PENDING) tail of `ServiceSessionSlot` rows via drag-and-drop in the admin UI (`reorderLiveSlots` — distinct from `ServiceProgrammeService.reorderSlots`, which only reorders DRAFT-status `ServiceProgrammeSlot` rows before a session starts).
- **`effectiveSlots`** on `GET /service-session/:code/state` — a flattened, per-session array (`{ id, position, status, type, topic, allocatedMinutes, memberName, guestName, backupMemberId, backupMemberName, backupGuestName, actualSeconds, startedAt, completedAt }`, built by `withEffectiveSessionSlots` in `util/slot-display.ts`) keyed by **`ServiceSessionSlot.id`**, with each slot's DRAFT-template fields (`programmeSlot.topic`/`allocatedMinutes`/`member`/`guestName`) merged with any live overrides (`overriddenTopic`, `overriddenSpeakerName`, `overriddenMember`, `adjustedAllocatedMinutes`) already resolved. This is the array every live frontend view (`/service-programme/live/:sessionCode`, `/live/:code/manage`, `/live/:code/presentation`, `/live/:code/audience`, `SessionRunner`) reads for its slot list — **fixed a bug** where those views previously read `session.programme.slots` (`ServiceProgrammeSlot[]`, the DRAFT template's own IDs) and passed those ids straight into `reorderLiveSlots`, which validates against `ServiceSessionSlot` ids and therefore always threw `BadRequestException('Slot list must contain exactly the upcoming (not-yet-started) slot IDs')` — reordering during a live session could never actually succeed. The `backup*` fields always reflect the DRAFT slot's `backupMember`/`backupGuestName` as-is — there is no "override the backup" concept, so they stay constant even after the primary speaker has been overridden.
- **`overrideSlot`** (`POST /service-session/:code/slots/:position/override`, `RolesGuard`+`WORKER`, and `POST /service-session/:code/pm/slots/:position/override`, `Public`+`ShareTokenGuard`) lets an operator rename a slot's topic and/or swap its minister/speaker (by linking a `Member` via `overriddenMemberId`, or a free-text guest name via `overriddenSpeakerName`) **while the session is live**, from either the authenticated Live Session Dashboard or the public Programme Manager link — both call the same service method, with `memberId: null` on the PM path (same pattern as `advance`/`rewind`/etc.). The override is stored on the `ServiceSessionSlot` row, never mutates the underlying DRAFT `ServiceProgrammeSlot`, and is immediately reflected in `effectiveSlots` (and therefore every view listed above) on the next poll.
- **Swap to backup** — both the Live Session Dashboard and the Programme Manager view render a "Backup: {name} — tap to swap" affordance on any slot that has one (current slot and each upcoming slot in the queue), computed client-side by `backupLabel`/`backupOverridePayload` in `use-service-session.ts`. Clicking it calls the same `overrideSlot` endpoint with `overriddenMemberId` (if the backup is a linked `Member`) or `overriddenSpeakerName` (if it's a guest) — a one-click fallback for when the primary speaker doesn't show up, no re-search required. The Presentation and Audience views deliberately do **not** show backup info — it's operational/control-surface data, not something the congregation needs to see.
- Adding or editing a slot on an already-created DRAFT programme (`ProgrammeDetailPanel`) exposes the same "Add backup speaker" toggle as the creation dashboard's `ItemEditorRow` (see below) — both flows share the one component, so backup assignment works identically whether you're building a programme for the first time or coming back to edit it later.
- Each session also gets a `shareToken` (random UUID, Redis-only, same TTL/lifecycle as the anchor) generated in `start()`, powering three public, unauthenticated frontend routes, all reading `GET /service-session/:code/state` — no new backend endpoints were needed for any of them: `/live/:code/presentation` (read-only, big-screen display, dark theme, meant to be opened in its own browser tab/window via the "Open Presentation Window" button so it can be dragged to a second monitor/projector and fullscreened with the `F` shortcut), `/live/:code/manage?token=...` (full remote control — advance/rewind/pause/resume/adjust-time/reorder/end, share-token gated), and `/live/:code/audience` (read-only, mobile-first, light theme — current slot + countdown + progress bar, "Up Next", and the full running order with done/current/upcoming state; intended for members/workers to follow along on their own phone during the service, no share token required since it's read-only like the presentation view). Admins copy/open these links from the "Presentation Link" / "Presentation Window" / "Programme Manager Link" / "Audience Link" buttons on the service-programme, service-session, and live-session dashboards (`GET /service-session/:code/share-links`). The link can be invalidated without ending the session via `POST /service-session/:code/rotate-share-token`, which overwrites the Redis key with a freshly generated token — any copy of the old link stops working immediately (this only affects the Programme Manager link; the Presentation and Audience links have no token to rotate).
- Ending a live session always requires an explicit two-step confirmation ("End" → "End?" Yes/No) in every surface that can end one — the authenticated Live Session Dashboard, the `SessionRunner` card, and the public Programme Manager view — so a single stray click can never terminate a session.
- **`rewind` is destructive** — it resets the current slot back to PENDING and reopens the previous slot as IN_PROGRESS, unconditionally nulling that previous slot's `completedAt`/`actualSeconds` (there is no shadow/history column, so a mistaken rewind previously destroyed the recorded actual duration of a finished slot with only an audit-log breadcrumb — no way to recover the numbers). Two mitigations: (1) `rewind()` now reads both affected `ServiceSessionSlot` rows *before* overwriting them and stringifies their prior `status`/`startedAt`/`completedAt`/`actualSeconds` into the `REWIND_SLOT` action-log `detail` field, so the destroyed values are recoverable from the audit log/CSV even though the DB row itself is overwritten; (2) every UI surface that can trigger rewind (Live Session Dashboard, `SessionRunner`, public Programme Manager view) now requires an explicit Yes/No confirmation before calling it, mirroring the "End Session" pattern. Adjusting the timer (`adjustTime`, ± seconds) is non-destructive to slot records but still requires the same Yes/No confirmation in the Dashboard and Programme Manager views, since a mis-tap changes the running countdown an operator and congregation are actively watching.
- All four live-session views only overwrite their local `payload` state when a fetch actually succeeds — a failed fetch (a transient error, a network blip, a brief server restart) leaves the last known-good payload in place rather than nulling it out, so a momentary hiccup is never mistaken for "the session has ended." Only a fetch that succeeds and returns `anchor.status === 'COMPLETED'` (or an initial load that never succeeds at all) shows the ended/not-found state.
- **Live updates moved from per-client polling to Socket.IO push (`ServiceSessionGateway`, namespace `/service-session`)** — the original design had all four views (Dashboard, Programme Manager, Presentation, Audience) independently polling `GET /service-session/:code/state` every 1.5–3s. That cost scales with `sessions × viewers-per-session`, not `sessions` — and the Audience view has no cap on viewers at all (any number of congregants can open it on their own phone), so a single popular session's Audience traffic alone could dwarf everything else on a busy Sunday. The gateway and its Redis-backed adapter (`RedisIoAdapter`, `@socket.io/redis-adapter`, wired at bootstrap in `main.ts` for horizontal fan-out across multiple app instances) already existed from an earlier phase but had zero consumers and an incomplete broadcast payload; this phase completed the wiring:
  - `broadcastState(sessionCode, state: SessionStatePayload)` now emits the *exact* payload `GET /state` returns (`anchor`, `session`, `effectiveSlots`, `cautionThresholdRatio` — previously only `anchor`/`session` were sent, missing the slot data every view actually renders from). Every mutating controller method (`advance`, `rewind`, `pause`, `resume`, `adjustTime`, `reorderLiveSlots`, `overrideSlot`, `end`, and all `pm/*` equivalents) re-fetches full state via `getState()` and broadcasts it to room `session:${sessionCode}` after the mutation commits.
  - `joinSession`/`leaveSession` gate room membership by validating the session code exists (`getState()` succeeds) before joining — previously any client could join any room, including nonexistent ones, with zero validation. This is a read-only channel with the same trust model as the public REST routes it replaces (session code = read credential); no write actions happen over the socket.
  - CORS on the gateway is validated dynamically via `createCorsOriginValidator()` (same shared validator as the HTTP API, see §Multi-Tenant Request Scoping's "CORS origin validation" note) instead of the previous wide-open `origin: '*'`.
  - Frontend: `hooks/use-live-session-socket.ts` connects to the namespace, joins the session's room, and calls back into each view's `setPayload` on every `session:state` event. Each of the four views kept only a much slower (30s) safety-net `setInterval` poll as a fallback for the rare case a broadcast is missed during a disconnect/reconnect or a backend restart — this is a defense-in-depth measure, not the primary update path anymore. The socket origin is derived from `NEXT_PUBLIC_API_URL`'s origin (stripping the versioned `/v1` path — Socket.IO attaches to the raw HTTP server, not the REST prefix).
  - The per-IP `@Throttle({ limit: 300, ttl: 60_000 })` override on `GET :code/state`/`GET :code/slots/:position` is left in place for the initial load and safety-net poll, but is no longer the thing standing between this module and a real capacity problem — it never bounded aggregate load across many distinct viewer IPs in the first place.
  - **`handleConnection` adds a separate, additive, authenticated tenant-room join** — used only for a global `activeSessions:changed` broadcast (which sessions are currently LIVE for the tenant), distinct from the anonymous per-session-code rooms above. A client presenting a valid JWT at `handshake.auth.token` (verified the same way `TenantMiddleware` verifies a tenant claim — access secret first, then refresh secret) is joined to `tenant:${tenantId}`; a missing or invalid token is a silent no-op, never a rejected connection, so the anonymous audience/presentation/manage flows are completely unaffected. `ServiceSessionController.start`/`startEvent`/`end`/`pmEnd` — the four actions that change whether *any* session is live — each call `gateway.broadcastActiveSessionsChanged(tenantId, sessions)` (tenant id read from the request's CLS store, same as `TenantMiddleware` writes it) after their existing `broadcastState` call. Frontend: `hooks/use-active-sessions-socket.ts` connects with the current access token from `tokenStore`; `useActiveSessions()` (mounted globally via `LiveSessionPill` in `Shell`, so it runs on almost every authenticated page) consumes it in place of its previous 20-60s unconditional poll, keeping only a 5-minute safety-net poll as a fallback.
- The presentation view's countdown has three visual states: normal (white) → **caution** ("Wrapping Up", amber, pulsing) once remaining time drops to `SERVICE_SLOT_CAUTION_THRESHOLD_RATIO` (env, default `0.25`, i.e. the last 25% of the slot's allocated time) → **overtime** ("Time's Up", red, pulsing) once elapsed exceeds the allocation, after which the display counts up (`+MM:SS`). The ratio is resolved server-side and returned as `cautionThresholdRatio` on `GET /service-session/:code/state`, so the frontend has a single source of truth rather than duplicating the value in its own env config. See `SlotTimerDisplay` (frontend). The presentation page also supports a keyboard shortcut (`F`) to toggle browser fullscreen via the Fullscreen API.
- When a `ServiceProgrammeSlot` is assigned a member (via `addSlot` or `updateSlot`'s `memberId`), `notifySlotAssignment()` fires both channels via `NotificationDispatchService.notifyMember()` (see "Notification Dispatch Service" below) — email requires the member to have an address on file, push doesn't (a member may have one channel but not the other, and neither blocks the other), but **both are gated together** by the same `EmailCategorySettingsService.isEnabled(EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT)` check:
  - **Email** (template: `service-slot-assigned`) if the member has an email on file, with a generated `.ics` calendar invite attached when the underlying `ServiceSlot` has both a `startTime` and `endTime`. The template body includes the formatted service **date** (`{{ serviceDate }}`, e.g. "Sunday, 19 July 2026") and **time range** (`{{ serviceTime }}`, e.g. "8:00 AM – 10:00 AM") as plain text in the "Your slot" attributes table — not just carried in the `.ics` attachment, so the schedule is readable even without a calendar client. Both fields are computed once via `fmtAssignmentDate`/`fmtAssignmentTime` and reused for the push body below.
  - **Push notification** to the assigned member. `idempotencyKey: service-slot-assigned:${slot.id}:${member.id}` keys it per slot-and-person so a primary/backup reassignment on the same slot doesn't dedupe against each other. Body includes the slot type, service name, and date/time when available (e.g. "Speaker — Sunday Service — First Service on Sunday, 19 July 2026 at 8:00 AM – 10:00 AM"); links to `/events` in the member app.

  Before `NotificationDispatchService` existed, push was dispatched unconditionally — an admin disabling this category's emails silently left push still firing for the same event. Fixed by routing both legs through the shared category gate instead of only checking it on the email leg.

  Guests (`guestName`, no member record) never reach this method — nothing to email or push. Re-editing a slot without changing its assigned member does not re-send either notification. The response from `addSlot`/`updateSlot` may include a non-blocking `conflictWarning` string when the assigned member already has another slot (in a different programme) whose service time overlaps this one — surfaced in the admin UI but never prevents the save.
- Assigning a **backup** member (`backupMemberId`, via the same two endpoints) triggers the identical email + push pair for the backup, with `isBackup: true` in the template data — the template (`{{#if isBackup}}`) swaps the heading/body copy to make clear they're the backup, not the primary, and the subject/push title reads "You're the Backup for: …" instead of "You've Been Added to the Programme: …". Same at-most-once-per-change rule as the primary: re-editing a slot without changing the backup does not re-send.
- **`POST /service-programme` (`create`) is fully batched, not one round trip per programme/slot.** Given N programmes (each with its own set of slots — e.g. creating First Service and Second Service's whole order-of-service in one request), the previous implementation looped per programme (`programmeRepo.save` once each) and, within that, per slot (a `memberRepo.findOne` for the assignee, another for the backup, then `slotRepo.save`) — a 2-programme, 15-slot-each request was 60+ sequential DB round trips. It now: resolves every referenced `memberId`/`backupMemberId` across every programme's slots in one `memberRepo.find({id: In(...)})`, bulk-inserts all programmes in one `programmeRepo.save(array)`, bulk-inserts all slots in one `slotRepo.save(array)`, and reloads all created programmes for the response in one `programmeRepo.find({id: In(...)})` instead of an N-times `findOne`. No change to the request/response shape. One intentional side-effect of the batching: the per-slot `conflictWarning` computation (`findMemberConflictWarning`) is no longer run during `create()` — its result was already discarded here even before this change (only `addSlot`/`updateSlot`'s single-slot paths surface it), so skipping the computation removes wasted queries without changing any observable behavior.
- **`create()` sends one consolidated notification per member instead of one per slot.** When the same person is assigned (as primary or backup) to multiple parts across the programmes in a single `create()` call — e.g. a worship leader rostered for both First and Second Service in the same request — the old per-slot `notifySlotAssignment()` loop sent one separate email and one separate push per assignment, so a member on 3 slots got 3 emails. `create()` now builds an `assignmentItems[]` list across all programmes/slots being created and hands it to a new private `notifyBulkSlotAssignments()`, which groups by member and, per member: still sends one push per assignment (unchanged — pushes are terse enough that batching them into one buys nothing and would lose the per-assignment `idempotencyKey: service-slot-assigned:${slot.id}:${member.id}` deduplication), but sends **one email** (template: `service-programme-assignments`, new file) covering every part, with one `.ics` attachment per assignment. Each part in the email numbers itself `partNumber` (precomputed server-side as `index + 1` when building the template data — Handlebars' built-in `@index` is 0-based and this codebase registers no custom helpers, so a 1-based `@index1` doesn't exist and can't be relied on in the template); a backup assignment renders as "Backup for: {slot}" instead of a numbered part. Subject is "You've Been Added to the Programme: {slot}" for a single assignment, or "You've Been Added to {N} Parts of the Programme" for multiple. Still gated by `EmailCategorySettingsService.isEnabled(EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT)` and still skips the email leg for a member with no address on file, same as the single-assignment path. **This only applies to `create()`** — `addSlot`/`updateSlot` (adding or editing one slot on an already-created DRAFT programme) still call the original `notifySlotAssignment()` and send one email per call, since batching those would require deferring/debouncing a notification across separate, independent requests rather than grouping work already known to be one request — out of scope for this pass.
- `ServiceProgrammeReminderScheduler` runs daily at 09:00 (`@Cron('0 9 * * *')`, guarded by a Redis lock so only one instance runs it) and emails a reminder (template: `service-slot-reminder`, same `.ics` attachment logic as the assignment email) to every assigned member whose `ServiceProgrammeSlot.reminderSentAt` is still null and whose programme is DRAFT with a `ServiceSlot.startTime` 24–48 hours away. `reminderSentAt` is stamped immediately after queuing to guarantee at-most-once delivery even if the cron overlaps a slow run.
- **`ProgrammeAutoStartScheduler`** (opt-in, off by default) starts a service's session on its own, without a worker tapping "Start" — for churches that want the live session to begin the moment the scheduled time arrives rather than relying on someone remembering to start it. Gated per-`EventConfig` by `autoStartSession` (boolean, default `false`; no per-slot override — a config-wide default was judged sufficient rather than adding a second admin UI surface preemptively). Runs every 5 minutes (`@Cron('*/5 * * * *')`, same Redis-lock + `forEachActiveTenant` shape as the reminder scheduler above); per tenant, queries `ServiceProgramme`s that are `DRAFT`, whose `serviceSlot.config.autoStartSession` is true, and whose `serviceSlot.startTime` falls between start-of-day (church-local, via `DateService.startOfDay()`) and `now` — that lower bound is deliberate, since an unbounded query would resurrect every ever-forgotten DRAFT programme, not just today's. **This was previously a tight 10-minute trailing window (`[now - 10min, now]`), which was itself a bug**: a later slot in a multi-slot event (e.g. Second Service) only becomes startable once the prior slot's session is manually ended, which a front-desk worker might do well after the slot's own nominal `startTime` — a 10-minute window meant that by the time the prior session was finally ended, the next slot's `startTime` had already scrolled out of the window, permanently stranding it in `DRAFT` for the rest of the day. Anchoring to start-of-day instead keeps every one of today's due slots eligible all day, while still refusing to resurrect a `DRAFT` programme genuinely forgotten from a previous day.
- **Each due event starts the specific due programme, not "whatever's earliest for the event"** — the batch is grouped by `serviceSlot.event.id`, and for an event with more than one due slot in the same run, only the earliest-due one's `programmeId` is passed to `ServiceSessionService.startEvent(eventId, null, programmeId)`; a later due slot for the same event is picked up on the run after this one ends, same as the manual "Start" button's own one-slot-at-a-time behavior. `startEvent`'s third, optional `programmeId` parameter is what makes this possible — when given, it's started directly; when omitted (every other caller, including discuva-admin's "Start" button), it falls back to the original "earliest startable DRAFT programme for this event" lookup, unchanged. **This is a fix, not the original design**: previously the scheduler passed only `eventId`, always falling into that "earliest DRAFT for the event" fallback — which doesn't know or care whether that earliest programme was itself due or even auto-start-eligible at all. A church that configures a multi-service Sunday's order of service for *both* services in advance, with `autoStartSession` enabled on only the later one (the earlier one is always started manually, and may still legitimately be sitting `DRAFT` because nobody has gotten to it), would have the scheduler silently auto-start the *earlier*, not-due, not-auto-start-eligible programme instead of the one that was actually due — auto-start effectively never working for that config. `startEvent`'s existing guard against a second concurrently-LIVE session for the same event is unchanged either way (a `ConflictException` here is an expected, silent skip — e.g. a second due slot in the same batch that the first call already handled — not logged as a failure). One event's unexpected failure (e.g. a programme somehow ending up with zero slots) is logged and skipped without blocking the rest of the tenant's batch.
- **`ServiceSessionService.start`/`.startEvent` accept `memberId: string | null`** — `null` means no human actor, used by `ProgrammeAutoStartScheduler` above. `assertCanControlSession` is skipped entirely when `memberId` is null (`if (memberId) await this.assertCanControlSession(memberId);`, the same optional-actor pattern several sibling methods in this service already used for their own call sites), and the resulting `SESSION_STARTED` `ServiceActionEntry` gets `performedByMember: null` with `actorLabel: 'Auto-started'` instead of attributing it to a member — surfaced in the action log the same way a named Programme Manager grant's `actorLabel` already is. The two controller routes below are unaffected — they always pass the calling admin's real `req.user.id`.
- `GET /service-session/:code/action-log/csv` streams the full `ServiceActionEntry` audit trail for a session as a CSV download (Timestamp, Actor Role, Actor, Action, Detail) for admins who need an offline record beyond the in-app log; `GET /service-session/:code/action-log` returns the 10 most recent entries as JSON for the dashboard's in-app activity feed. `GET /service-session/:code/report/pdf` (session report PDF), `GET /service-session/event/:eventId/report/pdf` (full event report), and `GET /service-session/event/:eventId/report/summary-pdf` (event summary) all existed on the backend with no frontend consumer for a while — all three are now wired: the Live Session Dashboard's "Share & Access" card has a "Session Report (PDF)" button (next to "Audit Log (CSV)") for the first; the Programmes list's per-event header has "Full Report"/"Session Report"/"Summary" download buttons for the other two (see Service Programme Module notes below for their distinct availability gating).
- **Session report fixes** — `buildSessionReport()`'s `totalPauseDurationSeconds` only ever summed pause entries that had a `resumedAt` (`ServicePauseEntry.resumedAt: Date | null`); a session ended while still paused left that final pause entry with `resumedAt: null` forever, silently dropping its entire duration from the total (and showing "ongoing" in the pause log indefinitely). `end()` now closes any still-open pause entry (`resumedAt IS NULL`, same query used by `advance()`/`resume()`) inside its existing transaction before finalizing the session, so the total and the pause log are always accurate once a session ends. Separately, the session-report PDF's per-slot table (`PdfService.drawSessionReport`/`drawFullEventReport`) dropped its "Type" column and split the previous combined "Topic / Speaker" column (joined with `·`) into two distinct "Topic" and "Speaker" columns — removing the Type column on its own would have made any slot with no topic set indistinguishable from another (`SessionSlotReport.topic` is nullable), so the new `PdfService.slotTopicLabel()` falls back to a human-readable type label (`ServiceSlotTypeLabels[type]`, e.g. "Praise & Worship") whenever a slot has no topic, rather than a bare "—"; `drawEventSummaryReport`'s already-separate Topic/Speaker columns and `drawOrderOfServiceTable`'s topic column were both updated to use the same shared helper for consistency. The single-session PDF also gained a small **Analysis** section — a handful of narrative, presentation-only insights derived from data already on `SessionReport` (on-time/over/under completion counts and combined variance, skipped-slot count, the single biggest overrun slot, and a pause summary with the most common reason) — rendered between the Pause Log and the closing time-summary band. These insights are computed in `PdfService` at render time and are deliberately **not** added to the `SessionReport` JSON contract or the `GET /service-session/:code/report` response. The Pause Log table (in both `drawSessionReport` and `drawFullEventReport`) also stopped rendering a bare `Slot ${p.slotPosition + 1}` — `ServicePauseEntry` only ever stored the slot's numeric position with no name, so the report showed unexplained entries like "Slot 3" with nothing tying it back to the actual slot. `PdfService.pauseSlotLabel()` now resolves that position back to the matching `SessionSlotReport` and reuses `slotTopicLabel()`, so the Pause Log shows the same human-readable topic/type label as the Slots table above it.
- **`GET /service-session/:code/pm/report/pdf`** — the same session report PDF, now also reachable from the public Programme Manager link (`ShareTokenGuard` + `NamedAccessGuard`, controller delegates to a shared private `sendSessionReportPdf` helper alongside the admin route to avoid duplicating the response-header logic). `getReportPdf`/`getFormattedReport` have no session-status precondition — this works whether the session is still LIVE or already COMPLETED — but the frontend surfaces it specifically on the manage page's "Session Ended" screen, since that's the point a PM user actually wants it. This required reordering `/live/:code/manage`'s early-return checks: the name+PIN sign-in gate now runs **before** the "Session Ended" check (previously the reverse — anyone with just the raw link could see the ended-session message with no PIN at all, and a report-download button placed there would have failed silently for anyone who hadn't signed in). Now reaching the ended-session screen guarantees a `grantToken` is already in hand.
- Admin frontend information architecture: the `GET /service-programme` list groups programmes under their parent event (using the `event`/`serviceSlotDetail` fields above) instead of rendering every service slot as an unrelated row, so multi-slot events (e.g. First/Second Service on the same Sunday) visibly belong together. A persistent "Live" pill in the admin top bar (`useActiveSessions`, polling `GET /service-session/active`) is reachable from any page and deep-links straight into a dedicated full-width Live Session Dashboard at `/service-programme/live/:sessionCode` — replacing the old cramped side-panel controls, which now show only a status summary with a link to the dashboard. The poll interval backs off adaptively: 20s while at least one session is LIVE, 60s while idle (the common case, since most of the time nothing is live) — this cut the steady-state request volume from this always-mounted, every-page component by 3x without slowing detection of a session actually starting/ending.
- All four live-session frontend surfaces (Live Session Dashboard, Programme Manager, Presentation, Audience) explicitly check `anchor.status === 'COMPLETED'` and render a dedicated "Session Ended" screen — previously they only checked whether the anchor/payload existed at all, so once a session legitimately ended, `currentSlot` (looked up by `anchor.currentSlotPosition`) still resolved fine and every view kept showing the ordinary live stage with no active slot to display, reading as a stuck/broken UI rather than a finished session.
- Starting a session late (after its `ServiceSlot.startTime` has passed) has never been restricted — `ServiceSessionService.start()` has no time-window check, so any DRAFT programme with slots can be started at any time via `POST /service-session/programme/:programmeId/start`.
- **A concurrent double-start of the same programme now surfaces the same friendly `ConflictException` as the "still live" pre-check, instead of a raw driver error.** `assertProgrammeIsDraft` takes no row lock, so two near-simultaneous `start()` calls for the same programme (a double-tap on the button, or the auto-start scheduler racing a manual start) can both pass it; the DB's `service_sessions_programme_id_key` unique constraint is the real backstop that prevents an actual duplicate `LIVE` session, but the loser previously got an unhandled `QueryFailedError` straight from the driver. The `manager.save(ServiceSession, ...)` call is now wrapped the same way `AttendanceService.checkin()` already handles its own unique-constraint race: catch, check `driverError.code === '23505'`, throw `ConflictException('A service session for this programme was just started — refresh and try again')`; anything else rethrows unchanged.
- A DRAFT programme that was created but never started can be permanently deleted via the pre-existing `DELETE /service-programme/:id` (blocked once a programme leaves DRAFT). The admin Programmes list now surfaces this directly on each DRAFT row (a small trash icon, previously only reachable from inside the detail panel) so an abandoned programme can be removed from the "ready to start" list without opening it first.
- When the session ends, remaining PENDING slots are marked SKIPPED, the programme status moves to COMPLETED, and if `saveAsTemplate = true` the programme is auto-saved as a `ServiceProgrammeTemplate`. A session-report email is fire-and-forget dispatched to all active Admin department workers via Bull queue (template: `service-session-report`).
- **Indexes** (migration `AddServiceProgrammeQueryIndexes`): `service_sessions(status)` backs the frequently-polled `getActiveSessions()` (global Live pill, every 20s from every open admin tab); `service_programme_slots(member_id)` backs the synchronous double-booking conflict check run on every slot assignment; `service_programmes(status)` backs the daily reminder scheduler's DRAFT filter; a partial index on `service_programme_slots(reminder_sent_at) WHERE reminder_sent_at IS NULL` matches that scheduler's exact predicate and stays small regardless of table growth. `service_slots(start_time)`/`(end_time)` (pre-existing) already cover the conflict check's time-overlap comparison and the reminder scheduler's 24–48h window.
- **Create Programme dashboard** — the admin "New Programme" flow (`CreateProgrammeDashboard` in `app/service-programme/page.tsx`) replaced a plain "pick one slot, create an empty draft, add items one at a time afterward" modal. The entry point is an **Event** picker, not a slot picker — service slots are only ever a sub-part of an event, so making the admin pick one arbitrary slot just to "unlock" the rest was the wrong mental model. The dropdown lists distinct events (deduped from the slot list client-side, dated by their earliest slot's start time, events where every slot already has a programme excluded), and picking one loads all of that event's slots into a full-width dashboard: a left-hand list of the event's services (each independently checked on/off, with its own item count/duration, the first not-yet-programmed one auto-selected), and a right-hand editor for whichever service is selected — each service's order-of-service is a genuinely separate list (no shared/master list, per explicit product direction), built with real HTML5 drag-and-drop reordering (matching the pattern already used for reordering an existing DRAFT programme's slots) plus the existing move-up/down buttons for accessibility. Submitting maps each checked service to one `programmes[]` entry in the `POST /service-programme` call above.
  - **Item entry is inline, not modal-based** (`ItemEditorRow`) — the initial version reused the old full-screen `AddSlotModal`/`EditSlotModal` (originally built for adding/editing a single slot on an already-created programme) for this dashboard too, which turned out to be too many clicks per item for building a whole order-of-service in one sitting. It was replaced with an always-visible "quick add" row at the end of each service's item list — type, topic, duration, and a single merged speaker field (see `SpeakerInput` below) editable directly in place; pressing Enter or the check button appends the item and immediately resets the row for the next one, with no modal open/close cycle. Clicking an existing item turns that row into the same inline editor (pre-filled, Save/Cancel) instead of reopening a modal.
  - **`ProgrammeDetailPanel` (editing an already-created DRAFT programme) now uses the same `ItemEditorRow`** instead of `AddSlotModal`/`EditSlotModal`, which have been deleted — editing a programme days after creating it now has the exact same inline, no-modal feel as building it the first time, instead of two different UIs for the same data depending on when you touch it. `slotToEditorValue()` converts the live API `ServiceProgrammeSlot` shape (`member`/`backupMember` as nested `{id, firstname, lastname}` objects) into the shared `ItemEditorValue` the row edits; committing calls the real `addSlot`/`updateSlot` endpoints directly (no local draft array — each commit is its own API round trip, unlike the creation dashboard which batches everything into one `POST /service-programme` call). Topic and speaker quick-pick suggestions are drawn from the programme's own other slots rather than the whole event, since this panel only ever has one programme's slots in scope.
  - **`SpeakerInput`** merges the old Member/Guest toggle into one field: typing is treated as a guest name by default, and picking a live-search match upgrades it to a member — removing the extra "which kind of person" click before you could even start typing. A backup speaker toggle ("+ Add backup speaker") is available on each row in this dashboard, using the same merged `SpeakerInput`.
  - Topic and speaker fields autocomplete/suggest from names already used anywhere else in the same event (`topicSuggestions`/`memberSuggestions`, derived client-side from all services' in-progress items — not persisted, not an API concern), so a repeated item (e.g. "Praise & Worship", the same worship leader) doesn't have to be retyped per service.
  - **"Copy from…"** in the active service's header lets you duplicate another already-configured service's full item list (including backups) into the current one in one action — the order of service is usually similar across a multi-service Sunday even though the ministers differ, so this is duplicate-then-edit rather than a shared/master list (each service's items stay fully independent once copied; editing one afterward never affects the other). Prompts for confirmation only if the target service already has items, since that copy would overwrite them.
  - **"Apply template…"** sits next to "Copy from…" in the same header — applying a saved `ServiceProgrammeTemplate` (previously only usable via `applyTemplate()` on an already-created programme, a second trip after creation) now populates the active service's local draft list directly at creation time, client-side, the same way "Copy from…" does (`templateSlotToDraftItem()` converts the template's `ServiceProgrammeSlot[]` into the local `DraftItem[]` shape). Same overwrite-confirmation rule as "Copy from…". `applyTemplate()`/`ApplyTemplateModal` are unchanged and still available on an already-created programme via `ProgrammeDetailPanel`'s "Template" button — this is an additional, earlier entry point, not a replacement.
  - `DraftItemRow`'s secondary line (speaker/duration) uses each slot type's `cfg.text` colour (e.g. `text-amber-800` for Speaker) instead of a flat grey — that per-type colour token existed in `SLOT_TYPE_CONFIG` already but was unused; pairing it with the matching `cfg.bg` tint (e.g. `bg-amber-50`) gives correct, type-appropriate contrast instead of one grey that read as low-contrast against every row colour.
  - **"My Upcoming Assignments"** — previously a member/worker's only signal that they were scheduled was the one-off `service-slot-assigned` email; there was no way to look it up later. `GET /service-programme/my-assignments` (`getMyUpcomingAssignments()` in `ServiceProgrammeService`) fixes this on the read side: any authenticated member/worker can pull their own upcoming slots — as primary or backup — across every not-yet-completed programme. This is admin-portal-agnostic (`JwtAuthGuard` only, no admin permission), consumed by the **member-facing** app (`discuva-member`, a separate Next.js PWA from the admin portal `discuva-admin`) rather than the admin dashboard — `hooks/use-my-assignments.ts` there polls it every 30s (`usePollingEffect`, same visibility-aware pause/catch-up behavior `useMyLiveStatus` uses) and `components/layout/home.tsx` renders a horizontally-scrolling "My Upcoming Assignments" card row on the member home screen (dark cards matching the existing hero's palette), shown only when the member actually has something coming up. The hook originally fetched once on mount only — a member who opened Home before their assigned service's session went `LIVE` and simply left the app open never saw the card flip into its tappable/countdown-eligible state (the `isLive` check depends on `programmeStatus`/`sessionCode` from this same response), since nothing ever re-fetched it; polling fixes that.
  - **Real-time "my slot" view + personal service history** — two more member-facing additions alongside "My Upcoming Assignments" in `discuva-member`: (1) once a member's upcoming assignment's programme goes LIVE, its card becomes tappable (pulsing "Live" badge) and links to `/my-assignment/:sessionCode`, a page backed by `GET /service-session/:sessionCode/my-status` (`getMyLiveStatus()`) — shows a live countdown to their turn, an "you're up now" banner once it arrives, an "your part is complete" state afterward, and the full running order with their own row highlighted; the countdown ticks locally client-side between 8s polls using the same `fetchedAt` + elapsed-time technique the admin Live Session Dashboard already uses, rather than polling more aggressively. (2) `/service-history` (`hooks/use-my-service-history.ts` → `GET /service-session/my-history`) — a paginated list of the member's own completed slots with total time served and a per-slot-type breakdown, linked from Profile's general Explore section (not worker-gated — `ServiceProgrammeSlot.member` has no role restriction, so a plain member assigned a slot has just as much reason to see this as a worker; the frontend tile-visibility gate was the only thing that had ever restricted it, `getMyServiceHistory` itself never did). Both reuse existing server-side logic rather than introducing new authorization concepts: `getMyLiveStatus` never exposes other members' identities (only role/position/timing derived values), and `getMyServiceHistory`'s effective-speaker crediting rule is identical to `getAnalytics`'s `memberId` filter, so the two can never disagree about who gets credit for a slot. `getMyServiceHistory` also includes a LIVE session's already-completed slots, not just fully-COMPLETED sessions — a slot's own status flips to `COMPLETED` (with `actualSeconds` set) the moment it's advanced past, well before the session as a whole is ended, so history reflects that immediately rather than waiting for someone to end the whole session; the per-slot `COMPLETED` filter this relies on also incidentally excludes `SKIPPED` slots (which `end()` produces for anything still `PENDING` when a session is ended early) from ever surfacing as if they'd been performed.
  - **General order-of-service view + Front Desk session control** — two more member-facing additions in `discuva-member`, both reusing `GET /service-programme/upcoming` (`getUpcomingForMembers()` in `ServiceProgrammeService` — the soonest programme that's `LIVE`, or `DRAFT` with a still-future `serviceSlot.startTime`; a `LIVE` programme always qualifies regardless of its original scheduled time, so a service running long doesn't vanish from view just because the clock passed its start. Returns `null`, never a 404, when nothing qualifies — "no service scheduled right now" is a normal state. Slots map to `speakerName`/`backupSpeakerName` strings only, never the raw `Member` row, since — unlike `my-assignments`/admin `findOne` — this is returned to *any* authenticated member, not just whoever has a slot in it): (1) `/order-of-service` — a read-only, printed-programme-style listing of the whole lineup (every member, not just those with a slot in it), the answer to "what's the order of service this week." (2) `/front-desk-session`, gated behind the same `FRONT_DESK_OPERATIONS` capability tile as "Check Someone In" — a scoped-down live-control surface (start / back / next / pause+reason / resume / end, polling the same public `GET /service-session/:code/state` the audience/PM display views use) built for a front-desk worker running the room week to week, not the full producer toolkit (reordering live slots, arbitrary time adjustment, and overriding a slot's speaker stay reachable only via the admin Live Session Dashboard or the public Programme Manager link).
  - **Analytics tab** — a third tab alongside Programmes/Templates (`AnalyticsTab` in `app/service-programme/page.tsx`) surfaces `GET /service-session/analytics`, which existed on the backend fully built but had no frontend caller before this. Filterable by date range and service slot name; renders summary cards (completed sessions, avg completion rate, total overrun slots, total pause time — all derived client-side from the `sessions` array) plus three tables: per-slot-type stats (avg actual vs. allocated time, overrun counts), top speakers (by total/avg time on the mic), and recent completed sessions. Gives an admin running several services a week visibility into load-balancing and pacing without opening individual session reports one at a time. **Defaults to a bounded ~180-day lookback** (`ServiceSessionService.defaultAnalyticsFrom()`) when `from` is omitted, instead of the 6-way-joined query scanning every COMPLETED session ever recorded — the tab's own `from`/`to` inputs are pre-populated with this same 180-day window on first load so the shown range is never silently narrower than what the UI displays; an explicit `from` (however old) is always honored as-is.
    - Fixed: the "Service Slot Name" (and date-range) filters silently did nothing — `load()` was wrapped in `useCallback(..., [fetchAnalytics])`, missing `from`/`to`/`serviceSlotName` from its dependency array, so the memoized closure always read the empty strings captured on first render regardless of what was typed. Fixed by including them in the deps; the initial-mount fetch now runs from a plain `useEffect(() => { load(); }, [])` instead of depending on `load` itself, so typing a filter doesn't trigger a fetch on every keystroke — only clicking "Load" (`onClick={load}`) does, now with the current input values.
    - Fixed (backend): even once the frontend closure bug was fixed, the filter still only matched a session's sub-service label (`serviceSlot.name`, e.g. "First Service") — typing the service's actual name (the parent Event's name, e.g. "Sunday Service") matched nothing, since `event` was never joined into the analytics query at all. `fetchAnalytics()` now joins `serviceSlot.event` and matches `(serviceSlot.name ILIKE :name OR event.name ILIKE :name)`, so either name works. Frontend field relabelled "Service Slot Name" → "Service Name" to match.
    - The "Service Name" field suggests as you type via `ServiceNameFilterInput`, matching `SearchableSelect`'s visual pattern (the same one the service-headcount page's slot pickers use) rather than a native `<datalist>` — a search-icon input, a dropdown of matches each showing its date as a grey sublabel (`{name} — {date}`, since the same name recurs across many dates and there'd be no way to tell occurrences apart otherwise), and once a suggestion is clicked, a chip (`{name} — {date}` + a clear button) replaces the input, exactly like a selected `SearchableSelect` option. The datalist was tried first but browser-native datalist rendering/filtering is inconsistent enough that it read as broken to users. One deliberate difference from `SearchableSelect`: typing without clicking a suggestion still updates the filter value (clearing any previously-selected chip back to free-text mode) rather than requiring an exact pick, since the backend does a partial/ILIKE match on `serviceSlotName` and the field needs to stay usable for names or occurrences that aren't in the (client-side, non-exhaustive) suggestion list. The filtering itself is a local substring match — no API round-trip, unlike the Minister/Speaker filter which searches live.
    - Fixed: suggestions were sourced from the hook's `fetchServiceSlots()` — built for the "Create Programme" picker, so it deliberately filters to future events only and excludes any slot that already has a programme. Analytics needs the opposite (names of *past/completed* sessions), and since a slot only shows up in analytics once its programme has actually run, that filter combination excluded essentially every real name, leaving the suggestion list empty regardless of the input component. `AnalyticsTab` now fetches `GET /events?page=1&limit=200` directly (no `upcoming` param — that filter is opt-in and off by default) and collects every distinct event/service-slot name with no date or usage filtering, dropping its dependency on the shared `hook` prop entirely (`<AnalyticsTab />` takes none now).
    - **Minister/Speaker filter** — `MemberFilterInput` (new, in `app/service-programme/page.tsx`) is the same live `/members?search=` combobox as `SpeakerInput` used at creation time, minus the guest-name fallback (this is a filter, not an assignment field). Backend-side, `memberId` restricts the query to sessions this member actually appeared in via a session-slot subquery (`session.id IN (SELECT ... service_session_slots ... WHERE ps.member_id = :memberId OR ss.overridden_member_id = :memberId)`) — a raw SQL subquery rather than a plain join-then-filter, because filtering on a left-joined `sessionSlots` relation directly would silently truncate that session's OTHER slots out of the hydrated result (corrupting `completionRate`, which depends on the session's full slot count). Within an included session, the per-slot accumulation loop also skips slots that aren't this member's, so `slotTypeStats`/`topSpeakers` reflect only their own contribution — while `completionRate`/`totalDurationMinutes` stay session-wide (those describe the whole service, not one person's slice of it).
    - **Slot Type filter** — a `<select>` of the 8 `ServiceSlotTypeEnum` values (reusing `SLOT_TYPES`/`SLOT_TYPE_CONFIG`, already defined in this file for the programme editor). Backend-side, `slotType` doesn't remove sessions from the list (a service having no "Offering" segment isn't itself meaningful to filter out) — it only restricts which slots feed into `slotTypeStats`/`topSpeakers`/the per-session `overrunSlots` count, so "compare just Offering segments across every service" resolves to a single-row breakdown table instead of scrolling past 7 other types to find it.
    - **Quick date presets** ("7d" / "30d" / "This Quarter") compute the range and fetch immediately on click, rather than just filling the date inputs and waiting for "Load" — since a preset click is already one deliberate action, requiring a second "Load" click after it would be redundant. They call `fetchAnalytics` directly with the freshly computed dates instead of going through the memoized `load()`, for the same reason `load()` itself doesn't chase its own tail: `setFrom`/`setTo` don't take effect until the next render, so calling the existing `load()` immediately afterward would still run with the previous (stale) range.
  - **Create Programme's Event picker is now searchable** — was a plain `<select>` listing every open event; replaced with the same `SearchableSelect` component used by the headcount page's Event/service-slot pickers (extracted to the shared `components/ui/searchable-select.tsx` rather than duplicated, and re-imported into the headcount page too). Each option's sublabel shows the date and sub-service count, matching the old `<option>` text.
  - **Full-event report downloads** — the Programmes list groups by event already (`groupProgrammesByEvent`); each event group's header now has a "Full Report" button (`GET /service-programme/event/:eventId/pdf`, always available — the order-of-service across every sub-service regardless of session state) plus a "Session Report" button that only appears once every programme in the group is `COMPLETED` (`GET /service-session/event/:eventId/report/pdf`, the post-service analytics report — timing, pauses, completion rate — which 400s if any session isn't finished yet, so it's hidden rather than shown-then-erroring). Both backend routes already existed and were unused by any frontend button before this. Each individual sub-service row also has its own small download icon ("download this service only", `GET /service-programme/:id/pdf`) alongside the existing detail-panel download, for a quick single-service PDF without opening the panel.
  - **"Start Service" sequential start** — a multi-service Sunday starts one sub-service at a time in slot order (First Service, then Second Service, and so on), not all at once. Each event group's header shows a "Start `<slot name>`" button whenever at least one of its programmes is still `DRAFT`, labeled with the earliest not-yet-started slot (`getNextDraftProgramme` in `page.tsx`, sorted by `serviceSlotDetail.startTime`). Calling `POST /service-session/event/:eventId/start` (`startEventSessions` in `use-service-session.ts`) starts only that one programme and returns a single session (not an array). The backend rejects the call with 409 if a session for the event is already `LIVE` — the current slot must be ended (`POST /service-session/:sessionCode/end`) before the button can start the next one. No new "EventSession" entity was introduced — `ServiceSessionService.startEvent()` still reuses the existing per-programme `start()`, it just now picks the single earliest `ServiceProgrammeService.findStartableDraftProgrammesForEvent()` result (that method sorts by `serviceSlot.startTime` ASC) instead of looping over all of them. The frontend button is disabled (with an explanatory tooltip) whenever any programme in the event group is `LIVE`, in addition to the backend's 409 — so an admin can't click it mid-service and only sees the error if state is stale.

**Access control:**
- Both controllers (`ServiceProgrammeController`, `ServiceSessionController`) carry `@RequiresPlan(PlanFeature.SERVICE_PROGRAMME)` **and** `@RequiresModule('service_programme')` at class level, covering every route including the public share-token ones. `service_programme` is `required: true` in `KNOWN_MODULES`, so `ChurchSettingsService.upsert` refuses to let a tenant admin disable it — the module gate is enforced for consistency with every other Pro-plan-gated module (sermon, incident report, volunteer, asset management, facility rental, service ratings), not because it can actually be turned off.
- Programme CRUD and reporting: `AdminGuard` + `SERVICE_PROGRAMME_READ` (reads) or `SERVICE_PROGRAMME_WRITE` (mutations). Assign these permissions to admin roles via the role management API.
- Authenticated session control (start, advance, rewind, pause, resume, adjust-time, reorder, end): controller only requires `JwtAuthGuard` (any authenticated member or admin); the real rule is enforced once in `ServiceSessionService.assertCanControlSession()` — passes for either of two groups, both individually attributable via their own authenticated `memberId` (no PIN/name workaround needed for either): an active `Admin` entity holding `SERVICE_PROGRAMME_WRITE`, **or** a worker in a department with the `FRONT_DESK_OPERATIONS` capability (checked via `DepartmentAccessService.hasCapability`, the same non-throwing boolean check `discuva-member`'s front-desk control page (`app/front-desk-session/`) relies on to decide whether to show that tile at all). This reverses an earlier, narrower version of this rule that removed department-based control access entirely (reserved for a mobile worker UI that hadn't been built yet against these endpoints) — that UI now exists, so the capability check was restored. Anyone in neither group — an external production collaborator with no Discuva account, for instance — still controls a session exclusively through the public Programme Manager link with a named PIN grant (see below). This does **not** affect `getEventSummaryReportPdfForWorker` (`GET /service-session/event/:eventId/summary-pdf`, a read-only mobile PDF download) — that keeps its own narrower `assertIsAdminDeptWorker()` check (Admin-department worker, no `SERVICE_PROGRAMME_WRITE` fallback needed), deliberately kept separate from session-control access.
- Public Programme Manager routes (`POST/PUT /service-session/:code/pm/*` — advance, rewind, pause, resume, adjust-time, reorder, end): `@Public()` + `ShareTokenGuard` (`?token=`), **and** `NamedAccessGuard` (`?grantToken=`). The share token only proves "has the link"; every PM-link holder used to be logged as the same generic `PUBLIC_LINK` actor with no way to tell people apart or revoke one person without rotating the link for everyone. `NamedAccessGuard` layers named, individually-revocable identity on top: an admin/worker calls `POST /service-session/:code/access-grants` (`{ name }`, `JwtAuthGuard` + `assertCanControlSession`) to generate a 6-digit PIN for a collaborator (`randomInt`-generated, argon2-hashed via `UtilityService`, returned in plaintext exactly once — never stored or retrievable again). That person then calls the public `POST /service-session/:code/pm/access` (`ShareTokenGuard` only — this route establishes identity, so it can't itself require `NamedAccessGuard`) with `{ name, pin }`; on success `verifyAccessGrant` issues a `grantToken` (random UUID, Redis-cached alongside `{ grantId, name }`, same TTL as the session) that must be appended to every subsequent `pm/*` write call. `NamedAccessGuard.resolveGrantToken` resolves that token, re-checks the underlying `ServiceSessionAccessGrant` row's `revokedAt` on every call (not just at sign-in), and stamps the grant's name onto the request (`@ActorLabel()`) so it flows through to `logAction`'s `actorLabel` column — surfaced as the `actorName` fallback in `getActionLog`/`getActionLogCsv` whenever there's no `performedByMember`. Revoking via `POST /service-session/:code/access-grants/:grantId/revoke` takes effect on that person's very next action, without touching the shared link or anyone else's grant. Grants are scoped to a single session (table `service_session_access_grants`, `session_id` FK `ON DELETE CASCADE`) — a new PIN is needed each time someone needs PM access to a new session, by design (no cross-session standing identity to manage). The frontend Live Session Dashboard's "Programme Manager Access" panel manages grants (add/list/revoke, showing the PIN once); the public `/live/:code/manage` view gates itself behind a name+PIN sign-in form the first time, then caches the resulting `grantToken` in `localStorage` (keyed per session) so it isn't re-prompted on every visit, clearing that cache automatically if any action comes back with a revoked/expired-access error.
- **Duplicate active names are rejected, not silently allowed** — two active grants sharing a name make sign-in ambiguous (the name+PIN lookup could match whichever row it finds first, so a correct PIN for the second grant could get rejected). `generateAccessGrant` pre-checks for a non-revoked grant with the same name (trimmed, case-insensitive) and throws `ConflictException` (409) instead of creating the duplicate; a partial unique index (`uq_service_session_access_grants_session_name_active` on `(session_id, lower(name)) WHERE revoked_at IS NULL`, migration `AddServiceSessionAccessGrantUniqueActiveName`) catches the same race at the DB level as a safety net, translated back into the same 409. The caller can pass `replaceExisting: true` on `POST /service-session/:code/access-grants` to confirm the swap — this revokes the old grant (logged as `ACCESS_GRANT_REPLACED`) and issues a fresh PIN under the same name in one call. The Dashboard's "Programme Manager Access" panel surfaces this as a "Replace?" prompt when adding a name that's already active, rather than a bare error.
- `overrideSlot` (speaker runtime override) stays `RolesGuard (WORKER)` + `FRONT_DESK_OPERATIONS` capability check only — not exposed in the admin dashboard.
- Session state read (`GET /service-session/:code/state`) and speaker slot view (`GET /service-session/:code/slots/:position`): `@Public()` — session code is the access credential. (These are read-only; the share token, not the session code, gates writes.)
- `ADMIN_WRITE` permission controls who can assign `SERVICE_PROGRAMME_READ` / `SERVICE_PROGRAMME_WRITE` to admin roles.

**WebSocket:**
- Namespace: `/service-session` — this is the primary live-update channel for all four frontend session views (see the "Live updates moved from per-client polling to Socket.IO push" bullet above); each view keeps only a slow 30s safety-net poll of the REST routes as a fallback.
- Client event `joinSession({ sessionCode })` → validates the session exists (calls `getState()`) before joining room `session:{sessionCode}`; on failure the client is not joined and receives `session:error` (`{ message }`) instead.
- Client event `leaveSession({ sessionCode })` → leaves room
- Server event `session:state` → the full `SessionStatePayload` (`{ anchor, session, effectiveSlots, cautionThresholdRatio }`) — the same shape `GET /service-session/:code/state` returns, emitted after every mutation (`advance`/`rewind`/`pause`/`resume`/`adjustTime`/`reorderLiveSlots`/`overrideSlot`/`end`, both authenticated and `pm/*` variants).
- Server event `session:error` → `{ message: string }`, emitted only on a failed `joinSession`.
- No authentication is required to join a room — session code is the read credential, matching the trust model of the public REST routes this channel replaces for live viewers. No write actions happen over the socket.
- **Redis adapter:** `@socket.io/redis-adapter` (`RedisIoAdapter`) is used instead of the default in-memory adapter. Events broadcast on one backend instance are forwarded to all other instances via Redis pub/sub, making horizontal scaling safe.
- **CORS:** validated via `createCorsOriginValidator()` (same shared validator as the HTTP API's `app.enableCors()`), not a wide-open `origin: '*'`.

**Routes prefix:** `/service-programme`, `/service-session`

### Games Module

Kahoot-style live quiz for member engagement. A `Game` (title, description, optional `department`/`churchClass` for
admin-side categorization/reporting only — **not** access control) holds an ordered list of `GameQuestion`s and is a
reusable definition that can be run multiple times via a `GameSession`. Games can only be created/edited on the admin
portal (`GAMES_WRITE`); anyone with a session's join code can participate — no department/class/role gating on the
participant side, by explicit product decision.

**Game lifecycle:** `Game.status` tracks whether it's still being edited (`DRAFT`) or currently backing a live session
(`LIVE_SESSION_ACTIVE`) — it's informational, not a gate; admins can always edit a `DRAFT` game's questions.
`startSession` requires at least one question and flips the game to `LIVE_SESSION_ACTIVE`; `endSession` reverts it to
`DRAFT` — but only if no *other* session for the game is still `LIVE` (see below), so the same game can be started
again later. `startSession` also 400s if a `LIVE` session already exists for the game — previously a double-click or
a second admin starting the same game would silently orphan the first session (its join code still worked, but
nothing in the UI could get back to it).

`Game.status` is a denormalized mirror of "does this game have a live session", and — as the guard above and the
defensive check in `endSession` both exist to address — it can drift out of sync with reality (e.g. a session left
`LIVE` from before either of those existed, or any future code path that touches a session without going through
this service). `listGames`/`getGame` therefore return an `activeSessionCode` field sourced directly from
`GameSession` (querying every `LIVE` session for the games in the batch), **not** gated by `Game.status ===
LIVE_SESSION_ACTIVE` — so the admin portal's "Resume Control" action stays correct and discoverable even for a game
whose `status` wrongly says `DRAFT` while a session is still actually running underneath it. `endSession` mirrors
this: before resetting `Game.status` to `DRAFT`, it re-checks for any other still-`LIVE` session for the same game
and skips the reset if one exists, so ending one orphan can't stomp on a genuinely-live sibling session.

**Session lifecycle:** `GameSession.sessionCode` (`GAME-XXXXXX`, same random-alphanumeric generation as
`ServiceSession.sessionCode`) is the join credential — no auth beyond being a logged-in member/worker is required to
join. `startSession` sets `currentQuestionIndex = 0` and stamps `currentQuestionStartedAt`; `nextQuestion` advances
the index and re-stamps the timestamp (400 if already on the last question — call `endSession` instead); `endSession`
is idempotent (a second call is a no-op, not an error). `hostAdmin` is recorded at start — only that admin (or any
admin if `hostAdmin` was somehow cleared) can control the session via `nextQuestion`/`endSession` (`ForbiddenException`
otherwise), independent of the general `GAMES_WRITE` permission check the route itself already enforces.

**Countdown (`GameSessionStatePayload.currentQuestionStartedAt`):** the payload carries the current question's start
time as epoch ms alongside the existing `secondsRemaining` snapshot. `secondsRemaining` is only accurate as of the
moment the payload was generated — a client that just renders it verbatim sees the countdown freeze between socket
broadcasts (previously the only source of updates: `nextQuestion`, `endSession`, or the 30s safety poll) instead of
ticking down every second. `currentQuestionStartedAt` lets a client compute its own live countdown
(`timeLimitSeconds - (Date.now() - currentQuestionStartedAt) / 1000`, ticked with a 1s `setInterval`), the same
pattern `ServiceSessionController`'s `anchor.slotStartedAt` already uses for the service-programme timer.

**Scoring (`GameService.computeScore`):** speed-bonus model — `pointsAwarded = isCorrect ? round(question.points *
max(0.5, remainingTimeFraction)) : 0`, where `remainingTimeFraction` is computed from `currentQuestionStartedAt` (a
server-side clock all participants are scored against, not each client's own page-load time) versus the question's
`timeLimitSeconds`. An instant correct answer earns full points; a correct answer submitted right at the deadline
earns 50% of the question's points; any incorrect answer earns 0. `GameParticipant.totalScore` is a running total,
incremented per response — the leaderboard itself is always computed live from `GameResponse` rows
(`SUM(pointsAwarded)` effectively, via `totalScore` and a `ORDER BY totalScore DESC` read), not a separately-audited
aggregate.

**Answer submission (`POST .../answer`) is a normal REST call, not a socket message** — matches this codebase's
discipline of keeping every scored/audited action behind the guard+validation layer. It's rejected (400) if the
session isn't `LIVE`, if the question isn't the session's *current* question (guards against a stale client
answering a question that's already advanced past), or if the participant already answered it (also enforced at the
DB level via a unique constraint on `(session_id, question_id, participant_id)` — the pre-check leaves a race window
under a concurrent double-submit, so `submitAnswer` also catches that constraint's violation (Postgres `23505`) and
returns the same 400 rather than letting a raw DB conflict surface as a `500`); 403 if the caller never called
`join` first.

**What participants never see:** `GameSessionStatePayload` (both the REST `GET .../state` response and the
`session:state` socket broadcast) never includes `correctOptionIndex` — the admin presenter view, which does need to
know the answer while presenting, already has the full question (with the answer) from its own authenticated
`GET admin/games/:id/questions` fetch, so the shared broadcast payload stays participant-safe without needing two
different payload shapes for the same event.

**Routes (admin, `AdminGuard`):**
- `POST/GET/PATCH/DELETE admin/games` (`/:id` for single-record routes) — `GAMES_READ`/`GAMES_WRITE`
- `GET/POST admin/games/:id/questions`, `PUT admin/games/:id/questions/reorder`,
  `PATCH/DELETE admin/games/questions/:questionId` — `GAMES_READ`/`GAMES_WRITE`
- `POST admin/games/:id/start`, `POST admin/games/sessions/:code/next-question`,
  `POST admin/games/sessions/:code/end` — `GAMES_WRITE`
- `GET admin/games/sessions/:code/state`, `GET admin/games/sessions/:code/leaderboard` — `GAMES_READ`

Note: `games/sessions/:code/state` on the participant controller below is `@Public()`, not `JwtAuthGuard`-gated.

**Routes (participant, `JwtAuthGuard` + `@RequiresModule('games')`):**
- `POST games/sessions/:code/join`,
  `POST games/sessions/:code/questions/:questionId/answer`, `GET games/sessions/:code/leaderboard` — any
  authenticated member/worker, no department/class/role gating
- `GET games/sessions/:code/state` — `@Public()` (still behind `ModuleEnabledGuard` and a `300/60s` throttle, same
  shape as `ServiceSessionController`'s public `:sessionCode/state`), so a projector/second-laptop presentation
  screen can poll it with just the join code — no member/admin login needed. Never leaks `correctOptionIndex` (see
  above), so widening this one route to unauthenticated access doesn't change what it exposes.

**WebSocket:**
- Namespace: `/game-session`, mirrors `/service-session` exactly — `joinSession({ sessionCode })` /
  `leaveSession({ sessionCode })` client events, room `game-session:{sessionCode}`, server event `session:state`
  carrying the full `GameSessionStatePayload`, emitted by the controller (not the service, same split as
  `ServiceSessionController`/`ServiceSessionGateway`) after every mutating admin or participant action.
- No authentication required to join — session code is the read credential. Answer submission itself never happens
  over the socket (see above).

**Routes prefix:** `/admin/games`, `/games`

**Admin frontend UX (`discuva-admin`):** mirrors the service-programme live-session split between a control surface
and a screen-safe display, rather than the one page both were previously crammed into. `app/games/present/[code]`
(`withAuth`, `games:write`) is the host's control panel — question preview, the ticking countdown, Next
Question/End Session, leaderboard — plus a "Copy Link"/"Open Screen" action for the presentation view. That view
lives at `app/games-screen/[code]` (outside `app/games/`, so it isn't wrapped in `app/games/layout.tsx`'s admin
`Shell` chrome) and is unauthenticated, full-bleed, dark-themed, big-type — built to be opened on a projector or a
second laptop via the copied link, same pattern as `/live/[code]/presentation`. Both pages tick a local
`setInterval(() => setNowMs(Date.now()), 1000)` and derive `secondsRemaining` from `currentQuestionStartedAt` via
`calcGameSecondsRemaining()` (`hooks/use-games.ts`) instead of rendering the payload's `secondsRemaining` snapshot
directly, fixing a bug where the on-screen countdown only changed when a broadcast arrived instead of counting down
every second. The games list (`app/games/page.tsx`) and detail (`app/games/[id]/page.tsx`) pages surface a "Resume
Control"/"Resume Live Session" action off the new `activeSessionCode` field for any `LIVE_SESSION_ACTIVE` game.

`GameSessionStatePayload.gameTitle` (`session.game.title`) is included so the control panel and the presentation
screen can both display which game is running instead of just the join code — most visibly on the end-of-session
card, which previously only said "Session Ended" with no indication of which game just finished. Both now lead with
the game's title and a warmer "That's a wrap" framing, plus (on the control panel) the leaderboard's #1 entry inline
("`{name}` takes the win with `{score}` pts!").

**Member-facing player (`discuva-member` mobile, `components/layout/game-session.tsx`, `hooks/use-game-session.ts`):** this
surface fetches the same public `GameSessionStatePayload` but polls it on its own schedule (`LIVE_POLL_MS` = 2s while
a question is active, no socket) rather than sharing the admin/screen views' socket-driven state — it had fallen out
of sync with the countdown fix above (rendering the raw `secondsRemaining` snapshot, only visibly updating once per
poll) and was missing the `gameTitle`/`currentQuestionStartedAt` fields entirely. Brought in line: `calcGameSecondsRemaining()`
(mirroring the same-named helper in `use-games.ts`) ticks a local `nowMs` every second off `currentQuestionStartedAt`,
and the game title now renders above the question.

**Admin question-builder (`app/games/[id]/page.tsx`, `QuestionForm.removeOption`):** deleting the option currently
marked correct used to silently reassign "correct" to whichever option shifted into that slot instead of clearing
the selection — e.g. options `[A,B,C,D]` with `C` marked correct, deleting `C`, silently left `B` marked correct
with no admin action. Now deleting the correct option resets `correctOptionIndex` to an unset sentinel (`-1`) and
`canSubmit` requires a non-negative index, so the form blocks saving until the admin explicitly re-picks the correct
answer.

**"Status stays on Draft" investigation:** confirmed via direct testing that `startSession`/`endSession` flip
`Game.status` correctly and immediately server-side (this Next.js version's client Router Cache also defaults
`staleTimes.dynamic` to `0`, so it wasn't a caching issue either). The frontend list/detail pages
(`app/games/page.tsx`, `app/games/[id]/page.tsx`) still call `router.refresh()` after starting/ending a session, and
listen for `pageshow`/`visibilitychange` to refetch if the page was restored from the browser's back-forward cache
(bfcache) — real, if secondary, sources of staleness for a plain client-fetched list. But the actual bug reproduced
in this instance was the `Game.status` drift described above: a session left `LIVE` from before the duplicate-session
guard existed meant a *later* session's `endSession` call reset `Game.status` to `DRAFT` while the orphaned earlier
session was still `LIVE` underneath — so the list correctly showed `DRAFT` (matching `Game.status`), while
`startSession` correctly 400'd on any attempt to start a new one, with no UI path back to the still-live orphan since
`activeSessionCode` was, at the time, also gated on `Game.status === LIVE_SESSION_ACTIVE`. Sourcing
`activeSessionCode` directly from `GameSession` (above) closes that gap.

### Service Rating Module

Member-to-church pulse after a service — a 1–5 star rating plus optional comment, keyed off `(event, serviceSlot,
member)` (the same pair `Attendance` keys off, not `ServiceSession` — the live-control-room entity, which isn't
guaranteed to exist for every service). Structurally distinct from the Pastor Feedback module: Pastor Feedback is
worker/HOD → leadership, weekly, per-department narrative reporting; this is member → church, per-service,
numeric+comment. `POST service-ratings` upserts — one rating per member per service occurrence, submitting again
edits the existing row in place.

**Anonymity design:** the admin comment feed (`GET admin/service-ratings/comments`) never joins/exposes member
identity unless the requesting admin's role includes `SERVICE_RATING_MODERATE` — `service_rating:read` alone gets an
aggregate view and an anonymized comment feed (`member: null` per row); `service_rating:moderate` additionally
reveals `member: { id, firstname, lastname }` on the same response and is required to delete/hide a comment
(`DELETE admin/service-ratings/:id`). This is deliberate: default admin access should give a pulse on sentiment
without turning ratings into a place to publicly identify who said what about a specific worker/sermon.

**Index:** `getComments()` filters `WHERE comment IS NOT NULL ORDER BY created_at DESC` across all events (a global
moderation feed, not scoped to one event/slot) — served by a partial index,
`IDX_service_ratings_created_at_with_comment ON service_ratings (created_at DESC) WHERE comment IS NOT NULL`, which
stays small since most ratings have no comment.

**`getSummary()` aggregates in SQL:** `GROUP BY rating` (at most 5 rows back), not a `getMany()` that pulls every
matching row into memory to sum/count in application code — this endpoint is unbounded by design (any date range,
any event), so aggregating in Postgres keeps it flat as ratings accumulate instead of degrading linearly.

**Mobile comment capture (`discuva-member`, `components/layout/attendance.tsx`):** the star-tap itself still submits
instantly with no comment (unchanged, one-tap). Once rated, an "Add a note" affordance appears — expands a small
textarea, and sending it re-calls `submitRating` with the same rating plus the comment (an upsert, so no separate
endpoint). Previously nothing in the UI ever sent a comment, so the admin moderation feed above was unreachable in
practice regardless of backend support.

**Routes (member, `JwtAuthGuard` + `@RequiresModule('service_ratings')`):** `POST service-ratings` (upsert),
`GET service-ratings/mine?eventId=&serviceSlotId=` — always returned `comment` on the full entity; the mobile widget
above now actually reads it, to restore an existing note on revisit.
**Routes (admin, `AdminGuard`):** `GET admin/service-ratings/summary?eventId=&from=&to=` (`SERVICE_RATING_READ`,
average + 1–5 distribution), `GET admin/service-ratings/comments?page=&limit=` (`SERVICE_RATING_READ`),
`DELETE admin/service-ratings/:id` (`SERVICE_RATING_MODERATE`, logs `SERVICE_RATING_MODERATED`).

**Not audited:** individual rating submissions — matches the existing judgment call on high-frequency member actions
(same as Games answers and announcement reactions). Only moderation (deletion) is audited.

**Routes prefix:** `/service-ratings`, `/admin/service-ratings`

### Volunteer Module

A self-service serving marketplace — admins post `VolunteerOpportunity` records (title, optional description,
`department` for admin-side categorization/reporting only — **not** access control, same convention as `Game`),
members browse and sign themselves up. Genuinely new interaction pattern for this codebase: every other
member-facing "assignment" (department membership, prayer roster, service-programme slots) is admin-assigned:
this is the first admin-*posts*-a-slot / member-*claims*-it flow.

**Capacity enforcement:** `VolunteerOpportunity.confirmedCount` is a denormalized counter (mirrors
`PrayerMeeting.currentCapacity`'s precedent), maintained inside a DB transaction that takes a `pessimistic_write`
lock on the opportunity row before checking `capacity` and incrementing/decrementing — this is the same
lock-then-check-then-mutate shape `PrayerMeetingService.selectMeeting` already uses, preventing two concurrent
sign-ups from both slipping past a capacity check that a non-transactional COUNT query could race. `capacity: null`
means unlimited.

**Sign-up is an upsert, not insert-only:** `VolunteerSignup` is unique on `(opportunity, member)`. Cancelling
(`status → CANCELLED`) and re-signing-up flips the same row back to `CONFIRMED` rather than erroring on a duplicate
key or leaving orphaned rows — same "one row per (parent, member), status toggles" idiom as `AnnouncementReaction`
and `ServiceRating`, just with a two-state status instead of upsert-the-value.

**No hard delete on opportunities:** the admin "remove" action is `PATCH .../cancel` (→ `status = CANCELLED`,
audit-logged), not `DELETE` — mirrors this codebase's general preference for deactivation over deletion
(see Member Deletion Policy) once a record may have dependent children (signups here).

**Member list includes own status inline (`GET volunteer-opportunities`):** each row carries
`mySignupStatus: 'CONFIRMED' | 'CANCELLED' | null` for the requesting member, computed via one extra batched query
against the returned page's opportunity IDs — avoids a separate "my signups" round-trip just to render a
Sign-Up-vs-Cancel button per row. Only `status = OPEN` and `date >= now` opportunities are listed (past/closed/
cancelled opportunities don't show in the browse list, though they remain visible to admins) — this is the
member-facing "browse open opportunities" feed, hit on every load, served by a composite
`IDX_volunteer_opportunities_status_date ON volunteer_opportunities (status, date)` index (in addition to the
original date-only index from the marketplace's initial migration).

**Mobile pagination (`discuva-member`, `hooks/use-volunteer.ts`):** the backend route was already properly paginated
(`page`/`limit`); the mobile hook previously just hardcoded `limit=50` and never advanced past page 1, silently
truncating the browse list once a church had more than 50 concurrently-open opportunities. Now tracks `page`/
`totalPages` and exposes `goToPage`, rendered as the same prev/next pager `components/layout/sermons.tsx` already
established for its own list — the standard pattern for a paginated list on this mobile app.

**Routes (admin, `AdminGuard` + `ModuleEnabledGuard`):** `POST/GET/PATCH admin/volunteer-opportunities` (`/:id` for
single-record routes), `PATCH admin/volunteer-opportunities/:id/cancel`,
`GET admin/volunteer-opportunities/:id/signups` (roster, CONFIRMED only) — all `VOLUNTEER_READ`/`VOLUNTEER_WRITE`.
`VolunteerAdminController` is also `@RequiresModule('volunteering')` (previously missing — every other admin
controller in this codebase pairs `AdminGuard` with `ModuleEnabledGuard`; without it, admins could manage
opportunities even with the `volunteering` module disabled in church settings, inconsistent with the member-facing
controller which already had the check).
**Routes (member, `JwtAuthGuard` + `@RequiresModule('volunteering')`):** `GET volunteer-opportunities`,
`POST volunteer-opportunities/:id/signup`, `DELETE volunteer-opportunities/:id/signup` — any authenticated
member/worker, no department/class gating (open to anyone, same "no access-control implication" stance as `Game`
and `Sermon`'s `department`/categorization fields).

**Not audited:** routine cancel-my-own-signup — matches the established judgment on high-frequency, low-stakes
member actions. `VOLUNTEER_SIGNUP_CREATED` (a commitment, worth a record unlike a passive reaction) and admin
actions (`VOLUNTEER_OPPORTUNITY_CREATED`/`_UPDATED`/`_CANCELLED`) are audited.

**Routes prefix:** `/volunteer-opportunities`, `/admin/volunteer-opportunities`

### Member Directory Module (`src/member-directory/`)

Opt-in professional/business discoverability — members search each other by name, occupation, business, or skills
("who in the church is an accountant," "does anyone run a catering business") to drive collaboration. Deliberately
scoped narrower than the original idea it came from: member-to-member chat and member-created interest groups were
both explicitly deferred (chat as a genuine trust/safety decision to make deliberately later, not a technical
default; interest groups deprioritized in favor of shipping the directory itself first).

**Entity** `MemberDirectoryProfile` (`member_directory_profiles`) — a separate entity from `Member` rather than
columns bolted onto it, so the whole feature stays cleanly removable via one migration if it's ever pulled: 1:1 with
`Member` (`member_id` unique FK, `ON DELETE CASCADE`), `occupation`, `businessName` (kept separate — "I'm an
accountant" and "I run Adaeze's Catering" are independent facts a member may want to share one, both, or neither
of), `skills` (free text, comma-separated — deliberately not a Postgres array column, so it stays searchable with
the same `LOWER(...) LIKE` convention as every other field here, no new query technique), `bio` (text).

**Visibility is opt-in, no moderation step** — `isVisible` (default `false`) mirrors `Testimony.isPublic`'s
"submitter's own flag, no separate publish/approval step" precedent. `showPhone`/`showEmail` (both default `false`)
are deliberately separate from `isVisible`: surfacing contact info is a materially bigger privacy step than showing
an opted-in occupation/business/bio, so a member can be discoverable without exposing how to reach them directly.

**Search** (`MemberDirectoryService.search`) reuses this codebase's existing search convention
(`MemberService.getAll`'s `LOWER(field) LIKE LOWER(:s)` pattern) across `firstname`/`lastname`/`occupation`/
`businessName`/`skills`, scoped to `isVisible = true` only. The response mapping omits `phoneNumber`/`email` per row
unless that row's own `showPhone`/`showEmail` is true — the same "deliberately trim sensitive fields out of the
response" precedent `MemberService.searchActiveMembersLite()` already established for the admin check-in picker.
Paginated (Pagination Policy: member lists grow unboundedly).

**Discoverability nudge**: `GET member-directory/me/completion` returns whether a member's own listing is visible
and has at least one of occupation/business/skills set (`isDiscoverable`) — the frontend uses this to show a prompt
encouraging the member to fill in their profile and opt in, directly serving the "get members to add their
professional/business details" goal rather than leaving the feature to sit empty by default.

**Admin analytics** (`GET admin/member-directory/analytics`, `MEMBER_DIRECTORY_READ`, read-only by design — admin
never edits an individual member's listing, only views aggregates): total opted-in count and a profession
breakdown grouped by `occupation`, each with the list of members holding it, sorted by count descending. Never
returns phone/email regardless of a member's own `showPhone`/`showEmail` choice — this is a church-wide statistics
view, not a directory lookup; an admin who needs to contact a member already has that via the regular member
record.

**Gated on three independent axes:**
- `KNOWN_MODULES` key `member_directory` (`required: false`) — tenant admin's own on/off toggle.
- `PlanFeature.MEMBER_DIRECTORY` — Pro plan only (migration `AddMemberDirectoryToProPlan` appends it to the
  already-seeded `pro` row's `features` array, same idiom as `AddFormsToProPlan`).
- `KNOWN_ASSETS` key `member-directory-hero` — lets a tenant admin upload a custom header image for the directory
  screen via the existing Appearance page (`GET tenant/assets/catalog` is rendered generically there, so no
  discuva-admin change was needed for this to appear).

**Routes prefix:** `/member-directory` (member/worker, `JwtAuthGuard` + `ModuleEnabledGuard` + `PlanGuard`),
`/admin/member-directory` (admin, `AdminGuard` + same module/plan guards).

### Small Group Module (displayed to users as "Fellowships")

Cell/home-fellowship tracking — the structural gap identified as the biggest single engagement-platform gap for
the target congregations (most run more on cell structure than department structure). Three entities: `SmallGroup`
(name unique, description, `leader` — a `Member`, deliberately **not** restricted to `WorkerProfile`/`Admin` since
cell leaders in this context aren't necessarily on the worker roster — meetingDay/meetingLocation as free-text,
not an enum), `SmallGroupMember` (join table, unique on `(group, member)`), `SmallGroupAttendance` (unique on
`(group, member, meetingDate)` — re-recording the same date edits in place, same upsert idiom as
`ServiceHeadcount`).

**Venue + online meeting support:** `SmallGroup` also carries `venue` (`Venue | null`, ManyToOne, `SET NULL` on
delete — informational only, unlike `EventConfig.defaultVenue`'s `RESTRICT`, since losing the link on venue
deletion doesn't break any live check-in flow), `meetingFormat` (`MeetingFormatEnum`, shared with `EventConfig`,
default `IN_PERSON`), and `meetingLink` (`string | null`). `venue` is added **alongside**, not instead of, the
existing free-text `meetingLocation` — most fellowships meet informally (e.g. a member's home) with no registered
`Venue` row, so `venue` only covers the minority case of a fellowship meeting at an actual church-registered venue.
No cross-field validation is enforced server-side (unlike `EventConfig`'s IN_PERSON/ONLINE venue requirement) — a
fellowship is a much softer entity than a live check-in service, so an admin can freely leave both `venue` and
`meetingLocation` unset, or set either/both regardless of `meetingFormat`.

**Membership is self-service, no approval step:** `POST small-groups/:id/join` upserts-by-returning-existing
(mirrors `VolunteerService.signUp`'s "already confirmed → return the existing row" shape) rather than erroring on
a duplicate join — including under a concurrent double-tap: the initial existence check leaves a race window before
the insert, so `join()` also catches the `(group, member)` unique-constraint violation (Postgres `23505`) and
re-fetches/returns the now-existing row instead of letting a raw DB conflict surface as a `500`. `DELETE
small-groups/:id/leave` is self-leave; admin-forced removal (`DELETE admin/small-groups/:id/members/:memberId`) is a
separate action, audited `SMALL_GROUP_MEMBER_REMOVED` (routine self-join/leave is not audited — matches the
established judgment on high-frequency member actions).

**A group's leader is not auto-enrolled as a member:** `create`/`update` only set `SmallGroup.leader`, they never
insert a `SmallGroupMember` row for that person. `getMembers()`'s access check (`assertIsGroupMember`) therefore also
accepts the caller being `group.leader.id`, not just an existing membership row — otherwise a leader who never
separately "joined" their own group would be locked out of viewing its own roster (the mobile "Take Attendance" flow
calls this route first). `assertIsGroupLeader()` (used by `recordAttendance`) already worked this way; this just
brings roster access in line with it.

**Index:** `listMine()` (a member's "My Fellowships" tab) filters `small_group_members` by `member_id` alone. The
table's only prior index was `IDX_small_group_members_group_id` plus the `(group_id, member_id)` unique constraint —
both lead with `group_id`, so neither serves a member-only lookup. Added
`IDX_small_group_members_member_id ON small_group_members (member_id)`.

**Admin `getRoster`/`getAttendanceHistory` are now paginated:** both previously returned every row for a group
unbounded — `getAttendanceHistory` in particular grows forever (one row per member per meeting, for the life of the
group), against the documented pagination policy. Both now take `page`/`limit` and return the standard
`PaginationResponseDto` shape (`{ data, page, limit, totalCount, totalPages }`) instead of a bare array — a breaking
response-shape change for `GET admin/small-groups/:id/members` and `GET admin/small-groups/:id/attendance`, updated
on the only consumer (`discuva-admin/app/small-groups/page.tsx`, `hooks/use-small-groups.ts`) to unwrap
`res.data.data.data` and render the shared `PaginationBar` per tab, same pattern the groups list itself already
used. Backed by two new composite indexes (`ORDER BY meeting_date DESC`/`created_at ASC` within a group, previously
only covered by the single-column `group_id` index):
`IDX_small_group_attendance_group_id_meeting_date ON small_group_attendance (group_id, meeting_date DESC)` and
`IDX_small_group_members_group_id_created_at ON small_group_members (group_id, created_at ASC)`.

**Leader-gated attendance-recording, not admin-gated:** `POST small-groups/:id/attendance` sits under
`JwtAuthGuard`, not `AdminGuard` — a group leader need not be a worker or admin, so `SmallGroupService`'s private
`assertIsGroupLeader()` (mirrors `assertHasCapability`'s shape: throws `ForbiddenException` if
`group.leader?.id !== callerId`) is the only gate, independent of the admin permission system entirely. Body:
`{ meetingDate, records: [{ memberId, status }] }` — each record upserts against the unique
`(group, member, meetingDate)` constraint.

**Full member roster requires group membership (`GET small-groups/:id/members`):** gated by
`assertIsGroupMember()` (any current member, not leader-only) — lets a leader see who to mark attendance for and
lets ordinary members see their own group's "family," while still keeping the full roster invisible to a member
who's browsing groups they haven't joined yet. The browse list (`GET small-groups`) only exposes a `memberCount`,
not the roster itself.

**No archive/cancel state (unlike `VolunteerOpportunity`):** `DELETE admin/small-groups/:id` is a real delete —
groups are simpler organizational units without the same "keep history after the window closes" need a volunteer
opportunity has, so this follows `Game`'s full-CRUD precedent rather than `VolunteerOpportunity`'s
cancel-don't-delete one.

**Routes (admin, `AdminGuard`):** `POST/GET/PATCH/DELETE admin/small-groups` (`/:id` for single-record routes),
`GET admin/small-groups/:id/members?page=&limit=`, `DELETE admin/small-groups/:id/members/:memberId`,
`GET admin/small-groups/:id/attendance?page=&limit=` — all `SMALL_GROUP_READ`/`SMALL_GROUP_WRITE`.
**Routes (member, `JwtAuthGuard` + `@RequiresModule('small_groups')`):** `GET small-groups`, `GET small-groups/mine`,
`GET small-groups/:id`, `GET small-groups/:id/members` (current members only), `POST small-groups/:id/join`,
`DELETE small-groups/:id/leave`, `POST small-groups/:id/attendance` (leader only, enforced in-service not by guard).

**Routes prefix:** `/small-groups`, `/admin/small-groups`

---

### Platform Admin (Control Plane)

The SaaS control plane for the multi-tenant/freemium platform — see `docs/MULTI_TENANT_MIGRATION.md` for the full
design. Entirely separate from everything else in this document: it operates on `public` schema tables
(`tenants`, `platform_admins`, `plans`, `subscriptions`, `communication_providers`,
`tenant_communication_provider_configs`, `giving_providers`, `tenant_giving_provider_configs`,
`payment_providers`) that describe *tenants themselves*, never a tenant's own
business data, and authenticates against a completely disjoint identity system (`PlatformAdmin`, not `Member`/`Admin`).

**Auth:** `PlatformAdminGuard` (validates the `platform-admin-jwt` Passport strategy, signed with
`PLATFORM_ADMIN_JWT_SECRET` — a different secret from `JWT_SECRET`, so a tenant token can never pass as a platform
one or vice versa). The whole controller is `@Public()` at the class level — this is load-bearing, not
decorative: `JwtAuthGuard` is a global `APP_GUARD` that runs on every route regardless of any `@UseGuards()` also
applied, and a platform admin never has a tenant JWT to satisfy it. `@Public()` skips only that global guard;
`PlatformAdminGuard` still independently protects every route except login.

**Refresh session (`POST /platform/auth/refresh`):** access tokens are short-lived (`PLATFORM_ADMIN_JWT_EXPIRY_IN`,
default `1h`) and the frontend only ever keeps one in memory, never `localStorage` — so until this existed, a page
reload (or the access token simply expiring mid-session) logged every platform admin out unconditionally, with no
recovery besides a fresh password login. `POST /platform/auth/login` now also signs a refresh token
(`PLATFORM_ADMIN_REFRESH_JWT_SECRET`/`_EXPIRY_IN`, default `7d` — deliberately its own secret, not shared with
either `PLATFORM_ADMIN_JWT_SECRET` or the tenant-side `REFRESH_JWT_SECRET`) and sets it as an httpOnly
`platform_refresh_token` cookie, scoped to path `/v1/platform/auth` and never returned in the JSON body.
`PlatformAdminRefreshJwtStrategy` reads that cookie name specifically — deliberately distinct from the tenant
member/admin `refresh_token` cookie, since both are set by the same shared `api.discuva.org` host across every
frontend origin, and reusing the same cookie name would let one clobber the other for any browser logged into both
discuva-admin and discuva-platform. `refreshAccessToken()` is stateless (no session/rotation-tracking table,
matching the access-token strategy's own `validateById` re-check) — it just re-confirms the admin is still active
and issues a fresh token pair; the browser keeps sending the same refresh cookie until its own 7-day expiry.
`POST /platform/auth/logout` clears the cookie (previously logout was purely client-side, never told the backend at
all — the cookie would have just kept silently re-authenticating an ostensibly "logged out" session otherwise).

**Permissions (`PlatformAdminPermission`, `src/platform-admin/enum/`).** Every platform admin used to be binary —
`isActive: true` meant full access to every `/platform/*` route, `false` meant none. `PlatformAdminRole` (mirrors
tenant-side `AdminRole` exactly: `name`, `description`, `permissions: string[]`) now sits between them, and
`PlatformAdminGuard` does double duty as both the JWT-validating guard *and* the permission-checking guard (unlike
tenant-side, where a global `JwtAuthGuard` + a separate per-route `AdminGuard` split that job — `/platform/*` has no
global-guard equivalent to lean on, since every platform controller applies `PlatformAdminGuard` explicitly). A
platform admin's permissions are loaded once, at JWT-validation time (`PlatformAdminAuthService.validateById`
eager-loads the `platformAdminRole` relation), not a second DB round-trip per request. `@RequiresPlatformPermission(...)`
mirrors tenant-side `@RequiresPermission(...)` and is applied per-route (or once at class level when every route in
a controller needs the same permission, e.g. `PlatformAnalyticsController`). Thirteen permissions across seven
groups — see `PlatformAdminPermissionGroups` for the exact list, used to render a grouped permission picker.
`BROADCAST_WRITE` (added alongside the tenant-broadcast capability below) needed a data migration, not just an
enum addition, to actually reach an already-seeded `SuperAdmin` role — `PlatformAdminRole.permissions` is a plain
`text[]` snapshotted once at row-creation time (`DefaultPlatformAdminSeed` never re-syncs an existing role against
the enum on later boots), so adding a new permission value does nothing for a platform admin whose role already
existed. See `1792371600000-GrantSuperAdminBroadcastPermission.ts`.

**Tenant health stats** (`GET /platform/tenants`) include live `memberCount`/`eventCount` per tenant via
schema-qualified reads — cheap at the tens-to-low-hundreds tenant scale this product targets today, not a design
that scales to thousands of tenants without revisiting. **`impersonate`** issues a short-lived, access-token-only
JWT (no refresh token, no session record) signed directly rather than through the normal admin-login path — see
the code comment on `PlatformTenantService.impersonateTenant` for why. `TenantMiddleware` is wired into the live
request pipeline (§5 Multi-Tenant Request Scoping below), so that token routes to the correct tenant schema like
any other tenant-facing request.

Every method that hands a tenant back to a platform-admin caller (`listTenants`, `createTenant`, `updateTenant`,
`suspendTenant`) goes through one private `toHealthShape()` builder — previously `createTenant`/`updateTenant`/
`suspendTenant` returned the raw `Tenant` entity via `tenantRepo.save()`, leaking internal columns
(`schemaName`, `clusterId`, `parentTenantId`, `shareDataWithParent`/`shareGivingWithParent`) that have no business
being visible outside this service. All four routes now return the identical curated shape.

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/platform/auth/login` | Platform admin login — `{ email, password }`, returns `{ accessToken, requiresPasswordChange }` and sets the httpOnly `platform_refresh_token` cookie. |
| POST | `/platform/auth/refresh` | `PlatformAdminRefreshJwtAuthGuard` (validates the refresh cookie, a separate check from `PlatformAdminGuard`). Returns a fresh `{ accessToken }` and re-sets the refresh cookie. |
| POST | `/platform/auth/logout` | Clears the refresh cookie. `204`. |
| GET | `/platform/tenants` | List all tenants — profile fields (`logoUrl`/`tagline`/`address`/`supportEmail`/`currency`/`timezone`), `onboardingStatus`, plan/subscription status, and live member/event counts. |
| POST | `/platform/tenants` | Provisions a new tenant inline (`TenantProvisioningService.provision()`, not the queue self-serve `/signup` uses — see "Async Tenant Provisioning + Onboarding State Machine" above). Body has no password field, same as `/signup`'s `SignupDto` — the new admin gets a welcome email with a set-password link instead (see "Tenant Welcome / Set Password Flow" above). Returns the tenant already `onboardingStatus: ACTIVE`, same shape as `GET /platform/tenants`' rows. |
| GET | `/platform/tenants/:id/onboarding-events` | The platform-level onboarding audit trail for one tenant, oldest first — see "Async Tenant Provisioning + Onboarding State Machine" above. |
| PATCH | `/platform/tenants/:id` | Update name, logo, tagline, address, support email, currency, timezone. Returns the same shape as `GET /platform/tenants`' rows. |
| PATCH | `/platform/tenants/:id/suspend` | `{ suspend?: boolean }`, default `true` — same route handles reactivation via `{ suspend: false }`. Returns the same shape as `GET /platform/tenants`' rows. |
| PATCH | `/platform/tenants/:id/plan` | Manually change a tenant's plan — comps, support fixes. Sets `Subscription.status` to `active` regardless of its prior value, so a `canceled`/`past_due` tenant regains access immediately rather than waiting on the next billing-provider webhook. Invalidates `PlanGuard`'s cached feature list. |
| PATCH | `/platform/tenants/:id/discount` | Apply an internal comp — `{ discountType: 'percentage' \| 'fixed_amount', discountValue, discountReason?, discountExpiresAt? }`. Requires an existing subscription. Never touches checkout/a payment provider — see Billing & Checkout above. |
| DELETE | `/platform/tenants/:id/discount` | Clear a tenant's discount. |
| POST | `/platform/tenants/:id/impersonate` | Issue a scoped support token for that tenant's admin. |
| GET | `/platform/plans` | List plan rows (every currency/interval variant of every tier). |
| POST | `/platform/plans` | Create a plan row — `tierKey` and `billingInterval` required, group it with sibling currency/interval variants. See "Multi-currency, multi-interval tiers" under Billing & Checkout above. |
| PATCH | `/platform/plans/:id` | Edit a plan row's price/currency/`billingInterval`/features/`featureLimits`/`tierKey`. `400` if changing `currency` or `billingInterval` on a row that already has a `billingProviderPriceId` — see "Multi-currency, multi-interval tiers" above. |
| GET | `/platform/capabilities` | `[{ key, label }]` — every valid `features`/`featureLimits` key (every `KNOWN_MODULES` entry plus the 4 module-less `PlanFeature` values), labeled for the Plans page's checkbox list. See "Every toggleable module is also a plan-assignable capability" above. |
| GET | `/platform/subscriptions` | List all subscriptions — spot `past_due` churn risk. |
| GET | `/platform/communication-providers` | List platform-wide registered SMS/email providers. |
| POST | `/platform/communication-providers` | Register a new provider — `{ id, channel, name }`. |
| PATCH | `/platform/communication-providers/:id` | `{ isActive: boolean }` — activate/deactivate a provider in the platform-wide catalog. See "Communication Providers: deactivation has real consequences" below for what this actually does to a tenant already using the provider. |
| GET | `/platform/tenants/:id/communication-providers` | A tenant's active provider per channel — never the raw encrypted credentials. |
| GET | `/platform/analytics/overview`\|`/growth`\|`/revenue`\|`/engagement`\|`/churn`\|`/adoption` | Cross-tenant business metrics — see "Platform Analytics" below. |
| GET | `/platform/tenants/:id/billing-sessions` | This tenant's checkout session history, newest first. |
| POST | `/platform/billing-sessions/:sessionId/refund` | Refund a completed checkout via the original provider — see Billing & Checkout above. |
| GET | `/platform/admin-roles` | List platform admin roles. |
| GET | `/platform/admin-roles/:id` | Get one platform admin role. |
| POST | `/platform/admin-roles` | Create a role — `{ name, description?, permissions: PlatformAdminPermission[] }`. |
| PATCH | `/platform/admin-roles/:id` | Edit a role's name/description/permissions. |
| DELETE | `/platform/admin-roles/:id` | Delete a role — `400` if any active platform admin is still assigned to it. |
| GET | `/platform/admins` | List platform admins with their role. |
| GET | `/platform/admins/me` | The calling platform admin's own record + permissions — no permission requirement beyond a valid token. |
| GET | `/platform/admins/:id` | Get one platform admin. |
| POST | `/platform/admins` | Onboard a new platform admin — `{ email, platformAdminRoleId }`. No password field — the new admin gets a welcome email with a set-password link instead (see below). |
| PATCH | `/platform/admins/:id` | Change role and/or `isActive`. `403`s if `id` is the caller's own — see below. |
| POST | `/platform/auth/forgot-password` | Public, rate-limited (5/min). Request a password-reset OTP for a platform admin. |
| POST | `/platform/auth/reset-password` | Public, rate-limited (5/min). Verify the OTP and set a new password — also how a newly-onboarded admin sets their initial one. |
| POST | `/platform/broadcast` | `{ subject, message }` (plain text, not HTML) — one email to every active tenant's oldest active admin. See "Tenant Broadcasts" below. |
| GET | `/platform/settings` | List platform-wide settings (grace period + the five upload-size limits) — see "Platform Settings" below. |
| PATCH | `/platform/settings/:key` | `{ value: number }` — edit a platform-wide setting live, no redeploy. `BILLING_WRITE`. |

#### Platform Settings

A generic, platform-wide (not per-tenant) key/value settings store — the platform-admin equivalent of the tenant-side
Church Settings module above, but living in `public` schema with no tenant dimension: new `PlatformSetting` entity
(`key` unique, `value: jsonb`), read/written through `PlatformSettingsService`, same short-TTL cache pattern as
`ChurchSettingsService`/`ReminderSettingsService`. `KNOWN_PLATFORM_SETTINGS`
(`src/platform-admin/constant/known-platform-settings.constant.ts`) is the whitelist — each entry now carries
`min`/`max` alongside `label`/`unit`/`defaultValue`, enforced server-side in `PlatformSettingsService.upsert()`
(`400` if out of range) since these vary per key and can't all share one class-validator bound. `GET`/`PATCH
/platform/settings` responses include `min`/`max` too, so the frontend renders the right bounds per setting instead
of a hardcoded range.

**Consumer 1 — subscription grace period:** `SubscriptionLapseScheduler` used to read `GRACE_PERIOD_DAYS` from
an env var once at boot (a single global value, requiring a redeploy to change). It now calls
`PlatformSettingsService.getSubscriptionGracePeriodDays()` once per daily run instead — still a single global value
(not per-tenant: this is billing/revenue policy Discuva sets uniformly, not a per-church preference — a deliberate
distinction from the tenant-facing Reminder Settings module above, which covers per-church operational preferences).
The `GRACE_PERIOD_DAYS` env var and its Joi entry have been removed; any deployed value for it is now inert.

**Consumer 2 — upload size limits:** `MAX_LOGO_UPLOAD_MB`, `MAX_AVATAR_UPLOAD_MB`, `MAX_CLASS_MATERIAL_UPLOAD_MB`,
`MAX_FINANCE_PROOF_UPLOAD_MB`, `MAX_FORM_ATTACHMENT_UPLOAD_MB`, `MAX_PAGE_IMAGE_UPLOAD_MB` — stored in **MB** (not bytes, since that's what a platform admin actually types into
the settings form), read via `PlatformSettingsService.getMaxUploadBytes(key)` which converts to bytes. These
replace the `MAX_LOGO_UPLOAD_BYTES`/`MAX_AVATAR_UPLOAD_BYTES`/`MAX_CLASS_MATERIAL_UPLOAD_BYTES`/
`MAX_FINANCE_PROOF_UPLOAD_BYTES` env vars entirely (removed from `env.validation.ts`) — `MAX_FILE_UPLOAD_BYTES`
remains an env var, unaffected, since it's the fallback for routes with no dedicated category (incident report
photos, member bulk-import).

**Fixed: tenant-scoped cache namespacing bug.** `CacheService.get`/`set`/`del` always namespace by whatever tenant
(if any) is in CLS context — correct for genuinely per-tenant data, but `PlatformSettingsService`'s values aren't
tenant-specific. A platform-admin write has no tenant context (scopes to `tenant:global:...`), but
`getMaxUploadBytes()` is called from a real tenant-scoped upload request, so it was caching under
`tenant:<that-tenant's-id>:...` — a platform-admin change never invalidated it, leaving each tenant serving a stale
limit for up to the 300s cache TTL after every change. `CacheService` now exposes `getGlobal`/`setGlobal`/
`delGlobal` (a genuinely separate `global:...` key namespace, not the tenant-scoped methods' coincidental
`'global'` fallback), and `PlatformSettingsService` uses them for every cache call, including
`getSubscriptionGracePeriodDays()` — which happened to dodge this bug only because `SubscriptionLapseScheduler`
calls it before entering any per-tenant loop, not because it was actually correct.

Enforcing a *live* limit is a real constraint Multer doesn't support natively: `limits.fileSize` has to be a static
number known when the route is decorated, it can't await a DB/cache read per request. `DynamicLimitedFileInterceptor`
(`src/utility/interceptors/dynamic-limited-file.interceptor.ts`) resolves this by letting Multer parse against a
generous, non-configurable hard ceiling (`UPLOAD_HARD_CEILING_BYTES`, always ≥ the setting's `max`) as a safety net,
then checking the *actual* parsed file's size against the live platform-configured limit inside `intercept()`
afterward, rejecting with an accurately-labeled `PayloadTooLargeException` if it's over. A file between the live
limit and the hard ceiling is still fully buffered before being rejected — an accepted tradeoff given how small
these ceilings are (tens of MB), rather than reimplementing Multer's own streaming internals. `TenantInfoController`
(logo + appearance assets), `MemberController` (`me/photo`), `ClassesController` (`materials/upload`), and
`FinanceWorkerController` (`requests` attachment) all use this interceptor now instead of the static
`LimitedFileInterceptor`.

`PlatformAdminModule` is now `@Global()` so `PlatformSettingsService` can be injected into
`DynamicLimitedFileInterceptor` from any consuming module (`TenantModule`, `MemberModule`, `ClassesModule`,
`FinanceRequestModule`) without each needing an explicit import path — same reasoning `UtilityModule` documents for
its own `@Global()` (guards/interceptors resolve dependencies via the *consuming* controller's module, not the
declaring module).

**Consumer 3 — attendance distance-check default:** `ENFORCE_DISTANCE_CHECK_DEFAULT` — the first *boolean*
`PlatformSetting` (every prior one was a plain number). `KnownPlatformSetting` gained an optional `type: 'number' |
'boolean'` field purely as a rendering hint (still stored/transmitted as `0`/`1`, no new column or shape) — the
settings page renders a toggle instead of a number input when `type === 'boolean'`. See "Attendance Distance Check
Setting" in the Attendance Module section above for the full per-tenant-override picture this platform default sits
underneath.

**Consumer 4 — social media draft retention:** `SOCIAL_MEDIA_DRAFT_RETENTION_DAYS` (default 30) — read by
`SocialMediaRetentionScheduler`'s daily sweep (see Social Media Module above). No dedicated frontend work was
needed for this one: `/billing-settings` already renders every `KNOWN_PLATFORM_SETTINGS` entry generically from the
`GET /platform/settings` response, so a new key just appears.

**Retired: `SOCIAL_MEDIA_ENABLED`** (formerly Consumer 5 here — a boolean, all-tenants-at-once composer readiness
gate). Removed once `Tenant.moduleOverrides` shipped (see the Social Media Module and Tenant Module sections
above) — the Social Media Rollout control (single toggle + searchable multi-select, `PUT
/platform/social-media/rollout`) replaces its job with real per-church granularity and actual backend enforcement,
which this setting never had (it only ever gated one frontend check, never the API itself). `GET
/social-media/platform-enabled` still exists and discuva-admin still calls it the same way — see the Social Media
Module section above for what it checks now instead.

**Frontend:** discuva-platform's `/billing-settings` page (own `layout.tsx`, same "every new route needs one"
convention, now titled "Platform Settings" in-page and in the sidebar since it's no longer billing-only), gated by
`billing:read`/`billing:write` (reusing the existing permission pair `/giving-providers` and `/payment-providers`
already use — no new permission introduced for the upload-limit settings, they're gated the same as every other
platform-wide setting on this page). The per-row number input's `min`/`max` now come from each setting's own API
response instead of a hardcoded 0–365; a boolean-typed setting renders a toggle switch instead of a number input.

**Routes prefix:** `/platform`

#### Tenant Broadcasts (`TenantBroadcastService`, added 2026-08)

Sends one email to every active tenant's oldest active admin — used both as a direct platform-admin action
(`POST /platform/broadcast`, `discuva-platform`'s "Broadcast" nav page) and internally by other services that need
to notify every tenant about something platform-wide (first consumer: Communication Provider deactivation, below).

**Never a single batched `to: [...]` call.** Confirmed live in `EmailProcessor`: an array `to` produces one shared,
mutually-visible `To:` header (`Array.isArray(to) ? to.join(', ') : to`) — sending one email to every tenant's
admin that way would leak every church admin's email address to every other church admin. `TenantBroadcastService`
instead uses `forEachActiveTenant` (already proven by `SubscriptionLapseScheduler`) to re-enter each tenant's own
schema and queue one individual `EmailQueueService.queueEmail()` call per tenant.

**Only the tenant's oldest active admin is notified**, same "one primary contact" convention
`SubscriptionLapseScheduler` already established for platform-initiated notices — not every admin the tenant has.

**Two entry points on the service**, one plain-text and one raw-HTML:
- `broadcastPlainTextToAllTenantAdmins(subject, message)` — what `POST /platform/broadcast` actually calls. Each
  non-blank line of `message` becomes its own `<p>`, HTML-escaped first. A platform admin typing into a form
  textarea should never be able to inject arbitrary markup/scripts into an email reaching every church on the
  platform at once.
- `broadcastToAllTenantAdmins(subject, html)` — the lower-level primitive, for internal callers that need real
  markup (e.g. a provider-outage notice with a link). Every other `queueEmail` call site in this codebase passes
  raw HTML directly; this one is no different, it's only the plain-text entry point above that restricts it.

**Result shape**, distinct from `forEachActiveTenant`'s own `{ succeeded, failed }`: `{ sent, skipped, failed }` —
`skipped` (a tenant with no active admin on file) is tracked separately from `failed` (the tenant callback itself
threw), since neither means the same thing operationally.

**Permission:** `BROADCAST_WRITE`, deliberately its own permission rather than folded into an existing one — same
"independently grantable, bigger blast radius than it looks" reasoning as `TENANTS_IMPERSONATE`. See the
migration note earlier in this section for why an already-seeded `SuperAdmin` role needed a data migration, not
just the enum addition, to actually gain this permission.

#### Platform Admin Management (`/platform/admins`, `/platform/admin-roles`)

Onboarding/permission management for platform admins themselves — previously the *only* way to create one was a
hand-written SQL insert (there was nothing else to onboard multiple platform admins with, and no way to scope any
of them below full access). `PlatformAdminManagementService` (users) and `PlatformAdminRoleService` (roles) mirror
`AdminService`/`AdminRoleService`'s tenant-side shape closely, with two differences: no audit-log tie-in (tenant-side
logs into a tenant-scoped `audit_logs` table this control-plane has no equivalent of, and platform-admin actions
aren't audited anywhere else in this codebase either), and platform admins have no underlying `Member` — creating
one is a single step (`email` + `platformAdminRoleId`), not tenant-side's separate "create a member" → "grant them
admin" two-step flow.

`POST /platform/admins` takes no password — the onboarding admin isn't the one logging in as the new admin, so
there's nobody present to choose one. `PlatformAdminManagementService.create()` generates a random password
internally (never revealed to anyone, `changedPassword: false`), a 6-digit OTP stored in
`platform_admin_password_reset_otps` (48-hour expiry — same tradeoff as the tenant-welcome flow, offset by rate-
limiting `POST /platform/auth/reset-password`), and emails the new admin a `platform-admin-welcome` template with a
`{PLATFORM_LOGIN_URL}/set-password?email=...&otp=...` link — the discuva-platform equivalent of the tenant
onboarding flow above, down to reusing the same OTP-verify-and-set-password shape
(`PlatformAdminAuthService.forgotPassword`/`resetPassword`, its own OTP table rather than tenant-side's
`password_reset_otps` since `PlatformAdmin` and `Member` are deliberately disjoint identity systems). Login also now
returns `requiresPasswordChange: !admin.changedPassword`, mirroring the tenant-side login response shape, though
nothing currently enforces it in the frontend — a random, unrevealed password can't be logged in with in practice,
so the flag is informational/defense-in-depth, not an enforced gate.

`PATCH /platform/admins/:id` blocks an admin from modifying their own record entirely (role *or* `isActive`) —
stricter than tenant-side, whose `AdminService.update()` does the same self-block but `revoke()` is a separate,
unguarded action. Combined here into one endpoint, so the self-block covers both. `PlatformAdminRoleService.delete()`
mirrors tenant-side's exact business rule: blocked with `400` while any *active* admin is still assigned that role.

**Bootstrap script — the first platform admin.** Mirrors `src/seed.ts`/`DefaultAdminSeed` exactly:
`DefaultPlatformAdminSeed` (`src/platform-admin/seed/`), run via `npm run seed:platform-admin`
(`node dist/seed-platform-admin` in prod), reads `DEFAULT_PLATFORM_ADMIN_EMAIL`/`DEFAULT_PLATFORM_ADMIN_PASSWORD_HASH`
(generate the hash with the same `npm run hash:password` — already fully generic, no platform-specific variant
needed), skips if either is unset or if any `platform_admins` row already exists (idempotent — safe to leave in a
deploy pipeline), and seeds the admin with a find-or-create `Platform Super Admin` role holding every
`PlatformAdminPermission`. The `AddPlatformAdminRoles` migration also seeds this same role directly (originally
named `SuperAdmin`, see rename note below) and backfills any pre-migration `platform_admins` row onto it — the seed
script's `findOrCreateSuperAdmin()` is what a fresh environment without that migration history hits.

**Renamed from `SuperAdmin` to `Platform Super Admin`** (`1793044800000-RenamePlatformSuperAdminRole.ts`): the
tenant-side `AdminRole` (one church, seeded by `AdminRoleService.findOrCreateSuperAdmin`/
`TenantProvisioningService.seedTenantAdmin`) and this platform-side `PlatformAdminRole` were both independently
named the literal string `SuperAdmin` — indistinguishable by name alone across two very different scopes (one
church vs. every tenant plus billing/impersonation). Renamed the platform side only, since it's a single
control-plane table with few rows, versus the tenant-side name every existing church's primary admin already sees.
`findOrCreateSuperAdmin()` is self-healing: it looks for `Platform Super Admin` first, then falls back to renaming
a legacy `SuperAdmin` row in place if the migration hasn't run yet in that environment, rather than ever creating a
duplicate.

#### Platform Analytics (`GET /platform/analytics/*`)

Cross-tenant business metrics for whoever operates the platform itself — "how is the whole business doing," not any
one church's data. `PlatformAnalyticsService` (`src/platform-admin/service/platform-analytics.service.ts`) is
**deliberately every method a live query**, no new aggregation table or cron: `tenant_rollups`,
`billing_checkout_sessions`, and `subscriptions` are already small (one row per tenant, or one row per checkout) at
any realistic tenant count, so a `SUM`/`GROUP BY` at request time is cheap. Revisit only if tenant count genuinely
grows large enough to matter.

**Trend bucketing (`growth`/`revenue`/`churn`):** raw timestamped rows are fetched within a bounded window
(`?months=`, default 12, max 36) and bucketed in-memory by `?period=daily|weekly|monthly` (default `monthly`) —
same in-JS-bucketing convention `ServiceHeadcountService`'s own trend endpoint already established, not a SQL
`date_trunc`. Weekly buckets label by the Sunday of that week; monthly buckets label `YYYY-MM`.

**What's a real trend vs. a snapshot:** tenant signups (`growth`), revenue (`revenue`), and cancellations (`churn`)
are genuine time series — `tenants.createdAt`, `billing_checkout_sessions.completedAt`, and
`subscriptions.canceledAt` (added this pass — see below) are all real timestamps. Active-vs-suspended tenant counts
are **not** a trend — `tenants.isActive` is a plain boolean with no historical event log behind it, so `growth`
reports it as a current snapshot (`currentActiveTenants`/`currentSuspendedTenants`), not a fabricated time series.

**`Subscription.canceledAt` (new column, `src/migrations/1791072000000-AddSubscriptionCanceledAt.ts`):** set exactly
once, by `CheckoutService.applySubscriptionCanceled()`. Added specifically because `updatedAt` can't be trusted for
"when this subscription was canceled" — it changes on *any* field update, not just a cancellation.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/platform/analytics/overview` | `{ totalTenants, activeTenants, suspendedTenants, totalMembersPlatformWide, subscriptionsByPlan[], mrrByCurrency: [{currency, mrrCents}] }` — headline numbers. `mrrByCurrency` replaced a single blended `mrrCents` figure (breaking change) once plans could be priced in more than one currency |
| GET | `/platform/analytics/growth` | `?period=&months=` — `{ period, signups: [{periodLabel, count}], currentActiveTenants, currentSuspendedTenants }` |
| GET | `/platform/analytics/revenue` | `?period=&months=` — `{ period, mrrByCurrency: [{currency, mrrCents}], revenueByProvider: [{provider, totalCents}], trend: [{periodLabel, subscriptionRevenueCents, totalCents}] }` — only `completed` `BillingCheckoutSession` rows count (subscriptions only — `wallet_topup` no longer exists as a checkout type) |
| GET | `/platform/analytics/engagement` | `{ totalMembers, averageAttendanceRate, totalGiving, tenantsWithRollup, tenantsMissingRollup, oldestComputedAt, newestComputedAt }` — sourced entirely from `tenant_rollups` (§Branch Hierarchy); `oldest`/`newestComputedAt` signal staleness since the rollup cron runs once daily |
| GET | `/platform/analytics/churn` | `?period=&months=` — `{ period, currentlyCanceled, currentlyPastDue, trend: [{periodLabel, canceledCount}] }` |
| GET | `/platform/analytics/adoption` | `{ smsAdoption: {byokCount, totalTenants, ratePercent}, emailAdoption: {...}, planDistribution: [{planId, planName, count}] }` — BYOK adoption counts distinct tenants with an active `TenantCommunicationProviderConfig` per channel |

**MRR calculation (`overview` and `revenue`):** `SUM(plan.priceCents)` over every `ACTIVE` subscription, joined to its
plan — a tenant on the free plan contributes `0` naturally, no special-casing needed. This is *current* recurring
revenue (what's active right now), distinct from `revenue`'s `trend`, which is realized revenue from completed
checkouts over time — the two can disagree (e.g. a subscription active today whose original checkout completed
outside the requested `?months=` window).

---

## 6. API Endpoints Quick Reference

> All routes are prefixed with `/v1/` via NestJS URI versioning (`defaultVersion: '1'`). For example, `POST /auth/login` is accessed as `POST /v1/auth/login`. Future endpoint versions can be declared with `@Version('2')` at the controller or method level without affecting existing routes.

| Method | Route                                                      | Role                                                          | Description                                                                                                   |
|--------|------------------------------------------------------------|---------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------|
| GET    | /health                                                    | Public                                                        | Liveness check (served at `/v1/health`) — probes DB and Redis; returns 503 with details if either is unreachable. Exempt from rate limiting (`@SkipThrottle`). |
| POST   | /auth/signup                                               | Public                                                        | Register new member (server generates temp password; emailed to user)                                         |
| POST   | /auth/login                                                | Public                                                        | Mobile app login — requires `deviceId`; enforces one-device-per-account lock                                  |
| POST   | /auth/admin-login                                          | Public                                                        | Admin portal login — verifies active Admin record; no device check                                            |
| POST   | /auth/refresh                                              | Public                                                        | Exchange refresh token                                                                                        |
| POST   | /auth/logout                                               | Any                                                           | Invalidate session                                                                                            |
| GET    | /auth/me                                                   | Any                                                           | Own profile. Includes `isHod: boolean` — `true` if the authenticated member has a row in `department_leads`; `clergy: {title: {id, name}, canReviewFeedback} \| null`; and `isTrainee: boolean` — mirrors `workerProfile.isTrainee` (`false` for non-workers). Clients should fetch this once on load to drive HOD/trainee-gated UI.                                  |
| POST   | /auth/change-password                                      | Any                                                           | Change password (required when `requires_password_change` is true)                                            |
| POST   | /auth/email-change/request                                 | Any (JwtAuthGuard)                                            | Body `{ newEmail }` — sends a 6-digit OTP to the new address; rate-limited; `409` if already in use by another member |
| POST   | /auth/email-change/confirm                                 | Any (JwtAuthGuard)                                            | Body `{ otp }` — verifies OTP, updates own email, sends a confirmation email                                  |
| POST   | /auth/forgot-password                                      | Public                                                        | Request OTP reset code (rate-limited)                                                                         |
| POST   | /auth/reset-password                                       | Public                                                        | Verify OTP and set new password; invalidates current session                                                  |
| POST   | /auth/device-reset/request                                 | Public                                                        | Self-service device reset — rate-limited; issues OTP to registered email; locks in `newDeviceId` at request   |
| POST   | /auth/device-reset/verify                                  | Public                                                        | Verify OTP and swap `deviceId` to `newDeviceId`; invalidates all active sessions                              |
| POST   | /auth/webauthn/login/options                               | Public                                                        | Biometric login, step 1 — no email needed (`allowCredentials` omitted); returns `{ challengeId, options }`; IP-throttled (10/min) |
| POST   | /auth/webauthn/login/verify                                | Public                                                        | Biometric login, step 2 — body `{ challengeId, response }`; resolves the member from the credential and issues tokens via the same path password login uses |
| POST   | /auth/webauthn/register/options                            | Any (JwtAuthGuard)                                            | Enroll a new device, step 1 — returns resident-key (`residentKey: 'required'`) registration options for the calling member |
| POST   | /auth/webauthn/register/verify                              | Any (JwtAuthGuard)                                            | Enroll a new device, step 2 — body is the browser's `RegistrationResponseJSON`; stores the new credential, `204` on success |
| GET    | /auth/webauthn/credentials                                  | Any (JwtAuthGuard)                                            | List the caller's own registered devices — `{ id, deviceName, createdAt, lastUsedAt }[]`, never the credential id/public key |
| DELETE | /auth/webauthn/credentials/:id                              | Any (JwtAuthGuard)                                            | Remove one of the caller's own devices; `404` if it doesn't belong to them; `204` on success                  |
| PATCH  | /members/me                                                | Any (JwtAuthGuard)                                            | Self-service profile edit: `firstname`, `lastname`, `phoneNumber`, `gender`, `birthDay`, `birthMonth`, `birthYear`, `maritalStatus` (excludes email and admin-only church-record fields) |
| POST   | /members/me/photo                                          | Any (JwtAuthGuard)                                            | Upload/replace own profile photo — multipart field `photo`, image mimetypes only, 3MB limit                    |
| DELETE | /members/me/photo                                          | Any (JwtAuthGuard)                                            | Remove own profile photo                                                                                       |
| DELETE | /members/:id/photo                                         | AdminGuard (MEMBERS_WRITE)                                    | Moderation — clear a member's profile photo                                                                    |
| GET    | /members?page=&limit=&role=&search=                        | AdminGuard (MEMBERS_READ)                                     | List members — filterable by role; `search` matches firstname, lastname, email, or phone (case-insensitive)   |
| POST   | /members                                                   | AdminGuard (MEMBERS_WRITE)                                    | Create a plain MEMBER account directly (body: `SignupDto`) — shares `signup()`'s temp-password/forced-change-password flow; audit-logged as `MEMBER_CREATED_BY_ADMIN` |
| GET    | /members/workers                                           | AdminGuard (MEMBERS_READ)                                     | List workers (filterable by status)                                                                           |
| GET    | /members/:id                                               | AdminGuard (MEMBERS_READ)                                     | Get member by ID                                                                                              |
| PATCH  | /members/:id                                               | AdminGuard (MEMBERS_WRITE)                                    | Update member details                                                                                         |
| POST   | /members/bulk-promote                                      | AdminGuard (MEMBERS_WRITE)                                    | Bulk promote members to workers; returns `{ promoted, skipped, failures: [{ memberId, reason }] }`            |
| POST   | /members/:id/promote                                       | AdminGuard (MEMBERS_WRITE)                                    | Promote member to worker — reactivates a prior INACTIVE WorkerProfile (resumes department/progress) if one exists, else creates new |
| POST   | /members/:id/revoke-worker                                 | AdminGuard (MEMBERS_WRITE)                                    | Remove worker role (deactivates WorkerProfile to INACTIVE; row is kept, not deleted)                          |
| POST   | /members/:id/demote-trainee                                | AdminGuard (MEMBERS_WRITE)                                    | Demote a trainee worker to MEMBER (keeps WorkerProfile as INACTIVE history; 400 if not a trainee)             |
| PATCH  | /members/:id/worker-profile                                | AdminGuard (MEMBERS_WRITE)                                    | Update worker profile (incl. `isTrainee`)                                                                     |
| PATCH  | /members/:id/status                                        | AdminGuard (MEMBERS_WRITE)                                    | Activate/deactivate member                                                                                    |
| POST   | /members/:id/reset-password                                | AdminGuard (MEMBERS_WRITE)                                    | Reset & email new password                                                                                    |
| DELETE | /members/:id/device                                        | AdminGuard (MEMBERS_WRITE)                                    | Purge device lock; invalidates all active sessions                                                            |
| POST   | /members/:id/clergy                                        | AdminGuard (MEMBERS_WRITE)                                    | Assign clergy designation, body `{ clergyTitleId }`; `409` if already clergy, `404` if the title is unknown |
| PATCH  | /members/:id/clergy                                        | AdminGuard (MEMBERS_WRITE)                                    | Change clergy title, body `{ clergyTitleId }`; `404` if not clergy, or if the title is unknown              |
| DELETE | /members/:id/clergy                                        | AdminGuard (MEMBERS_WRITE)                                    | Remove clergy designation; `404` if not clergy; returns `204`                                             |
| PATCH  | /members/:id/clergy/review-access                          | AdminGuard (MEMBERS_WRITE)                                    | Grant/revoke Pastor Feedback review access, body `{ canReviewFeedback }`, independent of title; `404` if not clergy |
| GET    | /clergy-titles                                             | Public                                                         | Tenant's clergy-title catalog, see ClergyTitle above                                                          |
| GET    | /clergy-titles/:id                                         | Public                                                         | Single clergy title                                                                                            |
| POST   | /clergy-titles                                             | AdminGuard (MEMBERS_WRITE)                                     | Create a clergy title, body `{ name, description? }`; `400` if name in use                                     |
| PATCH  | /clergy-titles/:id                                         | AdminGuard (MEMBERS_WRITE)                                     | Update a clergy title                                                                                          |
| DELETE | /clergy-titles/:id                                         | AdminGuard (MEMBERS_WRITE)                                     | `400` if any clergy member is still assigned to it                                                                    |
| GET    | /members/bulk-import/template                              | AdminGuard (MEMBERS_WRITE)                                    | Streams a `.xlsx` bulk-import template                                                                        |
| POST   | /members/bulk-import/preview                               | AdminGuard (MEMBERS_WRITE)                                    | Multipart `file` upload (5 MB cap); validates every row, persists a `MemberImportJob` + rows, returns `{ ...job, rows }` |
| GET    | /members/bulk-import/:jobId                                | AdminGuard (MEMBERS_WRITE)                                    | Refetch a previously-previewed import job and its rows                                                        |
| POST   | /members/bulk-import/:jobId/commit                         | AdminGuard (MEMBERS_WRITE)                                    | Create a Member (+ WorkerProfile if `department` was filled) for every valid row; returns `{ createdCount, failedRows }` |
| GET    | /admin/roles                                               | AdminGuard (ADMIN_READ)                                       | List admin roles                                                                                              |
| GET    | /admin/roles/:id                                           | AdminGuard (ADMIN_READ)                                       | Get admin role by ID                                                                                          |
| POST   | /admin/roles                                               | AdminGuard (ADMIN_WRITE)                                      | Create admin role                                                                                             |
| PATCH  | /admin/roles/:id                                           | AdminGuard (ADMIN_WRITE)                                      | Update admin role                                                                                             |
| DELETE | /admin/roles/:id                                           | AdminGuard (ADMIN_WRITE)                                      | Delete admin role                                                                                             |
| GET    | /admin/users                                               | AdminGuard (ADMIN_READ)                                       | List admin users                                                                                              |
| GET    | /admin/users/me                                            | AdminGuard                                                    | Own admin profile                                                                                             |
| GET    | /admin/users/:id                                           | AdminGuard (ADMIN_READ)                                       | Get admin user by ID                                                                                          |
| POST   | /admin/users                                               | AdminGuard (ADMIN_WRITE)                                      | Grant admin access to a member                                                                                |
| PATCH  | /admin/users/:id                                           | AdminGuard (ADMIN_WRITE)                                      | Update admin user role/status                                                                                 |
| POST   | /admin/users/:id/revoke                                    | AdminGuard (ADMIN_WRITE)                                      | Revoke admin access                                                                                           |
| GET    | /admin/audit-logs                                          | AdminGuard (AUDIT_READ)                                       | Paginated audit log; filterable by action, actorId, targetId, dateFrom, dateTo                                |
| POST   | /attendances/checkin                                       | Any                                                           | Check in to a service slot (workers must include `location` when the resolved slot format is `IN_PERSON`; not required for `ONLINE`; one record per event per member) |
| GET    | /attendances/me/distance-check                             | Any (JwtAuthGuard)                                            | `{ enabled, isPlatformDefault }` — member-readable mirror of the admin distance-check setting below, so the member app can skip its own client-side distance block when enforcement is off |
| GET    | /attendances/my-history                                    | Any                                                           | Own attendance records                                                                                        |
| GET    | /attendances/my-summary                                    | Any                                                           | Own lifetime rate/streak, computed in SQL over full history (not just the current page) — `{ totalCount, presentCount, attendanceRatePercentage, lastCheckedInDate, attendanceStreak }` |
| GET    | /attendances/history                                       | AdminGuard (ATTENDANCE_READ)                                  | All attendance records; query: `page`, `limit`, `memberId`, `slotId`, `status`, `dateFrom`, `dateTo`, `search` (ILIKE on firstname, lastname, email) |
| POST   | /attendances/export-email                                  | AdminGuard (ATTENDANCE_READ)                                  | Email the currently-filtered attendance history as an `.xlsx` attachment (body: `recipientEmail?`, `memberId?`, `slotId?`, `status?`, `dateFrom?`, `dateTo?`, `search?`). `recipientEmail` defaults to the requesting admin's own email. One-off only — not a recurring/scheduled report. Logs `REPORT_EXPORTED`. |
| GET    | /attendances/history/department?slotId=&page=&limit=       | WORKER                                                        | Paginated department attendance for a slot (scoped to caller's own department via lead role); `page` defaults to 1, `limit` to 20 |
| GET    | /attendances/department/event/:eventId                     | WORKER                                                        | Worker attendance for all slots of an event (scoped to caller's own department via lead role)                 |
| GET    | /attendances/summary/slot/:slotId                          | AdminGuard (ATTENDANCE_READ)                                  | Status counts for a slot                                                                                      |
| GET    | /attendances/leaderboard                                   | AdminGuard (ATTENDANCE_READ)                                  | Top workers by attendance                                                                                     |
| PATCH  | /attendances/:id/correct                                   | AdminGuard (ATTENDANCE_WRITE)                                 | Admin correction of an attendance record status                                                               |
| GET    | /attendances/at-risk?minAbsences=&from=&to=&page=&limit=   | AdminGuard (ATTENDANCE_READ)                                  | Members with ≥ N ABSENT records in range; returns `absenceCount`, `lastSeenAt`, `hasOpenFollowUpTask`         |
| POST   | /attendances/admin/mark                                    | AdminGuard (ATTENDANCE_WRITE)                                 | Create/backfill an attendance record for any member+event — no-phone check-in and streak restore, body `{ memberId, serviceSlotId, status }` |
| POST   | /attendances/department/mark                               | JwtAuthGuard (Admin-department worker)                        | Same action, mobile-reachable for Admin-department front-desk workers; same body                              |
| GET    | /attendances/department/search-members?q=                 | JwtAuthGuard (Admin-department worker)                        | Narrow member lookup (≤10 results, id/firstname/lastname/role only) backing the mobile check-in picker         |
| POST   | /attendances/online-confirm                                | JwtAuthGuard (any authenticated member)                       | Confirm online attendance for an event (updates ABSENT → ATTENDED_ONLINE within window)                       |
| POST   | /follow-up/first-timers                                    | WORKER (FOLLOW_UP dept)                                       | Register a first-timer (auto-creates FollowUpTask via round-robin)                                            |
| GET    | /follow-up/tasks/mine                                      | WORKER (FOLLOW_UP dept)                                       | List follow-up tasks assigned to the caller                                                                   |
| PATCH  | /follow-up/tasks/:id                                       | WORKER (FOLLOW_UP dept)                                       | Update task status/outcome/notes+contactMethod (caller must be the assignee); sets `lastActivityAt`           |
| POST   | /follow-up/tasks/:id/notes                                 | WORKER (FOLLOW_UP dept)                                       | Add a note (with optional `contactMethod`) without changing task status; sets `lastActivityAt`                |
| POST   | /admin/follow-up/first-timers                              | AdminGuard (FOLLOW_UP_WRITE)                                  | Register a first-timer from admin portal                                                                      |
| GET    | /admin/follow-up/first-timers                              | AdminGuard (FOLLOW_UP_READ)                                   | List first-timers; query: `page`, `limit`, `eventId`, `source`, `wantsToJoinChurch`, `wantsToJoinWorkforce`, `search`, `dateFrom`, `dateTo` (YYYY-MM-DD) |
| GET    | /admin/follow-up/first-timers/pipeline                     | AdminGuard (FOLLOW_UP_READ)                                   | Funnel counts: `{ total, untouched, contacted, returned, invited, converted }`. Optional `from`/`to` filter. |
| POST   | /admin/follow-up/first-timers/:id/visits                   | AdminGuard (FOLLOW_UP_WRITE)                                  | Log a return visit. Body: `{ eventId?, notes?, visitedAt? }` — `visitedAt` defaults to today (YYYY-MM-DD)    |
| GET    | /admin/follow-up/tasks                                     | AdminGuard (FOLLOW_UP_READ)                                   | List follow-up tasks; query: `page`, `limit`, `status`, `type`, `search` (matches first-timer name)          |
| GET    | /admin/follow-up/tasks/stale                               | AdminGuard (FOLLOW_UP_READ)                                   | Open tasks with no activity for ≥ `daysInactive` (default 7) days; paginated, ordered by oldest activity     |
| PATCH  | /admin/follow-up/tasks/:id/reassign                        | AdminGuard (FOLLOW_UP_WRITE)                                  | Reassign a task to a different FOLLOW_UP-dept worker                                                          |
| PATCH  | /admin/follow-up/tasks/bulk                                | AdminGuard (FOLLOW_UP_WRITE)                                  | Bulk update task statuses                                                                                     |
| POST   | /admin/follow-up/first-timers/:id/invite-to-membership     | AdminGuard (FOLLOW_UP_WRITE)                                  | Queue membership invitation email. Returns `{ queued: true/false }`. Deduped by `inviteSentAt`.              |
| PATCH  | /admin/follow-up/first-timers/:id/mark-converted           | AdminGuard (FOLLOW_UP_WRITE)                                  | Mark first-timer as converted; optional `{ memberId }` body links to their Member record                     |
| PATCH  | /admin/follow-up/tasks/:id                                 | AdminGuard (FOLLOW_UP_WRITE)                                  | Admin update of any task: `status`, `outcome`, `outcomeNotes`, `dueDate`, `noteContent`, `contactMethod`     |
| GET    | /admin/follow-up/report                                    | AdminGuard (FOLLOW_UP_READ)                                   | Pastoral report: first-timer totals, task stats, overdue count, conversion rate, by-worker, by-event         |
| POST   | /evangelism/converts                                       | JwtAuthGuard (any worker)                                     | Upload a convert (only `name` required)                                                                       |
| GET    | /evangelism/converts/team?status=&page=&limit=             | JwtAuthGuard (Evangelism-dept worker)                          | Cross-member browse with follow-up staleness fields (mobile)                                                  |
| POST   | /evangelism/converts/:id/follow-up                         | JwtAuthGuard (Evangelism-dept worker)                          | Log a follow-up contact                                                                                       |
| PATCH  | /evangelism/converts/:id/status                            | JwtAuthGuard (Evangelism-dept worker)                          | Update convert status                                                                                          |
| GET    | /evangelism/converts/:id/follow-up-history?page=&limit=    | JwtAuthGuard (Evangelism-dept worker)                          | Full follow-up log for a convert, newest first (mobile)                                                       |
| GET    | /evangelism/converts/admin?status=&page=&limit=            | AdminGuard (EVANGELISM_READ)                                   | Cross-member browse (admin portal)                                                                            |
| PATCH  | /evangelism/converts/admin/:id/reassign                    | AdminGuard (EVANGELISM_WRITE)                                  | Reassign follow-up to another Evangelism-dept worker                                                          |
| PATCH  | /evangelism/converts/admin/:id/link-member                 | AdminGuard (EVANGELISM_WRITE)                                  | Link a convert to their new Member record                                                                     |
| GET    | /evangelism/converts/admin/:id/follow-up-history?page=&limit= | AdminGuard (EVANGELISM_READ)                                | Full follow-up log for a convert, newest first (admin portal)                                                 |

| POST   | /admin/sermons                                             | AdminGuard (SERMON_WRITE)                                     | Create a sermon archive entry — body: title, speakerName, date, description?, youtubeUrl?, mixlrUrl?, series?. 400 if neither youtubeUrl nor mixlrUrl is set. |
| GET    | /admin/sermons?page=&limit=&series=                        | AdminGuard (SERMON_READ)                                      | Paginated list, newest first, optional exact `series` filter                                                   |
| GET    | /admin/sermons/:id                                         | AdminGuard (SERMON_READ)                                      | Get a single sermon                                                                                             |
| PATCH  | /admin/sermons/:id                                         | AdminGuard (SERMON_WRITE)                                     | Update any field. 400 if the update would leave both youtubeUrl and mixlrUrl unset.                            |
| DELETE | /admin/sermons/:id                                         | AdminGuard (SERMON_WRITE)                                     | Delete a sermon archive entry                                                                                   |
| POST   | /admin/sermons/announce-live                               | AdminGuard (SERMON_WRITE)                                     | Manual "we're live" trigger — body: `{ platform: 'YOUTUBE' \| 'MIXLR', url, title? }`. Publishes an ALL-audience system announcement via `AnnouncementService.createSystemAnnouncement()` and push-notifies every active member. |
| GET    | /sermons?page=&limit=&series=                              | JwtAuthGuard + Module: sermons                                | Paginated list for any authenticated member/worker — no department or class gating                             |
| GET    | /sermons/:id                                               | JwtAuthGuard + Module: sermons                                | Get a single sermon                                                                                             |
| GET    | /sermons/:id/note                                          | JwtAuthGuard + Module: sermons                                | Get the requesting member's own private note for this sermon (`null` if none) — own data, no admin visibility  |
| PUT    | /sermons/:id/note                                          | JwtAuthGuard + Module: sermons                                | Create or update the requesting member's note for this sermon (body: `{ note }`, upsert)                        |
| DELETE | /sermons/:id/note                                          | JwtAuthGuard + Module: sermons                                | Delete the requesting member's note for this sermon                                                             |
| GET    | /integrations/youtube/callback                             | No guard — WebSub verification handshake                      | Echoes `hub.challenge` for subscribe/unsubscribe modes; 404 otherwise. Called by Google's PubSubHubbub hub, not a client. |
| POST   | /integrations/youtube/callback                             | No guard — WebSub notification                                | Receives the "video published" Atom feed ping; always 204. Triggers YouTube Data API check + auto-announcement if actually live. Called by the hub, not a client. |
| POST   | /admin/games                                               | AdminGuard (GAMES_WRITE)                                       | Create a game (DRAFT)                                                                                          |
| GET    | /admin/games?page=&limit=                                  | AdminGuard (GAMES_READ)                                        | Paginated list, newest first. Each game carries `activeSessionCode` (non-null only while `LIVE_SESSION_ACTIVE`)  |
| GET    | /admin/games/:id                                           | AdminGuard (GAMES_READ)                                        | Get a single game, with `activeSessionCode`                                                                     |
| PATCH  | /admin/games/:id                                           | AdminGuard (GAMES_WRITE)                                       | Update title/description/department/churchClass                                                               |
| DELETE | /admin/games/:id                                           | AdminGuard (GAMES_WRITE)                                       | Delete a game (cascades questions/sessions/participants/responses)                                             |
| GET    | /admin/games/:id/questions                                 | AdminGuard (GAMES_READ)                                        | List a game's questions, ordered                                                                               |
| POST   | /admin/games/:id/questions                                 | AdminGuard (GAMES_WRITE)                                       | Add a question — body: questionText, options (>=2), correctOptionIndex, points?, timeLimitSeconds?. 400 if correctOptionIndex is out of range. |
| PUT    | /admin/games/:id/questions/reorder                         | AdminGuard (GAMES_WRITE)                                       | Reorder — body: `{ questionIds: string[] }`, must contain exactly the game's current question ids              |
| PATCH  | /admin/games/questions/:questionId                         | AdminGuard (GAMES_WRITE)                                       | Update a question (any field)                                                                                  |
| DELETE | /admin/games/questions/:questionId                         | AdminGuard (GAMES_WRITE)                                       | Delete a question                                                                                              |
| POST   | /admin/games/:id/start                                     | AdminGuard (GAMES_WRITE)                                       | Start a live session — 400 if the game has no questions or a LIVE session already exists for it. Caller becomes the session's host. |
| POST   | /admin/games/sessions/:code/next-question                  | AdminGuard (GAMES_WRITE)                                       | Advance to the next question — 403 if caller isn't the host, 400 if session isn't LIVE or already on the last question |
| POST   | /admin/games/sessions/:code/end                            | AdminGuard (GAMES_WRITE)                                       | End the session (idempotent) and revert the game to DRAFT                                                       |
| GET    | /admin/games/sessions/:code/state                          | AdminGuard (GAMES_READ)                                        | Current session state (same shape broadcast over the socket, no correctOptionIndex, includes `currentQuestionStartedAt`) |
| GET    | /admin/games/sessions/:code/leaderboard                    | AdminGuard (GAMES_READ)                                        | Live leaderboard, ordered by totalScore desc                                                                    |
| POST   | /games/sessions/:code/join                                 | JwtAuthGuard + Module: games                                   | Join a live session with its code — upserts a GameParticipant, no department/class gating                      |
| GET    | /games/sessions/:code/state                                | Public + Module: games, throttled 300/60s                       | Current session state — same payload the socket broadcasts. Unauthenticated so the projector/screen presentation view can poll it with just the join code. |
| POST   | /games/sessions/:code/questions/:questionId/answer         | JwtAuthGuard + Module: games                                   | Submit an answer — body: `{ selectedOptionIndex }`. 400 if not the current question or already answered; 403 if caller never joined. |
| GET    | /games/sessions/:code/leaderboard                          | JwtAuthGuard + Module: games                                   | Live leaderboard                                                                                                 |
| POST   | /service-ratings                                           | JwtAuthGuard + Module: service_ratings                        | Submit or update a rating for a service (body: `eventId`, `serviceSlotId`, `rating` 1–5, `comment?`) — upsert   |
| GET    | /service-ratings/mine?eventId=&serviceSlotId=              | JwtAuthGuard + Module: service_ratings                        | The requesting member's own rating for a service, or null                                                       |
| GET    | /admin/service-ratings/summary?eventId=&from=&to=          | AdminGuard (SERVICE_RATING_READ)                               | Average rating, total count, and 1–5 star distribution                                                          |
| GET    | /admin/service-ratings/comments?page=&limit=               | AdminGuard (SERVICE_RATING_READ)                               | Paginated comment feed, anonymized unless the admin also has SERVICE_RATING_MODERATE                            |
| DELETE | /admin/service-ratings/:id                                 | AdminGuard (SERVICE_RATING_MODERATE)                            | Delete/hide a rating; logs SERVICE_RATING_MODERATED                                                             |
| POST   | /admin/volunteer-opportunities                             | AdminGuard (VOLUNTEER_WRITE)                                    | Create an opportunity — body: title, description?, departmentId?, date, capacity? (omit for unlimited)          |
| GET    | /admin/volunteer-opportunities?page=&limit=                | AdminGuard (VOLUNTEER_READ)                                     | Paginated list, all statuses, newest date first                                                                 |
| PATCH  | /admin/volunteer-opportunities/:id                         | AdminGuard (VOLUNTEER_WRITE)                                    | Update any field                                                                                                |
| PATCH  | /admin/volunteer-opportunities/:id/cancel                  | AdminGuard (VOLUNTEER_WRITE)                                    | Cancel an opportunity (status → CANCELLED); no hard delete                                                      |
| GET    | /admin/volunteer-opportunities/:id/signups                 | AdminGuard (VOLUNTEER_READ)                                     | Roster — CONFIRMED signups with member names                                                                    |
| GET    | /volunteer-opportunities?page=&limit=                      | JwtAuthGuard + Module: volunteering                             | Open, upcoming opportunities; each row includes the caller's own `mySignupStatus`                               |
| POST   | /volunteer-opportunities/:id/signup                        | JwtAuthGuard + Module: volunteering                              | Sign up (upsert — re-signing after a cancel re-confirms the same row). 400 if not OPEN or at capacity.          |
| DELETE | /volunteer-opportunities/:id/signup                        | JwtAuthGuard + Module: volunteering                              | Cancel the caller's own signup                                                                                  |
| POST   | /admin/small-groups                                        | AdminGuard (SMALL_GROUP_WRITE)                                   | Create a group — body: name, description?, leaderId?, meetingDay?, meetingLocation?, venueId?, meetingFormat?, meetingLink? |
| GET    | /admin/small-groups?page=&limit=                           | AdminGuard (SMALL_GROUP_READ)                                    | Paginated list, alphabetical by name                                                                            |
| PATCH  | /admin/small-groups/:id                                    | AdminGuard (SMALL_GROUP_WRITE)                                   | Update any field; `leaderId: null`/`venueId: null` explicitly unassigns the leader/venue                        |
| DELETE | /admin/small-groups/:id                                    | AdminGuard (SMALL_GROUP_WRITE)                                   | Hard delete — removes membership and attendance history too (CASCADE)                                          |
| GET    | /admin/small-groups/:id/members                            | AdminGuard (SMALL_GROUP_READ)                                    | Full roster                                                                                                     |
| DELETE | /admin/small-groups/:id/members/:memberId                 | AdminGuard (SMALL_GROUP_WRITE)                                   | Force-remove a member; logs SMALL_GROUP_MEMBER_REMOVED                                                          |
| GET    | /admin/small-groups/:id/attendance                         | AdminGuard (SMALL_GROUP_READ)                                    | Full attendance history, newest meeting date first                                                              |
| GET    | /small-groups?page=&limit=                                 | JwtAuthGuard + Module: small_groups                              | Browse all groups with `memberCount` (not the roster itself)                                                    |
| GET    | /small-groups/mine                                         | JwtAuthGuard + Module: small_groups                              | Groups the caller currently belongs to                                                                          |
| GET    | /small-groups/:id                                          | JwtAuthGuard + Module: small_groups                              | Group detail                                                                                                    |
| GET    | /small-groups/:id/members                                  | JwtAuthGuard + Module: small_groups                              | Full roster — requires the caller to currently be a member of this group                                       |
| POST   | /small-groups/:id/join                                     | JwtAuthGuard + Module: small_groups                              | Self-join (upsert — re-joining after leaving works)                                                             |
| DELETE | /small-groups/:id/leave                                    | JwtAuthGuard + Module: small_groups                              | Self-leave                                                                                                      |
| POST   | /small-groups/:id/attendance                               | JwtAuthGuard + Module: small_groups                              | Record attendance — body: `{ meetingDate, records: [{memberId, status}] }`. 403 unless the caller is this group's leader. |
| POST   | /events                                                    | AdminGuard (EVENTS_WRITE)                                     | Create event (single or recurring)                                                                            |
| PATCH  | /events/:id                                                | AdminGuard (EVENTS_WRITE)                                     | Update event                                                                                                  |
| GET    | /events/:id                                                | Any                                                           | Get event by ID                                                                                               |
| GET    | /events                                                    | Any                                                           | List events. Query: `page`, `limit`, `orderBy`, `order`, `from` (YYYY-MM-DD), `to` (YYYY-MM-DD), `upcoming=true`, `search` (case-insensitive match on event name — powers searchable event pickers in the admin frontend) |
| DELETE | /events/:id                                                | AdminGuard (EVENTS_WRITE)                                     | Delete single event — blocked if `attendanceMarked = true` or event is in the past                           |
| DELETE | /events/recurring/:recurringEventId                        | AdminGuard (EVENTS_WRITE)                                     | Delete future recurring events                                                                                |
| POST   | /event-config                                              | AdminGuard (EVENTS_WRITE)                                     | Create timing config — body gains `defaultFormat?` (`IN_PERSON`\|`ONLINE`), `onlineMeetingUrl?`; `defaultVenueId` is now optional (required only when `defaultFormat` is `IN_PERSON`) |
| PATCH  | /event-config/:id                                          | AdminGuard (EVENTS_WRITE)                                     | Update timing config — `defaultVenueId: null` explicitly clears the venue (needed when switching to `ONLINE`) |
| GET    | /event-config/:id                                          | AdminGuard (EVENTS_WRITE)                                     | Get config by ID                                                                                              |
| GET    | /event-config                                              | AdminGuard (EVENTS_WRITE)                                     | List configs                                                                                                  |
| DELETE | /event-config/:id                                          | AdminGuard (EVENTS_WRITE)                                     | Delete config                                                                                                 |
| POST   | /events/slots/:slotId/reminders                            | AdminGuard (EVENTS_WRITE)                                     | Add a reminder schedule to a slot                                                                             |
| GET    | /events/slots/:slotId/reminders                            | AdminGuard (EVENTS_WRITE)                                     | List reminders for a slot                                                                                     |
| PATCH  | /events/slots/:slotId/reminders/:reminderId                | AdminGuard (EVENTS_WRITE)                                     | Update reminder (audience, preset, enabled)                                                                   |
| DELETE | /events/slots/:slotId/reminders/:reminderId                | AdminGuard (EVENTS_WRITE)                                     | Delete reminder                                                                                               |
| POST   | /venues                                                    | AdminGuard (VENUES_WRITE)                                     | Create venue                                                                                                  |
| PATCH  | /venues/:id                                                | AdminGuard (VENUES_WRITE)                                     | Update venue                                                                                                  |
| DELETE | /venues/:id                                                | AdminGuard (VENUES_WRITE)                                     | Delete venue                                                                                                  |
| GET    | /venues                                                    | Any                                                           | List venues                                                                                                   |
| GET    | /venues/nearby                                             | Any                                                           | Find nearby venues by radius                                                                                  |
| GET    | /venues/:id                                                | Any                                                           | Get venue by ID                                                                                               |
| GET    | /departments                                               | Any                                                           | List departments                                                                                              |
| GET    | /departments/capabilities                                  | Any                                                           | List all valid capabilities as `{ value, label }[]` (the shared `EnumOption` shape used across `/enums`) — `label` is the human-readable description from `DepartmentCapabilityLabels`, for admin-UI display |
| GET    | /departments/:id                                           | Any                                                           | Get department                                                                                                |
| POST   | /departments                                               | AdminGuard (DEPARTMENTS_WRITE)                                | Create department                                                                                             |
| PATCH  | /departments/:id                                           | AdminGuard (DEPARTMENTS_WRITE)                                | Update department                                                                                             |
| DELETE | /departments/:id                                           | AdminGuard (DEPARTMENTS_WRITE)                                | Delete department                                                                                             |
| POST   | /departments/:id/bulk-assign                               | AdminGuard (DEPARTMENTS_WRITE)                                | Bulk assign workers to a primary department; returns `{ updated, skipped }`                                   |
| POST   | /departments/assign-lead                                   | AdminGuard (DEPARTMENTS_WRITE)                                | Assign head/assistant lead (accepts primary OR secondary department membership)                               |
| POST   | /departments/remove-lead                                   | AdminGuard (DEPARTMENTS_WRITE)                                | Remove lead                                                                                                   |
| GET    | /departments/leads/:id                                     | AdminGuard (DEPARTMENTS_READ)                                 | Leads for a department                                                                                        |
| GET    | /departments/leads                                         | AdminGuard (DEPARTMENTS_READ)                                 | All department leads                                                                                          |
| GET    | /departments/:id/workers                                   | AdminGuard (DEPARTMENTS_READ)                                 | List workers in a department (paginated)                                                                      |
| GET    | /departments/my/summary                                    | WORKER                                                        | Own department summary (lead only)                                                                            |
| POST   | /pastor-feedback                                       | JwtAuthGuard (HOD/D_HOD of departmentId)                      | Submit weekly pastor feedback                                                                             |
| PATCH  | /pastor-feedback/:id                                   | JwtAuthGuard (must be the submitter)                          | Edit own submission                                                                                            |
| GET    | /pastor-feedback/my?page=&limit=                       | JwtAuthGuard                                                  | Own submission history                                                                                         |
| GET    | /pastor-feedback/admin?departmentId=&weekOf=&page=&limit= | AdminGuard (PASTOR_FEEDBACK_READ)                      | Cross-department browse                                                                                        |
| GET    | /pastor-feedback/admin/department/:departmentId        | AdminGuard (PASTOR_FEEDBACK_READ)                         | One department's submission history                                                                            |
| PATCH  | /pastor-feedback/admin/:id                              | AdminGuard (PASTOR_FEEDBACK_WRITE)                        | Edit a submission on the HOD's behalf                                                                          |
| DELETE | /pastor-feedback/admin/:id                              | AdminGuard (PASTOR_FEEDBACK_WRITE)                        | Delete a submission                                                                                             |
| POST   | /pastor-feedback/admin/:id/respond                      | AdminGuard (PASTOR_FEEDBACK_WRITE)                        | Respond as pastor (requires admin's linked Member to have a Pastor record)                                     |
| GET    | /pastor-feedback/pastor?departmentId=&weekOf=&page=&limit= | JwtAuthGuard (Pastor record required)                     | Cross-department browse (mobile)                                                                               |
| GET    | /pastor-feedback/pastor/department/:departmentId        | JwtAuthGuard (Pastor record required)                         | One department's submission history (mobile)                                                                  |
| POST   | /pastor-feedback/pastor/:id/respond                     | JwtAuthGuard (Pastor record required)                         | Respond as pastor (mobile)                                                                                     |
| POST   | /prayer-requests                                       | Any (JwtAuthGuard)                                            | Submit a private prayer request                                                                                |
| GET    | /prayer-requests/mine?page=&limit=                     | Any (JwtAuthGuard)                                             | Own prayer request history                                                                                     |
| POST   | /testimonies                                           | Any (JwtAuthGuard)                                            | Submit a testimony (optional `prayerRequestId`, `isPublic`); body: `SubmitTestimonyDto`                        |
| GET    | /testimonies/mine?page=&limit=                         | Any (JwtAuthGuard)                                             | Own testimony history                                                                                          |
| GET    | /testimonies/public?page=&limit=                       | Any (JwtAuthGuard)                                             | Opt-in public testimony feed                                                                                    |
| GET    | /prayer-requests/team?status=&page=&limit=             | JwtAuthGuard (Prayer-dept worker or Clergy)                    | Cross-member browse (mobile)                                                                                    |
| PATCH  | /prayer-requests/team/:id/status                       | JwtAuthGuard (Prayer-dept worker or Clergy)                    | Update a request's status (mobile)                                                                              |
| GET    | /prayer-requests/admin?status=&page=&limit=            | AdminGuard (PRAYER_READ)                                       | Cross-member browse (admin portal)                                                                              |
| PATCH  | /prayer-requests/admin/:id/status                      | AdminGuard (PRAYER_WRITE)                                      | Update a request's status (admin portal)                                                                        |
| GET    | /testimonies/admin?page=&limit=                        | AdminGuard (PRAYER_READ)                                       | Full testimony browse (not just public ones)                                                                   |
| GET    | /prayer-requests/team/pregnancy-cases?status=&page=&limit= | JwtAuthGuard (Prayer-dept worker or Clergy)                | Cross-member pregnancy prayer case browse (mobile)                                                              |
| POST   | /prayer-requests/team/pregnancy-cases                  | JwtAuthGuard (Prayer-dept worker or Clergy)                    | Create a pregnancy prayer case (mobile)                                                                        |
| POST   | /prayer-requests/team/pregnancy-cases/:id/visit        | JwtAuthGuard (Prayer-dept worker or Clergy)                    | Log a prayer visit (mobile)                                                                                    |
| PATCH  | /prayer-requests/team/pregnancy-cases/:id/status       | JwtAuthGuard (Prayer-dept worker or Clergy)                    | Update case status (mobile)                                                                                    |
| GET    | /prayer-requests/team/pregnancy-cases/:id/visits       | JwtAuthGuard (Prayer-dept worker or Clergy)                    | Full visit log for a case, newest first (mobile)                                                              |
| GET    | /prayer-requests/admin/pregnancy-cases?status=&page=&limit= | AdminGuard (PRAYER_READ)                                  | Cross-member pregnancy prayer case browse (admin portal)                                                       |
| PATCH  | /prayer-requests/admin/pregnancy-cases/:id/status      | AdminGuard (PRAYER_WRITE)                                      | Update case status (admin portal)                                                                              |
| GET    | /prayer-requests/admin/pregnancy-cases/:id/visits      | AdminGuard (PRAYER_READ)                                       | Full visit log for a case, newest first (admin portal)                                                        |
| POST   | /leave                                                     | WORKER                                                        | Request leave                                                                                                 |
| PATCH  | /leave/:id/action                                          | AdminGuard (LEAVE_WRITE)                                      | Approve or reject leave                                                                                       |
| DELETE | /leave/:id                                                 | WORKER                                                        | Delete own pending leave                                                                                      |
| GET    | /leave/my-history?page=&limit=&status=                     | WORKER                                                        | Own leave history (paginated)                                                                                 |
| GET    | /leave/history                                             | AdminGuard (LEAVE_READ)                                       | All leave requests                                                                                            |
| GET    | /leave/department?page=&limit=&status=                     | WORKER                                                        | Department leave requests (lead only, paginated)                                                              |
| POST   | /classes                                                   | AdminGuard (CLASSES_WRITE)                                    | Create class (body: `classTypeId`, not `type`)                                                                |
| PATCH  | /classes/:id                                               | AdminGuard (CLASSES_WRITE)                                    | Update class                                                                                                  |
| DELETE | /classes/:id                                               | AdminGuard (CLASSES_WRITE)                                    | Delete class                                                                                                  |
| GET    | /classes?classTypeId=                                      | Any                                                           | List classes (filterable by `classTypeId`)                                                                    |
| GET    | /classes/:id                                               | Any                                                           | Get class                                                                                                     |
| POST   | /classes/enroll                                            | AdminGuard (CLASSES_WRITE)                                    | Enrol member in class                                                                                         |
| PATCH  | /classes/enrollments/:id/status                            | AdminGuard (CLASSES_WRITE)                                    | Update enrolment status                                                                                       |
| PATCH  | /classes/enrollments/:id/certificate                       | AdminGuard (CLASSES_WRITE)                                    | Issue a certificate for a COMPLETED enrolment (body: optional `certificateNumber`)                            |
| GET    | /classes/enrollments/:id/promotion-candidate                | AdminGuard (CLASSES_READ)                                     | Check level-promotion eligibility + open classes of the next type                                             |
| POST   | /classes/enrollments/:id/promote                            | AdminGuard (CLASSES_WRITE)                                    | Promote a COMPLETED enrolment into the next class type (body: `targetClassId`)                                |
| GET    | /classes/my/enrollments                                    | Any                                                           | Own enrolments                                                                                                |
| GET    | /classes/:id/enrollments                                   | AdminGuard (CLASSES_READ)                                     | All enrolments for a class                                                                                    |
| POST   | /classes/types                                             | AdminGuard (CLASSES_WRITE)                                    | Create class type                                                                                             |
| PATCH  | /classes/types/:id                                         | AdminGuard (CLASSES_WRITE)                                    | Update class type (name/description/isActive/nextClassTypeId)                                                 |
| DELETE | /classes/types/:id                                         | AdminGuard (CLASSES_WRITE)                                    | Delete class type (blocked if any class still references it)                                                 |
| GET    | /classes/types                                             | Any                                                           | List all class types (unpaginated, cached) — member-readable so the mobile app can show current types         |
| GET    | /classes/types/:id                                         | Any                                                           | Get class type                                                                                                |
| POST   | /announcements                                             | AdminGuard (ANNOUNCEMENTS_WRITE)                              | Create announcement; optional `sendViaSms` (requires `SMS_SEND`) + `smsBody` (required if `sendViaSms=true`)  |
| POST   | /announcements/sms-broadcast                               | AdminGuard (SMS_SEND)                                         | Send an SMS to an audience without creating an announcement; body `{ audience, departmentId?/targetMemberId?/groupId?, message }` — returns `{ sentCount }` |
| PATCH  | /announcements/:id                                         | AdminGuard (ANNOUNCEMENTS_WRITE)                              | Update announcement; same `sendViaSms`/`smsBody` rules as create — SMS only (re-)sent on the transition into `sendViaSms=true` |
| DELETE | /announcements/:id                                         | AdminGuard (ANNOUNCEMENTS_WRITE)                              | Delete announcement                                                                                           |
| GET    | /announcements/all?search=&audience=&page=&limit=          | AdminGuard (ANNOUNCEMENTS_READ)                               | All announcements (paginated); optional `search` filters by title (case-insensitive); optional `audience` filters by value (ALL/WORKERS_ONLY/MEMBERS_ONLY/DEPARTMENT/INDIVIDUAL) |
| GET    | /announcements/feed                                        | Any                                                           | My filtered feed                                                                                              |
| GET    | /announcements/:id                                         | Any                                                           | Get announcement                                                                                              |
| POST   | /announcements/:id/react                                   | Any                                                            | React with an emoji (upserts — one reaction per member per announcement)                                     |
| DELETE | /announcements/:id/react                                   | Any                                                            | Remove own reaction                                                                                           |
| GET    | /announcements/:id/reactions                               | Any                                                            | `{ summary: {emoji,count}[], myReaction }` — myReaction reflects the calling member                          |
| GET    | /admin/sms/balance                                         | AdminGuard (SMS_READ)                                         | Returns `{ balance, currency }` from the SMS provider                                                         |
| POST   | /admin/sms/segment-count                                   | AdminGuard (SMS_READ)                                         | Body `{ message }` — returns `{ segments, encoding, characterCount }`                                         |
| GET    | /admin/sms/logs                                            | AdminGuard (SMS_READ)                                         | Live passthrough to the provider's message history — not paginated/filtered server-side                       |
| GET    | /birthday/today                                            | Any (JwtAuthGuard)                                            | List active members with a birthday today (birthDay + birthMonth match current date)                          |
| GET    | /birthday/upcoming                                         | AdminGuard (MEMBERS_READ)                                     | List active members with upcoming birthdays; `?days=N` (default 7) sets the lookahead window, ordered by month/day |
| POST   | /birthday/wishes/:recipientId                              | Any                                                           | Send a birthday wish (once per year per sender; rate-limited to WISH_DAILY_LIMIT/day)                         |
| GET    | /birthday/wishes/me                                        | Any                                                           | Read own birthday wishes (?year= filter optional)                                                             |
| GET    | /birthday/wishes/:memberId                                 | AdminGuard (MEMBERS_READ)                                     | Read any member's birthday wishes                                                                             |
| GET    | /dashboard/member                                          | Any                                                           | Member dashboard                                                                                              |
| GET    | /dashboard/worker                                          | WORKER                                                        | Worker dashboard                                                                                              |
| GET    | /dashboard/admin                                           | AdminGuard (DASHBOARD_READ)                                   | Admin dashboard                                                                                               |
| POST   | /sunday-school/classes                                     | WORKER (SS-dept or class teacher)                             | Create SS class                                                                                               |
| PATCH  | /sunday-school/classes/:id                                 | WORKER (SS-dept or class teacher)                             | Update SS class                                                                                               |
| DELETE | /sunday-school/classes/:id                                 | AdminGuard (SUNDAY_SCHOOL_WRITE)                              | Delete SS class                                                                                               |
| GET    | /sunday-school/classes                                     | Any                                                           | List SS classes                                                                                               |
| GET    | /sunday-school/classes/:id                                 | Any                                                           | Get SS class by ID                                                                                            |
| POST   | /sunday-school/classes/:id/members                         | WORKER (SS-dept or class teacher)                             | Assign member to class                                                                                        |
| DELETE | /sunday-school/classes/:id/members/:memberId               | WORKER (SS-dept or class teacher)                             | Remove member from class                                                                                      |
| GET    | /sunday-school/classes/:id/members                         | WORKER (SS-dept or class teacher)                             | List class members                                                                                            |
| POST   | /sunday-school/sessions                                    | WORKER (SS-dept or class teacher)                             | Create SS session                                                                                             |
| PATCH  | /sunday-school/sessions/:id/open                           | WORKER (SS-dept or class teacher)                             | Open self-mark window for N minutes (body: `{ closesInMinutes }`)                                            |
| PATCH  | /sunday-school/sessions/:id/close                          | WORKER (SS-dept or class teacher)                             | Close self-mark window immediately                                                                            |
| GET    | /sunday-school/sessions/open                               | Any authenticated member                                      | List sessions with an active self-mark window that the member is enrolled in                                  |
| GET    | /sunday-school/attendance/me                               | Any authenticated member                                      | Paginated list of the member's own Sunday School attendance history                                           |
| POST   | /sunday-school/sessions/:id/checkin                        | Any (self-mark; member must be enrolled; window must be open) | Self-mark attendance                                                                                          |
| POST   | /sunday-school/sessions/:id/bulk-mark                      | WORKER (SS-dept or class teacher)                             | Bulk mark session attendance                                                                                  |
| GET    | /sunday-school/sessions/:id/roster                         | WORKER (SS-dept or class teacher)                             | Get session attendance roster                                                                                 |
| GET    | /sunday-school/sessions?classId=                           | Any                                                           | List sessions for a class (paginated)                                                                         |
| GET    | /sunday-school/sessions/:id                                | Any                                                           | Get SS session by ID                                                                                          |
| DELETE | /sunday-school/sessions/:id                                | AdminGuard (SUNDAY_SCHOOL_WRITE)                              | Delete SS session                                                                                             |
| GET    | /admin/sunday-school/classes                               | AdminGuard (SUNDAY_SCHOOL_READ)                               | List SS classes (paginated)                                                                                   |
| POST   | /admin/sunday-school/classes                               | AdminGuard (SUNDAY_SCHOOL_WRITE)                              | Create SS class (no auth restriction on department or teacher)                                                |
| PATCH  | /admin/sunday-school/classes/:id                           | AdminGuard (SUNDAY_SCHOOL_WRITE)                              | Update SS class                                                                                               |
| DELETE | /admin/sunday-school/classes/:id                           | AdminGuard (SUNDAY_SCHOOL_WRITE)                              | Delete SS class                                                                                               |
| GET    | /admin/sunday-school/classes/:id/members                   | AdminGuard (SUNDAY_SCHOOL_READ)                               | List members of an SS class (paginated)                                                                       |
| POST   | /admin/sunday-school/classes/:id/members                   | AdminGuard (SUNDAY_SCHOOL_WRITE)                              | Assign a member to an SS class                                                                                |
| DELETE | /admin/sunday-school/classes/:id/members/:memberId         | AdminGuard (SUNDAY_SCHOOL_WRITE)                              | Remove a member from an SS class                                                                              |
| GET    | /admin/sunday-school/sessions?classId=                     | AdminGuard (SUNDAY_SCHOOL_READ)                               | List sessions for a class (paginated; `classId` required UUID query param)                                    |
| POST   | /admin/sunday-school/sessions                              | AdminGuard (SUNDAY_SCHOOL_WRITE)                              | Create SS session                                                                                             |
| DELETE | /admin/sunday-school/sessions/:id                          | AdminGuard (SUNDAY_SCHOOL_WRITE)                              | Delete SS session                                                                                             |
| PATCH  | /admin/sunday-school/sessions/:id/open                     | AdminGuard (SUNDAY_SCHOOL_WRITE)                              | Open self-mark window (body: `{ closesInMinutes }`)                                                           |
| PATCH  | /admin/sunday-school/sessions/:id/close                    | AdminGuard (SUNDAY_SCHOOL_WRITE)                              | Close self-mark window                                                                                        |
| GET    | /admin/sunday-school/sessions/:id/roster                   | AdminGuard (SUNDAY_SCHOOL_READ)                               | Get session attendance roster                                                                                 |
| POST   | /admin/sunday-school/sessions/:id/bulk-mark                | AdminGuard (SUNDAY_SCHOOL_WRITE)                              | Bulk mark session attendance; returns `{ marked: number }`                                                    |
| POST   | /children-church/age-groups                                | AdminGuard (CHILDREN_CHURCH_WRITE)                            | Create age group                                                                                              |
| PATCH  | /children-church/age-groups/:id                            | AdminGuard (CHILDREN_CHURCH_WRITE)                            | Update age group                                                                                              |
| DELETE | /children-church/age-groups/:id                            | AdminGuard (CHILDREN_CHURCH_WRITE)                            | Delete age group                                                                                              |
| GET    | /children-church/age-groups                                | Any                                                           | List age groups                                                                                               |
| POST   | /children-church/age-groups/recompute                      | AdminGuard (CHILDREN_CHURCH_WRITE)                            | Batch reassign all children to correct age/class group                                                        |
| POST   | /children-church/class-groups                              | AdminGuard (CHILDREN_CHURCH_WRITE)                            | Create class group                                                                                            |
| PATCH  | /children-church/class-groups/:id                          | AdminGuard (CHILDREN_CHURCH_WRITE)                            | Update class group                                                                                            |
| DELETE | /children-church/class-groups/:id                          | AdminGuard (CHILDREN_CHURCH_WRITE)                            | Delete class group                                                                                            |
| GET    | /children-church/class-groups?ageGroupId=                  | WORKER (CC-dept)                                              | List class groups (filterable by age group)                                                                   |
| POST   | /children-church/children                                  | WORKER (CC-dept)                                              | Register child                                                                                                |
| PATCH  | /children-church/children/:id                              | WORKER (CC-dept)                                              | Update child profile                                                                                          |
| GET    | /children-church/children/:id                              | WORKER (CC-dept)                                              | Get child by ID                                                                                               |
| GET    | /children-church/children/:id/checkin-history              | WORKER (CC-dept)                                              | Child check-in history (paginated)                                                                            |
| GET    | /children-church/children?name=&classGroupId=&page=&limit= | WORKER (CC-dept)                                              | Search/list children                                                                                          |
| POST   | /children-church/children/:id/guardians                    | WORKER (CC-dept)                                              | Add guardian to child                                                                                         |
| GET    | /children-church/children/:id/guardians                    | WORKER (CC-dept)                                              | List child guardians                                                                                          |
| DELETE | /children-church/guardians/:id                             | WORKER (CC-dept)                                              | Remove guardian                                                                                               |
| POST   | /children-church/checkin                                   | WORKER (CC-dept)                                              | Check in a child                                                                                              |
| GET    | /children-church/checkin/verify/:code                      | WORKER (CC-dept)                                              | Verify pickup code                                                                                            |
| POST   | /children-church/checkout                                  | WORKER (CC-dept)                                              | Check out a child                                                                                             |
| PATCH  | /children-church/checkin/:id/flag                          | WORKER (CC-dept)                                              | Flag a check-in record                                                                                        |
| GET    | /children-church/checkin/active?classGroupId=              | WORKER (CC-dept)                                              | List active check-ins                                                                                         |
| GET    | /children-church/admin/checkin/active?classGroupId=        | AdminGuard (CHILDREN_CHURCH_READ)                             | Admin view — all active check-ins, optional class group filter                                                |
| GET    | /children-church/admin/checkin/history?page=&limit=&classGroupId=&status=&slotId= | AdminGuard (CHILDREN_CHURCH_READ) | Admin paginated check-in history; filters: classGroupId, status (CHECKED_IN/CHECKED_OUT/FLAGGED), slotId |
| GET    | /children-church/checkin/slot/:slotId?page=&limit=         | AdminGuard (CHILDREN_CHURCH_READ)                             | All check-ins for a service slot (paginated, default limit 20)                                                |
| GET    | /admin/tithes/records                                      | AdminGuard (FINANCE_READ)                                     | List all confirmed tithe records (paginated); filters: `memberId`, `departmentId`, `fromMonth`, `toMonth`, `search` |
| GET    | /admin/tithes/records/download                             | AdminGuard (FINANCE_READ)                                     | Download filtered tithe records as `.xlsx`; same query params as list endpoint, no pagination                 |
| GET    | /admin/tithes/template                                     | AdminGuard (FINANCE_READ)                                     | Download the tithe upload Excel template (3-sheet workbook)                                                   |
| POST   | /admin/tithes/upload                                       | AdminGuard (FINANCE_WRITE)                                    | Upload tithe payment Excel; validates headers, creates batch, dispatches Bull job                              |
| GET    | /admin/tithes/batches?status=&page=&limit=                 | AdminGuard (FINANCE_READ)                                     | List all upload batches (paginated); optional `status` filter (PENDING/PROCESSING/COMPLETED/FAILED)           |
| GET    | /admin/tithes/batches/:id                                  | AdminGuard (FINANCE_READ)                                     | Get batch by ID                                                                                               |
| POST   | /admin/tithes/batches/:id/requeue                          | AdminGuard (FINANCE_WRITE)                                    | Requeue a FAILED batch using stored row data; resets status to PENDING                                        |
| GET    | /admin/tithes/unmatched?status=&search=&page=&limit=       | AdminGuard (FINANCE_READ)                                     | List unmatched rows; `status` defaults to PENDING; `search` filters by rawEmail or reference (case-insensitive) |
| POST   | /admin/tithes/unmatched/:id/match                          | AdminGuard (FINANCE_WRITE)                                    | Manually match an unmatched row to a member; creates TitheRecord                                              |
| POST   | /admin/tithes/unmatched/:id/dismiss                        | AdminGuard (FINANCE_WRITE)                                    | Mark an unmatched row as DISMISSED (intentionally ignored)                                                    |
| GET    | /admin/tithes/disputes?status=&search=&page=&limit=        | AdminGuard (FINANCE_READ)                                     | List dispute records; `status` defaults to PENDING; `search` filters by member firstname, lastname, or email  |
| PATCH  | /admin/tithes/disputes/:id/approve                         | AdminGuard (FINANCE_WRITE)                                    | Approve a tithe dispute (creates TitheRecord)                                                                 |
| PATCH  | /admin/tithes/disputes/:id/reject                          | AdminGuard (FINANCE_WRITE)                                    | Reject a tithe dispute                                                                                        |
| GET    | /tithes/me                                                 | Any (JwtAuthGuard)                                            | Member's own tithe records (paginated)                                                                        |
| POST   | /tithes/me/statement/send                                  | Any (JwtAuthGuard)                                            | Email a PDF Giving Statement (TitheRecord + CONFIRMED PledgeContribution, merged and per-line typed — see "Giving Statement" above) to the caller's registered email. Optional query: `fromMonth` (YYYY-MM), `toMonth` (YYYY-MM) — filters records to the date range and prints the period on the PDF |
| POST   | /tithes/proof                                              | Any (JwtAuthGuard)                                            | Submit tithe payment proof (multipart, field: file, max 2 MB); body: amount, paymentDate, bankName?, reference? |
| GET    | /tithes/proof                                              | Any (JwtAuthGuard)                                            | List caller's own tithe payment proofs (paginated)                                                            |
| GET    | /admin/tithes/proofs?status=&search=&page=&limit=          | AdminGuard (FINANCE_READ)                                     | List all tithe payment proofs; optional `status` filter (PENDING/CONFIRMED/DECLINED); `search` filters by member firstname, lastname, or email |
| POST   | /admin/tithes/proofs/:id/confirm                           | AdminGuard (FINANCE_WRITE)                                    | Confirm a tithe payment proof; notifies member by email                                                       |
| POST   | /admin/tithes/proofs/:id/decline                           | AdminGuard (FINANCE_WRITE)                                    | Decline a tithe payment proof (body: financeNote); notifies member by email                                   |
| GET    | /admin/finance/categories                                  | AdminGuard (FINANCE_READ)                                     | List finance categories                                                                                       |
| POST   | /admin/finance/categories                                  | AdminGuard (FINANCE_WRITE)                                    | Create finance category                                                                                       |
| PATCH  | /admin/finance/categories/:id                              | AdminGuard (FINANCE_WRITE)                                    | Update finance category                                                                                       |
| GET    | /admin/finance/requests                                    | AdminGuard (FINANCE_READ)                                     | List finance requests (paginated); filters: `status`, `categoryId`, `memberId`, `departmentId`, `search`      |
| GET    | /admin/finance/requests/download                           | AdminGuard (FINANCE_READ)                                     | Download filtered finance requests as `.xlsx`; same query params as list endpoint, no pagination              |
| GET    | /admin/finance/requests/:id                                | AdminGuard (FINANCE_READ)                                     | Get finance request by ID                                                                                     |
| PATCH  | /admin/finance/requests/:id/approve                        | AdminGuard (FINANCE_WRITE)                                    | Approve a pending finance request — 403 if the approver is the same member who raised the request            |
| PATCH  | /admin/finance/requests/:id/reject                         | AdminGuard (FINANCE_WRITE)                                    | Reject a pending finance request (body: rejectionReason)                                                      |
| PATCH  | /admin/finance/requests/:id/proof                          | AdminGuard (FINANCE_WRITE)                                    | Attach payment proof to an approved request (multipart, field: file)                                          |
| GET    | /finance/categories                                        | WORKER (RolesGuard)                                           | List finance categories (visible to HOD for request creation)                                                 |
| POST   | /finance/requests                                          | WORKER — HOD only                                             | Raise a finance request for own department (multipart optional: attachment)                                   |
| GET    | /finance/requests                                          | WORKER — HOD only                                             | List own department's finance requests (paginated)                                                            |
| GET    | /finance/requests/:id                                      | WORKER — HOD only                                             | Get a single request from own department (includes proofUrl once attached)                                    |
| POST   | /service-programme                                         | AdminGuard + SERVICE_PROGRAMME_WRITE                          | Create a programme for one or more service slots in one call — body is `{ programmes: [{ serviceSlotId, slots? }], saveAsTemplate? }` (`programmes` min 1). One `ServiceProgramme` per slot still (1:1 with `ServiceSlot`), but a multi-service Sunday (First/Second Service under one Event) can be programmed in a single request instead of one round trip per slot. Each entry's `slots` (order-of-service items) is independent — sibling slots are not required to have matching items, or any items at all. 404 if any `serviceSlotId` doesn't exist; 409 (naming the affected slots) if any already has a programme — the whole call is rejected, none are created. Each `slots` item is created the same way `POST /service-programme/:id/slots` would (member/backup resolution, assignment email, conflict-warning check), in array order starting at position 0. `saveAsTemplate` applies to every programme created in the call. Response is a single fully-loaded programme (same shape as `GET /service-programme/:id`) when `programmes` has one entry, or an array of them when it has multiple. Omitting an entry's `slots` still creates that programme as an empty DRAFT, added to later. |
| GET    | /service-programme                                         | AdminGuard + SERVICE_PROGRAMME_READ                           | List all programmes paginated (query: page, limit). Each result includes structured `event: { id, name, eventDate }` and `serviceSlotDetail: { id, name, startTime, endTime }` (in addition to the flattened `serviceSlotName` string) so the admin UI can group programmes by their parent event instead of rendering every slot as an unrelated row. |
| GET    | /service-programme/my-assignments                          | JwtAuthGuard                                                  | The calling member's own upcoming slots (as primary or backup) across every DRAFT/LIVE programme, ordered by service start time. Each entry includes `isBackup`, so a member on standby can tell it apart from a confirmed slot. Excludes COMPLETED programmes and anything already in the past. Also includes `sessionCode` — `null` until the programme's session goes LIVE, then the code needed to call `GET /service-session/:sessionCode/my-status`. |
| GET    | /service-programme/upcoming                                | JwtAuthGuard                                                  | The general order-of-service view — the soonest LIVE-or-still-upcoming-DRAFT programme, with every slot (not scoped to the caller), mapped to `speakerName`/`backupSpeakerName` strings only (never the raw `Member` row). Returns `null` rather than 404ing when nothing qualifies. Also includes `sessionCode` once LIVE. Must stay registered before `:id` below in the controller. |
| GET    | /service-programme/templates                               | AdminGuard + SERVICE_PROGRAMME_READ                           | List all reusable programme templates ordered by name                                                         |
| DELETE | /service-programme/templates/:templateId                   | AdminGuard + SERVICE_PROGRAMME_WRITE                          | Delete a template                                                                                             |
| GET    | /service-programme/:id                                     | AdminGuard + SERVICE_PROGRAMME_READ                           | Get a single programme with all slots and member relations. Each slot includes flattened `memberName`/`backupMemberName` strings derived from the loaded `member`/`backupMember` relations, so the frontend never has to resolve the relation object itself. |
| PATCH  | /service-programme/:id                                     | AdminGuard + SERVICE_PROGRAMME_WRITE                          | Update programme metadata (saveAsTemplate flag). Existed with no frontend consumer until now — `ProgrammeDetailPanel` has a "Save as template when completed" toggle next to the status flow. |
| DELETE | /service-programme/:id                                     | AdminGuard + SERVICE_PROGRAMME_WRITE                          | Delete a DRAFT programme — 400 if LIVE or COMPLETED                                                          |
| POST   | /service-programme/:id/slots                               | AdminGuard + SERVICE_PROGRAMME_WRITE                          | Append a slot (appended at next position). If `memberId` is set and that member has an email, queues a `service-slot-assigned` notification email. |
| PUT    | /service-programme/:id/slots/reorder                       | AdminGuard + SERVICE_PROGRAMME_WRITE                          | Reorder all slots (body: `{ slots: [{ id }] }` in desired order) — DRAFT programmes only; for LIVE sessions use `PUT /service-session/:sessionCode/slots/reorder` |
| PATCH  | /service-programme/:id/slots/:slotId                       | AdminGuard + SERVICE_PROGRAMME_WRITE                          | Update a single slot — 400 if programme is not DRAFT. Queues a `service-slot-assigned` email only when `memberId` newly changes to a different member (no email on unrelated edits or on clearing the assignment). |
| DELETE | /service-programme/:id/slots/:slotId                       | AdminGuard + SERVICE_PROGRAMME_WRITE                          | Remove a slot — 400 if programme is not DRAFT                                                                |
| POST   | /service-programme/:id/apply-template/:templateId          | AdminGuard + SERVICE_PROGRAMME_WRITE                          | Apply a template to a DRAFT programme (clears existing slots, copies template structure)                      |
| GET    | /service-programme/event/:eventId/pdf                      | AdminGuard + SERVICE_PROGRAMME_READ                           | Download the full event programme as a PDF (application/pdf). Covers every service slot in the event ordered by start time. Each service shows its programme slots (type, topic, speaker, backup, minutes) or a "no programme" notice if not yet created. Filename derived from event name. |
| GET    | /service-programme/:id/pdf                                 | AdminGuard + SERVICE_PROGRAMME_READ                           | Download a single programme as a PDF (application/pdf). Includes slot name, event date/time, all slots with type, topic, speaker, backup, and allocated minutes. |
| GET    | /service-programme/:id/sessions                            | AdminGuard + SERVICE_PROGRAMME_READ                           | Paginated list of historical sessions for a programme (query: page, limit). Existed with no frontend consumer until now — `ProgrammeDetailPanel` has a collapsible "Session History" section (usually 0–1 entries under current business rules, since a programme can't be restarted once it leaves DRAFT; the endpoint exists for the audit trail regardless). |
| POST   | /service-session/programme/:programmeId/start              | JwtAuthGuard (+ assertCanControlSession)                      | Start a session for a DRAFT programme; returns session with sessionCode and generates a Redis shareToken       |
| POST   | /service-session/event/:eventId/start                      | JwtAuthGuard (+ assertCanControlSession)                      | Starts only the next DRAFT programme in the event (earliest `serviceSlot.startTime`); returns a single session. 409 if a session for this event is already LIVE — end it first. 404 if the event has no service slots; 400 if no programme is startable (all already started/completed, or none have slots yet). Call again after ending the current session to advance to the next slot. |
| POST   | /service-session/:sessionCode/advance                      | JwtAuthGuard (+ assertCanControlSession)                      | Advance to next slot; returns updated Redis anchor                                                            |
| POST   | /service-session/:sessionCode/rewind                       | JwtAuthGuard (+ assertCanControlSession)                      | Go back to previous slot — 400 if already at first slot                                                      |
| POST   | /service-session/:sessionCode/pause                        | JwtAuthGuard (+ assertCanControlSession)                      | Pause session (body: reason); creates ServicePauseEntry                                                       |
| POST   | /service-session/:sessionCode/resume                       | JwtAuthGuard (+ assertCanControlSession)                      | Resume paused session; adjusts slotBaseSeconds to exclude pause duration                                      |
| POST   | /service-session/:sessionCode/adjust-time                  | JwtAuthGuard (+ assertCanControlSession)                      | Add/subtract seconds from the running slot's remaining time (body: `{ deltaSeconds }`, -3600..3600)           |
| PUT    | /service-session/:sessionCode/slots/reorder                | JwtAuthGuard (+ assertCanControlSession)                      | Reorder the not-yet-started (PENDING) tail of `ServiceSessionSlot` rows for a LIVE session (body: `{ slots: [{ id }] }`) — distinct from the DRAFT-only `/service-programme/:id/slots/reorder` |
| POST   | /service-session/:sessionCode/slots/:position/override     | RolesGuard (WORKER) + Admin dept                              | Runtime override for a slot (speakerName, topic, allocatedMinutes, memberId)                                  |
| POST   | /service-session/:sessionCode/end                          | JwtAuthGuard (+ assertCanControlSession)                      | End session; marks remaining slots SKIPPED; auto-saves template if saveAsTemplate                             |
| GET    | /service-session/:sessionCode/share-links                  | JwtAuthGuard (+ assertCanControlSession)                      | Returns `{ sessionCode, shareToken }` for building the public Presentation/Programme Manager links. Self-healing: if the session's anchor is live but no `shareToken` was ever written (a race with the fire-and-forget `set()` in `start()`, a transient Redis hiccup, or a session that's been live since before this field existed), a new token is generated and persisted on the fly instead of 404ing forever |
| POST   | /service-session/:sessionCode/rotate-share-token           | JwtAuthGuard (+ assertCanControlSession)                      | Regenerates the Redis-stored `shareToken`, invalidating any previously shared Programme Manager link without ending the session |
| POST   | /service-session/:sessionCode/access-grants                | JwtAuthGuard (+ assertCanControlSession)                      | Generate a named, individually-revocable PM-link credential (body: `{ name }`); returns `{ id, name, pin }` — the plaintext 6-digit PIN is shown exactly once and never retrievable again |
| GET    | /service-session/:sessionCode/access-grants                 | JwtAuthGuard (+ assertCanControlSession)                      | List access grants for the session (`{ id, name, createdAt, revokedAt, lastUsedAt }[]`, no PIN/hash exposed) |
| POST   | /service-session/:sessionCode/access-grants/:grantId/revoke | JwtAuthGuard (+ assertCanControlSession)                      | Revoke a named grant; takes effect on that person's next `pm/*` action without touching anyone else's access or the shared link |
| POST   | /service-session/:sessionCode/pm/access                    | Public + ShareTokenGuard (`?token=`)                          | Sign in to the Programme Manager link with `{ name, pin }`; returns `{ grantToken, name }` on success — this is the identity step itself, so it's the one `pm/*` route that isn't also gated by NamedAccessGuard |
| POST   | /service-session/:sessionCode/pm/advance                   | Public + ShareTokenGuard (`?token=`) + NamedAccessGuard (`?grantToken=`) | Same as `/advance`, callable from the public Programme Manager link                                           |
| POST   | /service-session/:sessionCode/pm/rewind                    | Public + ShareTokenGuard (`?token=`) + NamedAccessGuard (`?grantToken=`) | Same as `/rewind`, callable from the public Programme Manager link                                            |
| POST   | /service-session/:sessionCode/pm/pause                     | Public + ShareTokenGuard (`?token=`) + NamedAccessGuard (`?grantToken=`) | Same as `/pause`, callable from the public Programme Manager link                                             |
| POST   | /service-session/:sessionCode/pm/resume                    | Public + ShareTokenGuard (`?token=`) + NamedAccessGuard (`?grantToken=`) | Same as `/resume`, callable from the public Programme Manager link                                            |
| POST   | /service-session/:sessionCode/pm/adjust-time                | Public + ShareTokenGuard (`?token=`) + NamedAccessGuard (`?grantToken=`) | Same as `/adjust-time`, callable from the public Programme Manager link                                       |
| PUT    | /service-session/:sessionCode/pm/slots/reorder              | Public + ShareTokenGuard (`?token=`) + NamedAccessGuard (`?grantToken=`) | Same as `/slots/reorder`, callable from the public Programme Manager link                                     |
| POST   | /service-session/:sessionCode/pm/slots/:position/override    | Public + ShareTokenGuard (`?token=`) + NamedAccessGuard (`?grantToken=`) | Same as `/slots/:position/override`, callable from the public Programme Manager link — lets the PM rename a topic or swap the minister/speaker mid-service, not just admins |
| POST   | /service-session/:sessionCode/pm/end                        | Public + ShareTokenGuard (`?token=`) + NamedAccessGuard (`?grantToken=`) | Same as `/end`, callable from the public Programme Manager link (session end is included in the public link's scope by product decision) |
| GET    | /service-session/active                                    | AdminGuard + SERVICE_PROGRAMME_READ                           | Returns `{ sessionCode, serviceSlotName, startedAt }[]` for every currently LIVE session — powers the global "Live" indicator shown in the admin top bar on every page |
| GET    | /service-session/analytics                                 | AdminGuard + SERVICE_PROGRAMME_READ                           | Aggregate analytics across COMPLETED sessions (query: from, to, serviceSlotName — matches either the sub-service's own name or its parent event's name; memberId — restricts to sessions this member appeared in, as originally assigned or as whoever stepped in; slotType — restricts the type/speaker breakdown to one `ServiceSlotTypeEnum` value); overrun stats, avg times, top speakers |
| GET    | /service-session/my-history?page=&limit=                   | JwtAuthGuard                                                  | The calling member's own COMPLETED-session slot history (query: page, limit; default 1/10). Returns `{ totalSlots, totalActualSeconds, bySlotType: [{type, count, totalActualSeconds}], entries: [{eventName, serviceSlotName, sessionDate, type, topic, allocatedMinutes, actualSeconds}], page, limit, totalCount, totalPages }`. Summary/`bySlotType` are computed over the caller's full history, not just the current page. Credits only the *effective* speaker of a slot (`overriddenMember?.id ?? programmeSlot.member?.id`) — a listed backup who never actually went on gets no credit, matching the same rule `getAnalytics`'s `memberId` filter already uses. Powers the member-facing app's "Service History" page. |
| GET    | /service-session/:sessionCode/state                        | Public (`@Public()`)                                          | Get live session state — anchor from Redis + programme data + `effectiveSlots` (see below); used by presentation, audience, and Programme Manager views |
| GET    | /service-session/:sessionCode/slots/:position              | Public (`@Public()`)                                          | Single slot state for speaker view — programmeSlot data, overrides, and current anchor                        |
| GET    | /service-session/:sessionCode/my-status                    | JwtAuthGuard                                                  | The calling member's personal view of a LIVE session — role (`PRIMARY`/`BACKUP`), position, whether it's currently their turn (`isMyTurnNow`), whether they've already gone (`hasPassed`), an `estimatedSecondsUntilMyTurn` (remaining time on the current slot plus the allocated time of every slot in between, `null` once it's their turn or already passed), and the full `runningOrder`. 404 if the caller has no primary or backup slot in the session. Powers the member-facing app's real-time "my slot" view (`/my-assignment/:sessionCode`), polled every 8s. |
| GET    | /service-session/:sessionCode/report                       | AdminGuard + SERVICE_PROGRAMME_READ                           | Formatted session report: duration, completion rate, per-slot overrun, pause log                              |
| GET    | /service-session/:sessionCode/report/pdf                   | AdminGuard + SERVICE_PROGRAMME_READ                           | Download session report as a PDF file — same data as JSON report, formatted for printing and sharing          |
| GET    | /service-session/:sessionCode/pm/report/pdf                | Public + ShareTokenGuard (`?token=`) + NamedAccessGuard (`?grantToken=`) | Same PDF as above, callable from the public Programme Manager link — surfaced on the manage page's "Session Ended" screen |
| GET    | /service-session/:sessionCode/action-log                   | JwtAuthGuard (+ assertCanControlSession)                      | Returns the 10 most recent `ServiceActionEntry` rows (newest first) as JSON — powers the "Recent Activity" feed on the Live Session Dashboard. Same access tier as the control actions (not admin-only), since it's operational context, not a compliance artifact. |
| GET    | /service-session/:sessionCode/action-log/csv                | AdminGuard + SERVICE_PROGRAMME_READ                           | Download the full `ServiceActionEntry` audit trail for a session as CSV (Timestamp, Actor Role, Actor, Action, Detail) — admin-only compliance export, distinct from the JSON feed above |
| GET    | /service-session/event/:eventId/report/pdf                 | AdminGuard + SERVICE_PROGRAMME_READ                           | Download a full-event PDF covering all service slots in one document. Requires all sessions to be COMPLETED; returns 400 if any are still live and 404 if none exist. Includes variance summary table, per-slot allocated vs actual, slot variance (sum of individual slot overruns), and an ACCENT time-summary band per section. |
| GET    | /service-session/event/:eventId/report/summary-pdf         | AdminGuard + SERVICE_PROGRAMME_READ                           | Download a shareable one-page event summary PDF (admin access). Does NOT require sessions to be COMPLETED — works at any point after at least one session has started. Contains 4 stat cards (Speakers Done, Total Allocated, Total Actual, Overall Variance) and a single flat table across all services: # \| Speaker \| Topic/Slot \| Allocated \| Actual \| Variance \| Status. Times in MM:SS. Status labels: Over Time (red), Under Time/On Time (green), Not Used/Pending (muted). Returns 404 if no sessions exist. Now wired to a "Summary" button in the Programmes list's per-event header, shown whenever at least one sub-service is no longer DRAFT (matching this route's actual requirement, looser than the "Session Report" button's all-COMPLETED gate). |
| GET    | /service-session/event/:eventId/summary-pdf                | JwtAuthGuard + WORKER + Admin dept (primary or secondary)     | Identical PDF to the admin route above, but accessible by workers in the Admin department (primary or secondary). Enforces `assertIsAdminDeptWorker` — returns 403 if the authenticated worker is not in the Admin department (no `SERVICE_PROGRAMME_WRITE` fallback; this check is intentionally separate from `assertCanControlSession` used by session control). Designed for mobile use: admin-dept workers can download and share the summary immediately after service ends. |

| POST   | /service-headcount                                         | AdminGuard + HEADCOUNT_WRITE                                  | Record physical attendance headcount for a service slot (body: serviceSlotId, maleAdults, femaleAdults, teenagers, children, mobileChurch, customGroups?, notes?); upsert — recording again for the same slot edits the existing row. This is the only way to correct a record — the separate PATCH endpoint was removed (see ServiceHeadcount Module notes above). |
| GET    | /service-headcount                                         | AdminGuard + HEADCOUNT_READ                                   | List headcount records (query: page, limit, serviceSlotId, from, to); each record includes computed `total`   |
| GET    | /service-headcount/trends                                  | AdminGuard + HEADCOUNT_READ                                   | Aggregated attendance trends bucketed by period (query: period=weekly\|monthly\|quarterly, from, to, serviceSlotName); returns grouped data per slot per bucket |
| GET    | /service-headcount/event/:eventId/summary                  | AdminGuard + HEADCOUNT_READ                                   | Every sub-service under the event with its headcount (or null) plus the aggregate total across recorded sub-services |
| GET    | /service-headcount/:id                                     | AdminGuard + HEADCOUNT_READ                                   | Get a single headcount record by ID (includes computed `total`). Existed with no frontend consumer until now — the Records tab has a "View details" (eye icon) action per row, showing `notes`/`customGroups`/`recordedBy` (none of which the flat table has room for). |
| POST   | /service-headcount/export-email                            | AdminGuard + HEADCOUNT_READ                                   | Email the currently-filtered headcount rows as an `.xlsx` attachment (body: `recipientEmail?`, `serviceSlotId?`, `from?`, `to?`). `recipientEmail` defaults to the requesting admin's own email. One-off only — not a recurring/scheduled report. Logs `REPORT_EXPORTED`. |

| GET    | /admin/settings                                            | AdminGuard (any admin)                                        | List all known modules with their current enabled status, `displayName`, and `required` flag (absent row = enabled by default) |
| GET    | /admin/settings/:key                                       | AdminGuard (any admin)                                        | Get one module setting by key (e.g. `incident_report`, `asset_management`). Returns `required` flag.          |
| PATCH  | /admin/settings/:key                                       | AdminGuard (ADMIN_WRITE)                                      | Enable/disable a module and/or set a `displayName` override — body: `{ enabled?: boolean, displayName?: string }`. Returns `400` if disabling a `required` module. Merges rather than overwrites — omitting `displayName` preserves any previously-set label. Upserts the row, invalidates cache, and writes `CHURCH_SETTING_UPDATED` audit log. |
| GET    | /modules/state                                             | JwtAuthGuard (any authenticated role)                         | Shared read endpoint: `{ key, enabled, displayName }[]` for every known module. Single source of truth consumed by both frontends for nav/tile visibility and permission-group visibility — see Church Settings Module. |

| POST   | /incidents                                                 | JwtAuthGuard + Module: incident_report                        | Submit a new incident report. `multipart/form-data`. Rate-limited to `INCIDENT_DAILY_REPORT_LIMIT` (default 2) per member per 24 h. Fields: `title`, `description`, `location?`, `isAnonymous?` (default false). File field: `images` (up to 5 image files, max 5 MB each — uploaded to Cloudinary; `incident-images` folder). Notifies admins with INCIDENT_REPORT_WRITE permission by email. |
| GET    | /incidents?page=&limit=                                    | JwtAuthGuard + Module: incident_report                        | Returns only the current member's own reports. Members cannot see reports submitted by others.                |
| GET    | /incidents/:id                                             | JwtAuthGuard + Module: incident_report                        | Returns a single report only if it was submitted by the current member. Returns `404` otherwise.             |
| GET    | /admin/incidents?page=&limit=&status=&dateFrom=&dateTo=    | AdminGuard (INCIDENT_REPORT_READ)                             | Paginated list of all incidents. Optional filters: `status` (`OPEN`/`IN_PROGRESS`/`RESOLVED`), `dateFrom` and `dateTo` (ISO date strings, inclusive). Reporter masked to `null` for anonymous reports. |
| GET    | /admin/incidents/:id                                       | AdminGuard (INCIDENT_REPORT_READ)                             | Get a single incident report with full details.                                                               |
| PATCH  | /admin/incidents/:id/status                                | AdminGuard (INCIDENT_REPORT_WRITE)                            | Update incident status (`OPEN` → `IN_PROGRESS` → `RESOLVED`) and optionally set adminNotes. Sets `resolvedAt` automatically when status is `RESOLVED`. |

| GET    | /prayer/admin/programs?name=                               | AdminGuard (PRAYER_READ)                                      | List all prayer programs; optional `name` param does a case-insensitive partial match                         |
| POST   | /prayer/admin/programs                                     | AdminGuard (PRAYER_WRITE)                                     | Create a prayer program; body: `name`, `audience` (WORKERS\|MEMBERS\|ALL), `description?`, `selectionWindowDays?` |
| PATCH  | /prayer/admin/programs/:id                                 | AdminGuard (PRAYER_WRITE)                                     | Update a prayer program (any field including `isActive`)                                                      |
| DELETE | /prayer/admin/programs/:id                                 | AdminGuard (PRAYER_WRITE)                                     | Deactivate a prayer program (sets `isActive = false`)                                                         |
| POST   | /prayer/admin/programs/:id/clone                           | AdminGuard (PRAYER_WRITE)                                     | Clone a program: copies all day configs and rules into a new program; body: `name`, `description?`, `audience?`, `selectionWindowDays?`, `includeFixedAssignments?` |
| GET    | /prayer/admin/config                                       | AdminGuard (PRAYER_READ)                                      | Get the active schedule config (selectionWindowDays)                                                          |
| PATCH  | /prayer/admin/config                                       | AdminGuard (PRAYER_WRITE)                                     | Upsert the active schedule config                                                                             |
| GET    | /prayer/admin/day-configs?programId=                       | AdminGuard (PRAYER_READ)                                      | List prayer day configs for a program, ordered by dayOfWeek                                                   |
| POST   | /prayer/admin/day-configs?programId=                       | AdminGuard (PRAYER_WRITE)                                     | Create a prayer day config for a program (one active config per day per program)                              |
| PATCH  | /prayer/admin/day-configs/:id                              | AdminGuard (PRAYER_WRITE)                                     | Update a prayer day config (mode, startTime, endTime, maxCapacity, isActive)                                  |
| GET    | /prayer/admin/rules?programId=                             | AdminGuard (PRAYER_READ)                                      | List schedule rules for a program                                                                             |
| POST   | /prayer/admin/rules?programId=                             | AdminGuard (PRAYER_WRITE)                                     | Create a schedule rule for a program                                                                          |
| PATCH  | /prayer/admin/rules/:id                                    | AdminGuard (PRAYER_WRITE)                                     | Update a schedule rule (value, isActive, etc.)                                                                |
| GET    | /prayer/admin/fixed-assignments?programId=                 | AdminGuard (PRAYER_READ)                                      | List active fixed assignments for a program with worker and day config relations                               |
| POST   | /prayer/admin/fixed-assignments?programId=                 | AdminGuard (PRAYER_WRITE)                                     | Create a fixed assignment; body: `workerProfileId`, `dayConfigId`                                             |
| DELETE | /prayer/admin/fixed-assignments/:id                        | AdminGuard (PRAYER_WRITE)                                     | Soft-deactivate a fixed assignment                                                                            |
| POST   | /prayer/admin/meetings/generate?programId=                 | AdminGuard (PRAYER_WRITE)                                     | Generate all meetings for a month for a program; auto-applies fixed assignments; 409 if meetings already exist |
| POST   | /prayer/admin/meetings/open-selection?programId=           | AdminGuard (PRAYER_WRITE)                                     | Open self-selection window for all PENDING meetings in a month for a program                                  |
| POST   | /prayer/admin/meetings/close-selection?programId=          | AdminGuard (PRAYER_WRITE)                                     | Close self-selection window for all OPEN meetings in a month for a program                                    |
| POST   | /prayer/admin/roster/auto-assign?programId=&month=&year=   | AdminGuard (PRAYER_WRITE)                                     | Auto-assign workers to a program's meetings (clears AUTO_ASSIGNED first for idempotency); returns `{ assigned, unassignable }` |
| POST   | /prayer/admin/roster/manual-assign?programId=              | AdminGuard (PRAYER_WRITE)                                     | Manually assign a worker or member to a meeting; body: `meetingId`, `workerProfileId?` \| `memberId?`         |
| DELETE | /prayer/admin/roster/entries/:id                           | AdminGuard (PRAYER_WRITE)                                     | Remove a SCHEDULED non-FIXED roster entry and decrement meeting capacity                                      |
| GET    | /prayer/admin/roster/validate?programId=&month=&year=      | AdminGuard (PRAYER_READ)                                      | Validate roster completeness; returns `{ valid, issues[] }` with per-worker frequency and per-meeting leader checks |
| GET    | /prayer/admin/roster/:month/:year?programId=               | AdminGuard (PRAYER_READ)                                      | Get full monthly roster for a program with all meetings, day configs, and roster entries                      |
| PATCH  | /prayer/admin/roster/entries/:id/reschedule                | AdminGuard (PRAYER_WRITE)                                     | Soft-reschedule: marks old entry `RESCHEDULED`, creates new entry on target meeting with `rescheduledFrom` FK; body: `{ newMeetingId }` |
| GET    | /prayer/programs?name=                                     | WORKER                                                        | List active prayer programs scoped to the caller (`audience = WORKERS` or `ALL`); optional `name` param does a case-insensitive partial match; used to obtain a `programId` before calling meeting/roster endpoints |
| GET    | /prayer/available?programId=&month=&year=                  | WORKER                                                        | List open prayer meetings for a program with remaining capacity for the given month                           |
| GET    | /prayer/my-roster?programId=&month=&year=                  | WORKER                                                        | Authenticated worker's own roster entries for a program in the given month                                    |
| GET    | /prayer/my-status?programId=&month=&year=                  | WORKER                                                        | Returns `{ required, selected, canSubmit, entries }` — shows progress toward frequency quota for a program    |
| POST   | /prayer/select?programId=                                  | WORKER                                                        | Self-select a prayer slot; body: `{ meetingId }`; enforced with pessimistic DB lock to prevent overbooking    |

| POST   | /facility-rental/admin/facilities                          | AdminGuard (FACILITY_RENTAL_WRITE)                            | Create a rental facility; body: `name`, `basePrice`, `description?`, `capacity?`                             |
| GET    | /facility-rental/admin/facilities                          | AdminGuard (FACILITY_RENTAL_READ)                             | List all facilities                                                                                           |
| PATCH  | /facility-rental/admin/facilities/:id                      | AdminGuard (FACILITY_RENTAL_WRITE)                            | Update facility (any field including `isActive`)                                                              |
| POST   | /facility-rental/admin/pricing-tiers                       | AdminGuard (FACILITY_RENTAL_WRITE)                            | Upsert a pricing tier for a member category; body: `memberCategory`, `discountType`, `discountValue`         |
| GET    | /facility-rental/admin/pricing-tiers                       | AdminGuard (FACILITY_RENTAL_READ)                             | List all pricing tiers                                                                                        |
| DELETE | /facility-rental/admin/pricing-tiers/:id                   | AdminGuard (FACILITY_RENTAL_WRITE)                            | Remove a pricing tier                                                                                         |
| POST   | /facility-rental/admin/addons                              | AdminGuard (FACILITY_RENTAL_WRITE)                            | Create add-on; body: `name`, `price`, `cautionAmount?`, `description?`, `assetId?`                           |
| GET    | /facility-rental/admin/addons                              | AdminGuard (FACILITY_RENTAL_READ)                             | List active add-ons (with linked asset)                                                                       |
| PATCH  | /facility-rental/admin/addons/:id                          | AdminGuard (FACILITY_RENTAL_WRITE)                            | Update add-on                                                                                                 |
| POST   | /facility-rental/admin/calendar-blocks                     | AdminGuard (FACILITY_RENTAL_WRITE)                            | Create admin blackout block; body: `facilityId`, `startDateTime`, `endDateTime`, `reason?`                   |
| GET    | /facility-rental/admin/calendar-blocks?facilityId=         | AdminGuard (FACILITY_RENTAL_READ)                             | List blackout blocks for a facility                                                                           |
| DELETE | /facility-rental/admin/calendar-blocks/:id                 | AdminGuard (FACILITY_RENTAL_WRITE)                            | Remove a calendar block                                                                                       |
| GET    | /facility-rental/admin/bookings?status=                    | AdminGuard (FACILITY_RENTAL_READ)                             | List all bookings, optionally filtered by status                                                              |
| GET    | /facility-rental/admin/bookings/:id                        | AdminGuard (FACILITY_RENTAL_READ)                             | Get single booking with addons and payments                                                                   |
| PATCH  | /facility-rental/admin/bookings/:id/confirm                | AdminGuard (FACILITY_RENTAL_WRITE)                            | Confirm a pending booking; optional body: `notes`                                                             |
| PATCH  | /facility-rental/admin/bookings/:id/reject                 | AdminGuard (FACILITY_RENTAL_WRITE)                            | Reject a pending booking; body: `rejectionReason`                                                             |
| PATCH  | /facility-rental/admin/bookings/:id/discount               | AdminGuard (FACILITY_RENTAL_WRITE)                            | Apply override discount; body: `overrideDiscountType`, `overrideDiscountValue`, `overrideDiscountNote?`; recalculates serviceFee and updates SERVICE_FEE payment record |
| DELETE | /facility-rental/admin/bookings/:id/discount               | AdminGuard (FACILITY_RENTAL_WRITE)                            | Remove override discount; reverts to tier-based pricing                                                       |
| PATCH  | /facility-rental/admin/payments/:id/paid                   | AdminGuard (FACILITY_RENTAL_WRITE)                            | Mark a payment as paid; optional body: `reference`, `proofUrl`                                               |
| PATCH  | /facility-rental/admin/payments/:id/refund                 | AdminGuard (FACILITY_RENTAL_WRITE)                            | Mark a caution payment as refunded (must be PAID first)                                                       |
| GET    | /facility-rental/facilities                                | JwtAuthGuard                                                  | List active facilities (member-facing)                                                                        |
| GET    | /facility-rental/addons                                    | JwtAuthGuard                                                  | List active add-ons with linked asset (member-facing)                                                         |
| GET    | /facility-rental/facilities/:id/availability?from=&to=     | JwtAuthGuard                                                  | Returns blocked time ranges (bookings + admin blocks) for the facility within a date window                   |
| POST   | /facility-rental/bookings                                  | JwtAuthGuard                                                  | Create booking; body: `facilityId`, `startDateTime`, `endDateTime`, `purpose?`, `addons?: [{addonId, quantity}]`; overlap-checked; price auto-computed from tier |
| GET    | /facility-rental/bookings                                  | JwtAuthGuard                                                  | Authenticated member's own bookings                                                                           |
| GET    | /facility-rental/bookings/:id                              | JwtAuthGuard                                                  | Get own booking detail (returns 404 if belongs to another member)                                             |
| PATCH  | /facility-rental/bookings/:id/cancel                       | JwtAuthGuard                                                  | Cancel own booking (only PENDING or CONFIRMED)                                                                |

| POST   | /notifications/subscribe                                   | JwtAuthGuard                                                  | Register a Web Push subscription. Called **once** after first device registration (`deviceId` transitions from `null`). Also called after re-registering on a new device following an admin purge or OTP device reset. Body: `endpoint`, `p256dh`, `auth`. Returns 204. |
| DELETE | /notifications/subscribe                                   | JwtAuthGuard                                                  | Explicit opt-out: removes the Web Push subscription. **Not called on normal logout** — subscription persists so the service worker can deliver notifications while the member is logged out. Returns 204. |

| POST   | /admin/assets                                              | AdminGuard (ASSET_MANAGEMENT_WRITE) + Module: asset_management | Create a new asset. `tagNumber` auto-generated (`AST-{YEAR}-{NNNN}`) if not provided. Optional: `serialNumber`, `manufacturer`, `model`, `warrantyExpiry`, `vendorName`, `vendorContact`, `departmentId`. Returns `409` if tag already exists. |
| GET    | /admin/assets?page=&limit=&status=&category=&maintenanceEnabled=&departmentId= | AdminGuard (ASSET_MANAGEMENT_READ) + Module: asset_management | Paginated asset list. Filterable by status, category (case-insensitive), maintenanceEnabled, and departmentId. Each record includes `maintenanceSchedule` and `department`. |
| GET    | /admin/assets/checkouts?page=&limit=                       | AdminGuard (ASSET_MANAGEMENT_READ) + Module: asset_management | All currently active checkouts across all assets (returnedAt IS NULL), newest first. |
| GET    | /admin/assets/:id                                          | AdminGuard (ASSET_MANAGEMENT_READ) + Module: asset_management | Get asset with `maintenanceSchedule` and `department`. Maintenance history is paginated separately. |
| PATCH  | /admin/assets/:id                                          | AdminGuard (ASSET_MANAGEMENT_WRITE) + Module: asset_management | Partial update. Supports all asset fields including `serialNumber`, `manufacturer`, `model`, `warrantyExpiry`, `vendorName`, `vendorContact`, `departmentId`. |
| POST   | /admin/assets/:id/maintenance-schedule                     | AdminGuard (ASSET_MANAGEMENT_WRITE) + Module: asset_management | Set or update the maintenance schedule. Sets `maintenanceEnabled = true`. Resets all notification timestamps. Body: `frequencyUnit`, `frequencyValue`, `nextDueAt`. |
| POST   | /admin/assets/:id/maintenance-records                      | AdminGuard (ASSET_MANAGEMENT_WRITE) + Module: asset_management | Log a maintenance record. `COMPLETED` → asset `ACTIVE` + recalculates `nextDueAt`. `IN_PROGRESS` → asset `UNDER_MAINTENANCE`. |
| PATCH  | /admin/assets/:id/inventory                                | AdminGuard (ASSET_MANAGEMENT_WRITE) + Module: asset_management | Set inventory breakdown. Sets `inventoryEnabled = true`. Body: `inStorage`, `inUse`, `underRepair`, `writtenOff` (all int ≥ 0). `totalUnits = sum of all four`. |
| GET    | /admin/assets/:id/maintenance-records?page=&limit=         | AdminGuard (ASSET_MANAGEMENT_READ) + Module: asset_management | Paginated maintenance history for an asset, newest first. |
| POST   | /admin/assets/:id/checkouts                                | AdminGuard (ASSET_MANAGEMENT_WRITE) + Module: asset_management | Check out an asset. Requires `checkedOutToMemberId` or `checkedOutToDepartmentId` (at least one). Optional: `expectedReturnAt`, `purpose`, `notes`. Returns `400` if asset already has an active checkout, or asset is `UNDER_MAINTENANCE`, `DECOMMISSIONED`, or `INACTIVE`. **On success:** email notification sent to the checked-out member (if member checkout) and/or all HOD/D_HOD leads of the target department (if department checkout) via the `asset-checkout-notification` template. Notifications are fire-and-forget. |
| PATCH  | /admin/assets/:id/checkouts/:checkoutId/return             | AdminGuard (ASSET_MANAGEMENT_WRITE) + Module: asset_management | Mark a checkout as returned. Optional body: `notes`. Returns `400` if already returned. **On success:** email notification sent to the original recipient (member or department HOD/D_HOD leads) confirming the return. A `RETURN_CONFIRMED` row is recorded in `asset_checkout_notifications`. |
| GET    | /admin/assets/:id/checkouts?page=&limit=                   | AdminGuard (ASSET_MANAGEMENT_READ) + Module: asset_management | Paginated checkout history for a specific asset, newest first. |

**Overdue checkout reminders (daily cron at 08:00):** `OverdueCheckoutScheduler` runs every day at 08:00 with a distributed Redis lock. It finds all active checkouts (`returnedAt IS NULL`) where `expectedReturnAt < now`. For each, it checks which day-thresholds defined in `ASSET_OVERDUE_NOTIFICATION_DAYS` have not yet been sent (tracked in the `asset_checkout_notifications` table with `type = OVERDUE_REMINDER`). Notifications go to the checked-out member and/or all HOD/D_HOD leads of the checked-out department. Set `ASSET_OVERDUE_NOTIFICATION_DAYS=` (empty) to disable all overdue reminders.

---

## 7. Check-In Flow

```
POST /attendances/checkin
  Body: { serviceSlotId, location? }
```

**Step-by-step:**

1. **Load slot** — fetches `ServiceSlot` with relations `event`, `config`, `config.defaultVenue`, `venueOverride`. Throws 404 if not found.

2. **Load member** — fetches the authenticated member with `workerProfile`.

3. **Assert active** — throws 400 if `member.status = INACTIVE`. Also throws if the member is a WORKER with
   `workerProfile.status = INACTIVE`.

4. **Resolve config** — `EventService.resolveSlotConfig(slot)` merges per-slot overrides over EventConfig values,
   including `format` (`slot.formatOverride ?? config.defaultFormat`). Throws 400 if no config, or if the resolved
   `format` is `IN_PERSON` with no resolvable venue.

5. **Worker location** — workers **must** provide `location` coordinates, but only when the resolved `format` is
   `IN_PERSON`. An `ONLINE`-resolved slot never requires location from anyone. Throws 400 if `location` is absent
   for a WORKER checking into an `IN_PERSON` slot.

6. **Duplicate check** — throws 400 if an attendance record already exists for `(member, event)`. One record per event, regardless of which slot the member enters.

7. **Validate window:**
    - Workers: window opens at `startTime + workerCheckinStartOffsetSeconds` (typically negative)
    - Members: window opens at `startTime + memberCheckinStartOffsetSeconds`
    - Both close at `startTime + checkinStopOffsetSeconds`

8. **Validate location** *(if location provided AND the resolved venue is non-null)*: Calculates Haversine distance
   between submitted coordinates and the venue's `latitude`/`longitude`. If distance exceeds
   `allowedDistanceInMeters` and enforcement is on for this tenant (`AttendanceSettingsService.isEnabled()` — see
   "Attendance Distance Check Setting" below; no longer a single global `ENFORCE_DISTANCE_CHECK=true` for every
   tenant), throws 400. Never runs for an `ONLINE`-resolved slot, since its resolved venue is null.

9. **Resolve status:**
    - Member → always `PRESENT`
    - Worker before late threshold → `PRESENT`
    - Worker at or after `startTime + workerLateOffsetSeconds` → `LATE`

10. **Save record** — creates `Attendance` with references to both `event` and `serviceSlot`, `roleAtCheckin` snapshot, and optional location.

---

## 8. Automated Absence Marking

A cron job runs every 5 minutes (`EVERY_5_MINUTES`).

**Logic:**

1. Finds all `Event` records where `attendanceMarked = false` AND `endTime < now` (the precise instant, not the date-only `endDate`) AND the event has at least one service slot. Served by a partial index (`IDX_events_end_time_unmarked`, `end_time WHERE attendance_marked = false`) so the query stays cheap regardless of how much event history a tenant accumulates — a plain index on `end_time` alone would match nearly every past event, not just the small rolling set still awaiting marking.
2. For each event:
    - Gets all **members** (ACTIVE, role=MEMBER) who have no `PRESENT` or `LATE` attendance record for the event → creates one `ABSENT` record per member referencing the event (`serviceSlot = null`).
    - Gets all **workers** (ACTIVE, role=WORKER) who have no `PRESENT` or `LATE` record for the event:
        - Checks `request_leave` table: if the worker has an APPROVED leave whose `date_from ≤ event.eventDate ≤ date_to` → creates `ON_LEAVE` record.
        - Otherwise → creates `ABSENT` record.
3. All absence records for the event are saved in a single DB transaction.
4. Sets `event.attendanceMarked = true` so the job skips it next run.
5. Dispatches a `post-event` job to the `follow-up` Bull queue for thank-you emails and optional online-confirm notifications (fire-and-forget, inside the loop but outside the transaction).

---

## 9. Role & Permission Matrix

The system has two distinct access dimensions:

1. **Church role** (`MemberRoleEnum` on the Member entity) — controls mobile-app routes: `MEMBER` or `WORKER`.
2. **Admin portal access** (`Admin` entity + `AdminRole` permissions) — controls admin web portal routes via
   `AdminGuard`.

A church worker can also have admin access. They pass `@Roles(WORKER)` routes via their church role and pass
`@UseGuards(AdminGuard)` routes via their Admin record.

### Mobile App (church role)

| Action                                          | MEMBER          | WORKER                       |
|-------------------------------------------------|-----------------|------------------------------|
| Sign up / login                                 | ✓               | ✓                            |
| View own profile                                | ✓               | ✓                            |
| Check in to service                             | ✓               | ✓                            |
| View own attendance                             | ✓               | ✓                            |
| View own class enrolments                       | ✓               | ✓                            |
| View announcement feed                          | ✓               | ✓                            |
| Worker dashboard                                | —               | ✓                            |
| Request leave                                   | —               | ✓                            |
| View own leave history                          | —               | ✓                            |
| View department leave                           | —               | ✓ (lead only)                |
| SS class actions (create/update/assign members) | —               | ✓ (SS-dept or class teacher) |
| SS session management                           | —               | ✓ (SS-dept or class teacher) |
| SS self-mark attendance                         | enrolled member | enrolled member              |
| SS bulk-mark / roster                           | —               | ✓ (SS-dept or class teacher) |
| CC child/guardian management                    | —               | ✓ (CC-dept worker)           |
| CC check-in / check-out / flag                  | —               | ✓ (CC-dept worker)           |
| Register first-timers                           | —               | ✓ (FOLLOW_UP-dept worker)    |
| View / update own follow-up tasks               | —               | ✓ (FOLLOW_UP-dept worker)    |
| Confirm online attendance                       | ✓               | ✓                            |
| Submit a prayer request / testimony             | ✓               | ✓                            |
| View public testimony feed                      | ✓               | ✓                            |
| Prayer team inbox (view/update request status)  | —               | ✓ (PRAYER-dept worker or Clergy) |
| Rate a service (own rating only)                | ✓               | ✓                            |
| Browse and sign up for volunteer opportunities  | ✓               | ✓                            |
| Browse, join, and leave fellowships             | ✓               | ✓                            |
| Record attendance for a fellowship (leader only) | ✓ (if leader) | ✓ (if leader)                |

### Admin Portal (`AdminGuard` + permission)

| Action                                        | Permission              |
|-----------------------------------------------|-------------------------|
| List / view members                           | `MEMBERS_READ`          |
| Create a member account directly              | `MEMBERS_WRITE`         |
| Promote / revoke workers, reset passwords     | `MEMBERS_WRITE`         |
| View events / configs                         | `EVENTS_READ`           |
| Create / update / delete events & configs     | `EVENTS_WRITE`          |
| Create / update / delete venues               | `VENUES_WRITE`          |
| View departments / leads                      | `DEPARTMENTS_READ`      |
| Create / update / delete departments & leads  | `DEPARTMENTS_WRITE`     |
| View all attendance, leaderboard              | `ATTENDANCE_READ`       |
| Correct an attendance record status           | `ATTENDANCE_WRITE`      |
| Mark/backfill attendance for a member (admin portal) | `ATTENDANCE_WRITE` |
| View all leave requests                       | `LEAVE_READ`            |
| Approve / reject leave                        | `LEAVE_WRITE`           |
| View classes & enrolments                     | `CLASSES_READ`          |
| Create / update / delete classes & enrolments | `CLASSES_WRITE`         |
| View announcements                            | `ANNOUNCEMENTS_READ`    |
| Create / update / delete announcements        | `ANNOUNCEMENTS_WRITE`   |
| View pastoral notes & analytics               | `NOTES_READ`            |
| Create / update / delete notes                | `NOTES_WRITE`           |
| Admin dashboard                               | `DASHBOARD_READ`        |
| SS delete class/session                       | `SUNDAY_SCHOOL_WRITE`   |
| CC age/class group CRUD + recompute           | `CHILDREN_CHURCH_WRITE` |
| CC slot-level check-in report                 | `CHILDREN_CHURCH_READ`  |
| View audit logs                               | `AUDIT_READ`            |
| View admin users & roles                      | `ADMIN_READ`            |
| Create / update / delete admin users & roles  | `ADMIN_WRITE`           |
| View own admin profile                        | *(any active admin)*    |
| View tithe batches, records, disputes         | `FINANCE_READ`          |
| Upload tithes, resolve disputes, approve/reject requests, attach proof | `FINANCE_WRITE` |
| View finance categories and requests          | `FINANCE_READ`          |
| View first-timers and follow-up tasks         | `FOLLOW_UP_READ`        |
| Register first-timers, reassign / bulk-update tasks | `FOLLOW_UP_WRITE` |
| View service attendance headcounts and trends       | `HEADCOUNT_READ`  |
| Record and correct physical attendance headcounts   | `HEADCOUNT_WRITE` |
| View prayer config, rules, roster, and meetings     | `PRAYER_READ`     |
| Manage prayer days, rules, assignments, and roster  | `PRAYER_WRITE`    |
| View prayer requests and testimonies                | `PRAYER_READ`     |
| Update a prayer request's status                    | `PRAYER_WRITE`    |
| View pregnancy prayer cases                         | `PRAYER_READ`     |
| Update a pregnancy prayer case's status              | `PRAYER_WRITE`    |
| View evangelism converts and follow-up history      | `EVANGELISM_READ` |
| Reassign convert follow-up, link convert to member  | `EVANGELISM_WRITE`|
| View sermon archive entries                          | `SERMON_READ`     |
| Create/edit/delete sermons, trigger "we're live"     | `SERMON_WRITE`    |
| View games, questions, sessions, and leaderboards    | `GAMES_READ`      |
| Create/edit games and questions, control live sessions | `GAMES_WRITE`   |
| View aggregate service ratings and anonymized comments | `SERVICE_RATING_READ` |
| Reveal identity behind a rating comment; delete/hide it | `SERVICE_RATING_MODERATE` |
| View volunteer opportunities and sign-up rosters      | `VOLUNTEER_READ`  |
| Create, edit, and cancel volunteer opportunities       | `VOLUNTEER_WRITE` |
| View small groups, rosters, and attendance history    | `SMALL_GROUP_READ`  |
| Create, edit, delete small groups; assign leaders; remove members | `SMALL_GROUP_WRITE` |

---

## 10. Environment Variables

All variables are validated by Joi at startup (`src/config/env.validation.ts`). Missing required variables crash the
process with a clear error before any HTTP traffic is accepted.

For the database backup/restore strategy (not an env var concern, but adjacent operational documentation that
didn't exist anywhere before), see [`docs/BACKUP_AND_RESTORE.md`](./BACKUP_AND_RESTORE.md).

**Graceful shutdown:** `main.ts` calls `app.enableShutdownHooks(['SIGTERM', 'SIGINT'])`, so in-flight requests are
allowed to finish and NestJS lifecycle hooks (e.g. closing the DB pool, Redis, Bull queues) run before the process
exits. Relevant when the orchestrator sends `SIGTERM` on deploy/scale-down — without this, connections would be cut
mid-request.

**Provider webhooks bypass the global JWT guard:** the YouTube WebSub
callbacks (`GET`/`POST /integrations/youtube/callback`), `POST /webhooks/billing`, and
`POST /webhooks/giving/:tenantId/:provider` are decorated `@Public()`. Providers never send a bearer token, so the
global `JwtAuthGuard` would 401 them before their own signature verification (HMAC / `X-Hub-Signature` /
`x-paystack-signature` / `verif-hash` / `x-korapay-signature` / `Stripe-Signature`) ever runs. `@Public()` only opts
a route out of JWT auth — it does not skip the handler's own signature check. All three are also excluded from
`TenantMiddleware` (§4.3) — same no-Host-header reasoning, though the giving webhook is the one exception with an
actual tenant identifier on the route itself (`:tenantId`), since unlike billing's single shared platform-wide
route, each tenant has their own BYOK giving-checkout credentials to resolve.

**Migration history was squashed (2026-07-31):** the 107 incremental migrations that had accumulated since the
project's first commit were replaced with a single `src/migrations/1790553600000-Baseline.ts`, generated via
`pg_dump --schema-only` (plus a `--data-only` dump of the static reference tables: `admin_roles`, `class_types`,
`prayer_programs`, `prayer_schedule_rules`) against a database that had every prior migration applied. The baseline
was verified to produce a byte-identical schema and seed dataset before the switch. The original files are kept in
`src/migrations/legacy/` for historical reference — that folder is outside the glob TypeORM scans
(`src/data-source.ts`'s `migrations` path is non-recursive), so they no longer run. This was a pre-production
one-time cleanup; per [`CLAUDE.md`](../CLAUDE.md), no migration is ever edited or re-squashed after it has shipped
to a real environment.

### Runtime

| Variable       | Default        | Description                                  |
|----------------|----------------|----------------------------------------------|
| `NODE_ENV`     | `development`  | `development` \| `production` \| `test`      |
| `PORT`         | `3000`         | HTTP port the server listens on              |
| `CORS_ORIGINS` | — *(required)* | Comma-separated extra CORS allowlist for origins outside `APP_BASE_DOMAIN` (marketing site, docs, ops tooling) — every subdomain of `APP_BASE_DOMAIN` is allowed dynamically regardless of this list, see "CORS origin validation" under Multi-Tenant Request Scoping |
| `APP_NAME`     | `discuva-api` | Service name used in logs and process identification |
| `APP_BASE_DOMAIN` | `localhost` | Suffix `TenantMiddleware` strips from the `Host` header to find a tenant's subdomain (§5 Multi-Tenant Request Scoping) — `*.localhost` resolves to `127.0.0.1` with no `/etc/hosts` changes, so the default works out of the box in dev |

### Branding (used in email templates and generated PDFs)

`PRODUCT_NAME` is genuinely platform-wide (the SaaS product name) and is always read from here. `CHURCH_NAME`/
`CHURCH_ADDRESS`/`CHURCH_TAGLINE`/`LOGO_URL`/`CURRENCY_CODE` are now only the **fallback** for a tenant that hasn't
set its own `name`/`address`/`tagline`/`logoUrl`/`currency` (per-field, not all-or-nothing) — see
`EmailQueueService.resolveBrandingData()`, `PdfService.resolveBranding()`, and `TenantCurrencyService.resolveCurrencyCode()`
under Utility/Infrastructure above. All three share the same `tenant-branding:${tenantId}` cache entry (one Tenant
lookup serves all three). `TenantCurrencyService` is also used by `FinanceRequestService` (Excel export header,
approve/reject/submitted notification emails) and `AnnualGivingStatementScheduler` — both `sendForMember()` (the
on-demand `POST /finance/me/giving-statement/send` path, which always has real CLS context from its HTTP caller)
and the nightly `@Cron` path, `run()`, which now resolves each active tenant's own currency correctly since
`sendAnnualStatements()` wraps `run()` in `forEachActiveTenant()` (see "Scheduler tenant iteration" under
Multi-Tenant Request Scoping) — every `@Cron` scheduler that touches tenant-scoped data now loops per tenant.
`CURRENCY_LOCALE` has no tenant-scoped equivalent (`Tenant` has no locale column) and stays a pure global default —
used by `PdfService` for number formatting and, unrelatedly, by `EventReminderService`/`TitheService` for date/time
formatting (those two never touched currency, so needed no change).

| Variable         | Default                                         | Description                                              |
|------------------|-------------------------------------------------|-----------------------------------------------------------|
| `PRODUCT_NAME`   | `Discuva`                                       | Product name shown in email subjects — always global      |
| `CHURCH_NAME`    | `RCCG Discovery Centre`                         | Fallback when a tenant's own `name` is unset               |
| `CHURCH_ADDRESS` | `62 Igi Olugbin Street, Bariga. Lagos, Nigeria` | Fallback when a tenant's own `address` is unset             |
| `CHURCH_TAGLINE` | `Destinies discovered, Champions raised`        | Fallback when a tenant's own `tagline` is unset — PDFs only |
| `LOGO_URL`       | Cloudinary default logo asset                   | Fallback when a tenant's own `logoUrl` is unset              |
| `CURRENCY_CODE`  | `NGN`                                           | Fallback when a tenant's own `currency` is unset            |
| `CURRENCY_LOCALE`| `en-NG`                                         | Always global — no tenant-scoped equivalent exists          |

### Error Tracking (Sentry)

Optional. `src/instrument.ts` is imported as the very first line of `main.ts` (before any other import — required
for the SDK's automatic instrumentation of `http`/`pg`/etc. to attach before those modules are first loaded
elsewhere in the dependency graph) and calls `Sentry.init()` only when both `SENTRY_DSN` is set and
`SENTRY_ENABLED` is `true`. `HttpExceptionFilter` (the single global exception filter) calls
`Sentry.captureException()` only for 5xx responses and genuinely unhandled (non-`HttpException`) errors — routine
4xx validation/auth errors are never reported, matching the filter's existing `error`/`warn` log-level split.
`Sentry.captureException()` is safe to call even when `init()` never ran (unset DSN) — it's a no-op, not a crash.

| Variable             | Default       | Description                                                                              |
|-----------------------|---------------|-------------------------------------------------------------------------------------------|
| `SENTRY_DSN`          | — *(unset)*   | Sentry project DSN. Unset disables error reporting entirely — the default for local dev.  |
| `SENTRY_ENABLED`      | `true`        | Separate kill switch on top of `SENTRY_DSN` — set to `false` to mute reporting without removing the DSN. |
| `SENTRY_ENVIRONMENT`  | `NODE_ENV`    | Sentry environment tag. Falls back to `NODE_ENV`, then `'development'`.                   |

### Database

| Variable             | Default        | Description                                                                  |
|----------------------|----------------|------------------------------------------------------------------------------|
| `DATABASE_HOST`      | — *(required)* | Postgres host                                                                |
| `DATABASE_PORT`      | `5432`         | Postgres port                                                                |
| `DATABASE_USER`      | — *(required)* | DB username                                                                  |
| `DATABASE_PASSWORD`  | — *(required)* | DB password                                                                  |
| `DATABASE_NAME`      | — *(required)* | DB name                                                                      |
| `DATABASE_SSL`       | `false`        | Enable SSL (`rejectUnauthorized=false`)                                      |
| `DATABASE_LOGGING`   | `false`        | Enable TypeORM query logging                                                 |
| `DATABASE_DEBUG`     | `false`        | Enable TypeORM debug-level query logging                                     |
| `DATABASE_POOL_SIZE` | `50`           | Max connections in the pool                                                  |
| `DATABASE_POOL_MIN`  | `10`           | Min idle connections kept alive                                              |
| `DATABASE_POOL`      | `transaction`  | Pool mode for PgBouncer/Supavisor: `transaction` \| `session` \| `statement` |
| `DATABASE_POOL_LOG`  | `false`        | Log pool connection acquire/release events                                   |

### JWT

| Variable                | Default                      | Description                                  |
|-------------------------|------------------------------|----------------------------------------------|
| `JWT_SECRET`            | — *(required, min 32 chars)* | Access token signing secret                  |
| `JWT_EXPIRY_IN`         | `1h`                         | Access token expiry (e.g. `1h`, `15m`, `7d`) |
| `REFRESH_JWT_SECRET`    | — *(required, min 32 chars)* | Refresh token signing secret                 |
| `REFRESH_JWT_EXPIRY_IN` | `7d`                         | Refresh token expiry                         |
| `SESSION_MAX_AGE_DAYS`  | `30`                         | Absolute session lifetime in days — refresh rejected after this regardless of rotation |
| `PLATFORM_ADMIN_JWT_SECRET` | — *(required, min 32 chars)* | Platform-admin token signing secret — deliberately separate from `JWT_SECRET` (§5 Platform Admin) |
| `PLATFORM_ADMIN_JWT_EXPIRY_IN` | `1h`                  | Platform-admin token expiry |
| `PLATFORM_ADMIN_REFRESH_JWT_SECRET` | — *(required, min 32 chars)* | Platform-admin refresh-token signing secret — separate from both `PLATFORM_ADMIN_JWT_SECRET` and the tenant-side `REFRESH_JWT_SECRET` |
| `PLATFORM_ADMIN_REFRESH_JWT_EXPIRY_IN` | `7d`        | Platform-admin refresh-token expiry — how long a session survives without a fresh password login |
| `CREDENTIALS_ENCRYPTION_KEY` | — *(required, min 32 chars)* | Encrypts tenant BYOK SMS/email provider credentials at rest (§5 Communication Providers) — rotating this makes existing encrypted credentials unreadable |

### Email

Set `EMAIL_PROVIDER` to choose the platform-wide default provider. This is only the fallback used when a tenant has
no BYOK config of its own (see Communication Providers) — a tenant can independently pick any of the five providers
below regardless of this setting. Only the variables for the active default provider are required at runtime;
`SmtpProvider` has no platform default at all (BYOK-only).

| Variable          | Default   | Description                                                           |
|-------------------|-----------|-----------------------------------------------------------------------|
| `EMAIL_PROVIDER`  | `gmail`   | Platform-default provider: `gmail` \| `resend`                       |
| `EMAIL_FROM`      | —         | Sender address used for all outbound email (overrides `EMAIL_USER`)   |

#### Gmail SMTP

| Variable         | Default | Description                                  |
|------------------|---------|----------------------------------------------|
| `EMAIL_HOST`     | —       | SMTP host                                    |
| `EMAIL_PORT`     | —       | SMTP port                                    |
| `EMAIL_SECURE`   | `false` | `true` for port 465, `false` for 587         |
| `EMAIL_SERVICE`  | —       | e.g. `gmail` (optional if HOST/PORT are set) |
| `EMAIL_USER`     | —       | SMTP username / sender address               |
| `EMAIL_PASSWORD` | —       | SMTP password / app password                 |

#### Resend

| Variable         | Default | Description                         |
|------------------|---------|-------------------------------------|
| `RESEND_API_KEY` | —       | Resend API key (`re_*…`)            |

#### Custom SMTP

No platform-default env vars — this provider is BYOK-only (`providerId: 'smtp'`) and throws if called without a
tenant's own `{host, port?, secure?, user, password}` credentials. Use this when a tenant wants to fully bring their
own mail server; use `gmail`'s BYOK `host` override instead when they just want a different domain on otherwise
platform-managed SMTP settings.

#### SendGrid

| Variable            | Default                    | Description                             |
|----------------------|-----------------------------|------------------------------------------|
| `SENDGRID_API_KEY`  | —                           | SendGrid API key, platform default        |
| `SENDGRID_BASE_URL` | `https://api.sendgrid.com` | Override for region failover / test doubles — matches every sibling provider's own `*_BASE_URL` convention |

#### Mailgun

| Variable            | Default                        | Description                                              |
|----------------------|---------------------------------|-----------------------------------------------------------|
| `MAILGUN_API_KEY`    | —                               | Mailgun API key, platform default                         |
| `MAILGUN_DOMAIN`     | —                               | Mailgun sending domain, platform default                  |
| `MAILGUN_BASE_URL`   | `https://api.mailgun.net/v3`   | Override for the EU region (`https://api.eu.mailgun.net/v3`) |

#### Email Category Gates

Each flag defaults to `true`. Set to `false` to suppress that category of emails (useful when on Resend's free tier to stay under the daily limit). Auth and admin emails are not gated.

| Variable                           | Default | Category suppressed           |
|------------------------------------|---------|-------------------------------|
| `EMAIL_ATTENDANCE_CHECKIN_ENABLED` | `true`  | Attendance check-in receipts  |
| `EMAIL_BIRTHDAY_ENABLED`           | `true`  | Birthday greetings            |
| `EMAIL_EVENT_REMINDER_ENABLED`     | `true`  | Event slot reminders          |
| `EMAIL_PRAYER_REMINDER_ENABLED`    | `true`  | Prayer roster reminders       |
| `EMAIL_FOLLOW_UP_ENABLED`          | `true`  | Follow-up task emails         |
| `EMAIL_ASSET_ALERTS_ENABLED`       | `true`  | Asset maintenance/overdue alerts |
| `EMAIL_GIVING_RECEIPT_ENABLED`     | `true`  | Tithe receipts and statements |
| `EMAIL_FINANCE_ALERTS_ENABLED`     | `true`  | Budget and pledge alerts      |
| `EMAIL_SESSION_REPORT_ENABLED`     | `true`  | Session completion reports    |
| `EMAIL_INCIDENT_REPORT_ENABLED`    | `true`  | Incident report notifications |
| `EMAIL_CHILDREN_CHURCH_ENABLED`    | `true`  | Children church pickup codes  |
| `EMAIL_LOGIN_ALERT_ENABLED`        | `true`  | New device login notifications |
| `EMAIL_PASTOR_FEEDBACK_ENABLED` | `true` | Weekly feedback reminders and pastor-response notifications |
| `EMAIL_ASSIGNMENT_REMINDER_ENABLED` | `true` | Assignment due-date reminders |
| `EMAIL_CLASS_SESSION_REMINDER_ENABLED` | `true` | Class next-session reminders |
| `EMAIL_FORM_SUBMISSION_ENABLED` | `true` | Admin notification on a new form submission (also requires the form's own `notifyOnSubmission` to be on) |

### Auth / OTP

| Variable                         | Default | Description                                  |
|----------------------------------|---------|----------------------------------------------|
| `OTP_TTL_SECONDS`                | `900`   | How long a reset OTP stays valid (15 min)    |
| `FORGOT_PASSWORD_MAX_ATTEMPTS`   | `3`     | Max OTP requests per rate-limit window       |
| `FORGOT_PASSWORD_WINDOW_SECONDS` | `3600`  | Rate-limit window for forgot-password (1 hr) |
| `LOGIN_MAX_ATTEMPTS`             | `5`     | Max failed login attempts before lockout     |
| `LOGIN_WINDOW_SECONDS`           | `900`   | Lockout window duration (15 min)             |
| `DEVICE_RESET_MAX_ATTEMPTS`      | `3`     | Max self-service device reset requests per window per email |
| `DEVICE_RESET_WINDOW_SECONDS`    | `86400` | Rate-limit window for device resets (24 hr)  |
| `OTP_VERIFY_MAX_ATTEMPTS`        | `5`     | Max wrong-code guesses per account against a live OTP (password reset, device reset, email change) before a `429` lockout for the rest of that OTP's `OTP_TTL_SECONDS` window — separate from `FORGOT_PASSWORD_MAX_ATTEMPTS`/`DEVICE_RESET_MAX_ATTEMPTS`, which only cap how often a *new* code can be requested |

### Global Rate Limiting

Applied to every endpoint via `ThrottlerGuard` as a global `APP_GUARD`. Returns HTTP 429 when exceeded. The
`GET /health` endpoint is exempt via `@SkipThrottle()`.

| Variable          | Default | Description                            |
|-------------------|---------|----------------------------------------|
| `THROTTLE_TTL_MS` | `60000` | Sliding window in milliseconds (1 min) |
| `THROTTLE_LIMIT`  | `100`   | Max requests per window per IP         |

### Redis

Used for two purposes: the distributed cache (`CacheService`) and the Bull email job queue (`EmailQueueService`).
Both use the same Redis server and the same logical database — Bull keys are namespaced `bull:*` and do not collide
with application cache keys.

| Variable         | Default     | Description                                                    |
|------------------|-------------|----------------------------------------------------------------|
| `REDIS_HOST`     | `localhost` | Redis server hostname                                          |
| `REDIS_PORT`     | `6379`      | Redis server port                                              |
| `REDIS_PASSWORD` | —           | Redis auth password (leave blank if no auth)                   |
| `REDIS_DB`       | `0`         | Logical database index (0–15)                                  |

### Timezone

| Variable   | Default        | Description                                                                                                                                                                                                                                                                    |
|------------|----------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `TIMEZONE` | `Africa/Lagos` | IANA timezone name. Drives two things: (1) every daily/specific-time `@Cron` job below runs in this timezone via its `timeZone` option, not the server process's own clock; (2) `DateService.startOfDay()`/`endOfDay()` (used by `getTotalCheckInsToday()`) compute day boundaries in this timezone. Does **not** change `process.env.TZ` — the server process itself still runs in whatever timezone its host/container is set to (UTC in this deployment); only these two call sites are timezone-aware. All "runs daily at HH:MM" times documented below are in this configured timezone. |

### Cache TTLs

| Variable                        | Default | Description                                                        |
|---------------------------------|---------|--------------------------------------------------------------------|
| `CACHE_TTL_REFERENCE_SECONDS`   | `300`   | TTL for reference data: departments, venues, event configs (5 min) |
| `CACHE_TTL_LEADERBOARD_SECONDS` | `90`    | TTL for attendance leaderboard                                     |

### Birthday Wishes

| Variable           | Default | Description                                        |
|--------------------|---------|----------------------------------------------------|
| `WISH_DAILY_LIMIT` | `20`    | Max birthday wishes a single user can send per day |

### Attendance / Check-In

| Variable                      | Default | Description                                                        |
|-------------------------------|---------|--------------------------------------------------------------------|
| `ENFORCE_DISTANCE_CHECK`      | `false` | No longer read directly by AttendanceService — now only the fallback-of-the-fallback for `PlatformSettingKey.ENFORCE_DISTANCE_CHECK_DEFAULT` (see "Attendance Distance Check Setting" below) when no `PlatformSetting` row exists yet either. Kept as a real env var (not removed) specifically so an environment that already has it set isn't silently reset to `false` the moment this shipped. |
| `ONLINE_CHECKIN_WINDOW_HOURS` | `3`     | Hours after online-confirm emails are sent during which members can confirm online attendance |
| `FOLLOW_UP_DUE_DAYS`          | `3`     | Days from task creation before a follow-up task is considered overdue (sets `dueDate`) |
| `FOLLOW_UP_STALE_DAYS`        | `7`     | Days of inactivity before an open task is flagged stale (daily cron + stale endpoint)  |

### Service Programme

| Variable                                | Default | Description                                                                                  |
|------------------------------------------|---------|------------------------------------------------------------------------------------------------|
| `SERVICE_SLOT_CAUTION_THRESHOLD_RATIO`   | `0.25`  | Fraction of a slot's allocated time remaining at which the presentation view switches to the "Wrapping Up" caution state. Resolved server-side and returned as `cautionThresholdRatio` on `GET /service-session/:code/state` — never duplicated as frontend config. |

### Default Seed Data (applied on first boot)

| Variable                                   | Default                 | Description                                   |
|--------------------------------------------|-------------------------|-----------------------------------------------|
| `DEFAULT_ADMIN_EMAIL`                      | —                       | Email for the seeded default admin account    |
| `DEFAULT_ADMIN_PASSWORD`                   | —                       | Password for the seeded default admin account |
| `DEFAULT_PLATFORM_ADMIN_EMAIL`             | —                       | Email for the seeded first platform admin (`npm run seed:platform-admin`) |
| `DEFAULT_PLATFORM_ADMIN_PASSWORD_HASH`     | —                       | Argon2 hash for the seeded first platform admin (generate via `npm run hash:password`) |

**Removed:** `DEFAULT_VENUE_NAME`/`DEFAULT_VENUE_ADDRESS`/`DEFAULT_VENUE_LATITUDE`/`DEFAULT_VENUE_LONGITUDE`/
`DEFAULT_EVENT_CONFIG_NAME`/`DEFAULT_EVENT_ALLOWED_DISTANCE_IN_METERS`/`WORKER_CHECKIN_START_OFFSET_SECONDS`/
`WORKER_LATE_OFFSET_SECONDS`/`MEMBER_CHECKIN_START_OFFSET_SECONDS`/`CHECKIN_STOP_OFFSET_SECONDS` — these only ever
fed `DefaultEventConfigSeed`, a boot-time seed that ran outside any tenant CLS context and wrote into orphaned
`public.venues`/`public.event_config` rows no live tenant schema ever reads (each tenant gets its own `venues`/
`event_config` rows via `TenantSchemaGenesis`/normal admin setup instead). Confirmed dead — deleted along with the
seed service rather than fixed. The four checkin-offset names now live only as columns on the tenant-scoped
`EventConfig` entity (`workerCheckinStartOffsetSeconds` etc.), editable per-tenant via `EventConfigController`.

### Cloudinary (file uploads)

Used for finance request attachments and payment proofs.

| Variable                  | Default        | Description                     |
|---------------------------|----------------|---------------------------------|
| `CLOUDINARY_CLOUD_NAME`      | — *(required)* | Cloudinary account cloud name                                              |
| `CLOUDINARY_API_KEY`         | — *(required)* | Cloudinary API key                                                         |
| `CLOUDINARY_API_SECRET`      | — *(required)* | Cloudinary API secret                                                      |
| `MAX_FILE_UPLOAD_BYTES`      | `5242880`      | Fallback default for routes with no more specific category — incident report photos, member bulk-import spreadsheets |

Logo/appearance, avatar, class-material, finance-proof, form-attachment, and page-image upload limits are **not**
env vars — they're platform-admin-configurable via `PlatformSettingKey.MAX_LOGO_UPLOAD_MB`/`MAX_AVATAR_UPLOAD_MB`/
`MAX_CLASS_MATERIAL_UPLOAD_MB`/`MAX_FINANCE_PROOF_UPLOAD_MB`/`MAX_FORM_ATTACHMENT_UPLOAD_MB`/
`MAX_PAGE_IMAGE_UPLOAD_MB` (see "Platform Settings" under the platform-admin
section) and enforced via `DynamicLimitedFileInterceptor`, which rewrites Multer's generic "File too large" error
into `"The uploaded file exceeds the maximum allowed size of {N} MB..."` using the *live* limit for that route —
not a guess. `HttpExceptionFilter`'s own `PayloadTooLargeException` handling (using `MAX_FILE_UPLOAD_BYTES`) is a
fallback only, for the handful of upload routes not wrapped in `LimitedFileInterceptor`/`DynamicLimitedFileInterceptor`
at all (e.g. `finance-admin`/`tithe-admin`/`reconciliation` attachment routes, which currently have no configured
size limit).
| `TITHE_PROOF_EXPIRY_DAYS`    | `90`           | Days after which a tithe payment proof is purged from Cloudinary and DB    |
| `ASSET_OVERDUE_NOTIFICATION_DAYS` | `1,3,7`   | Comma-separated day thresholds for overdue checkout reminders. Leave empty to disable. |

### Web Push (VAPID)

Generate keys once with `npx web-push generate-vapid-keys` and store permanently.

| Variable            | Default        | Description                                                                 |
|---------------------|----------------|-----------------------------------------------------------------------------|
| `VAPID_PUBLIC_KEY`  | — *(required)* | VAPID public key — also exposed to the PWA frontend as `NEXT_PUBLIC_VAPID_PUBLIC_KEY` |
| `VAPID_PRIVATE_KEY` | — *(required)* | VAPID private key — backend only, never exposed to clients                  |
| `VAPID_SUBJECT`     | — *(required)* | VAPID subject — must be a `mailto:` or `https://` URI (e.g. `mailto:admin@example.com`) |

### App URLs (embedded in emails)

| Variable                      | Description                                                                                 |
|-------------------------------|---------------------------------------------------------------------------------------------|
| `LOGIN_URL`                   | Mobile app login URL — embedded in member/worker welcome and notification emails (required) |
| `ADMIN_LOGIN_URL`             | Admin portal login URL — embedded in the admin welcome email on role grant (required)       |
| `SUPPORT_FORM_URL`            | Support contact form URL                                                                    |
| `EXPLAINER_VIDEO_ANDROID_URL` | Android onboarding video URL                                                                |
| `EXPLAINER_VIDEO_IOS_URL`     | iOS onboarding video URL                                                                    |

### Bull Board (optional)

| Variable             | Default | Description                                                                                        |
|----------------------|---------|----------------------------------------------------------------------------------------------------|
| `BULL_BOARD_USER`    | —       | Username for the Bull Board queue dashboard at `/queues`. If unset, dashboard is not mounted.      |
| `BULL_BOARD_PASSWORD`| —       | Password for the Bull Board queue dashboard. Required alongside `BULL_BOARD_USER`.                 |

### SMS

Pure BYOK (see SMS Module above) — no platform-default credentials for any SMS vendor, so there's nothing here for
Twilio at all (its `accountSid`/`authToken`/`fromNumber` only ever exist as a tenant's own encrypted BYOK config).
Termii's API host is the one exception: infrastructure, not a secret, so it stays env-driven.

| Variable            | Default                        | Description                                                    |
|---------------------|---------------------------------|------------------------------------------------------------------|
| `TERMII_BASE_URL`   | `https://api.ng.termii.com`     | Termii API base URL — same for every tenant's Termii account, BYOK or not |

### YouTube Live Detection (optional, platform-wide only)

Channel id and Data API key are **not** set here — they're per-tenant, via `PUT /v1/youtube-integration` (see
"YouTube Live Detection" above), with no platform-wide fallback for the key. Both below are platform-wide and both
optional — leave unset to skip WebSub subscription entirely and rely on the Sermon Module's manual "Announce Live"
trigger instead.

| Variable                       | Default          | Description                                                                 |
|---------------------------------|------------------|--------------------------------------------------------------------------|
| `YOUTUBE_WEBSUB_CALLBACK_URL`  | — *(optional)*   | Publicly reachable URL for `GET/POST integrations/youtube/callback` (must be internet-facing for Google's hub to reach it) — one physical endpoint shared by every tenant |
| `YOUTUBE_WEBSUB_SECRET`        | — *(optional)*   | Shared HMAC secret sent as `hub.secret` on subscribe; the hub signs every notification with it (`X-Hub-Signature`), which the callback verifies. Required alongside the callback URL — without it, `subscribe()` never registers a live subscription and the callback rejects everything it receives. |
| `PUBSUBHUBBUB_URL`             | `https://pubsubhubbub.appspot.com/subscribe` | Google's PubSubHubbub hub endpoint `YoutubeSubscriptionService` posts subscribe/unsubscribe requests to |

### Billing: Paystack / Flutterwave (optional, platform-wide)

All optional — a provider whose secret key isn't set simply can't be selected as `?provider=` on a checkout call
(`PaymentProviderRegistryService` throws a clean `400`, not a crash). Platform-wide, not tenant BYOK — see "Billing
& Checkout" above for why.

| Variable                     | Default                            | Description |
|-------------------------------|-------------------------------------|--------------|
| `PAYSTACK_SECRET_KEY`         | — *(optional)*                     | Paystack secret key, used both for API calls (`Authorization: Bearer`) and to compute the HMAC-SHA512 webhook signature |
| `PAYSTACK_BASE_URL`           | `https://api.paystack.co`          | Paystack API base URL |
| `FLUTTERWAVE_SECRET_KEY`      | — *(optional)*                     | Flutterwave secret key, used for API calls |
| `FLUTTERWAVE_SECRET_HASH`     | — *(optional)*                     | Shared secret configured in the Flutterwave dashboard's webhook settings — compared verbatim against the `verif-hash` header, not an HMAC key |
| `FLUTTERWAVE_BASE_URL`        | `https://api.flutterwave.com/v3`   | Flutterwave API base URL |
| `DEFAULT_PAYMENT_PROVIDER`    | `paystack`                         | Which provider a checkout call uses when it doesn't specify `?provider=` explicitly |
| `SUBSCRIPTION_PERIOD_DAYS`    | `30`                                | Renewal period `CheckoutService.applyChargeSucceeded()` extends `currentPeriodEnd` by per successful charge, for a `billingInterval: 'monthly'` plan |
| `ANNUAL_SUBSCRIPTION_PERIOD_DAYS` | `365`                            | Same, for a `billingInterval: 'annual'` plan |
| `GRACE_PERIOD_DAYS`           | `7`                                 | How long `SubscriptionLapseScheduler` keeps a `PAST_DUE` subscription's features before downgrading to Free |

---

## 11. Enum Reference

### MemberRoleEnum

`MEMBER` · `WORKER`

Admin portal access is not a member role — it is managed via the `Admin` entity and `AdminRole`.

### AdminPermission

Granular permissions assigned to `AdminRole` records:

`members:read` · `members:write` · `events:read` · `events:write` · `venues:read` · `venues:write` ·
`departments:read` · `departments:write` · `attendance:read` · `attendance:write` · `leave:read` · `leave:write` · `classes:read` ·
`classes:write` · `announcements:read` · `announcements:write` · `dashboard:read` ·
`sunday_school:read` · `sunday_school:write` · `children_church:read` · `children_church:write` · `admin:read` ·
`admin:write` · `audit:read` · `finance:read` · `finance:write` · `follow_up:read` · `follow_up:write` ·
`service_programme:read` · `service_programme:write` · `headcount:read` · `headcount:write` ·
`prayer:read` · `prayer:write` · `sms:read` · `sms:send` · `sermon:read` · `sermon:write`

`GET /enums` returns these as both a flat `adminPermissions` list (value + label) and a grouped `adminPermissionGroups` list (group name + permissions with value, label, and description) — use the grouped form to render the permission assignment UI. `sms:read`/`sms:send` are grouped under "SMS Messaging".

### MemberImportJobStatus

`READY_FOR_REVIEW` · `COMMITTED`

### MemberImportRowStatus

`PENDING` · `CREATED` · `FAILED`

### MemberStatusEnum / WorkerStatusEnum

`ACTIVE` · `INACTIVE`

### GenderEnum

`MALE` · `FEMALE`

### MaritalStatusEnum

`SINGLE` · `MARRIED` · `DIVORCED` · `WIDOWED`

### AttendanceStatusEnum

`PRESENT` · `LATE` *(workers only)* · `ABSENT` · `ON_LEAVE` *(workers only)* · `ATTENDED_ONLINE`

### LeaveStatusEnum

`PENDING` · `APPROVED` · `REJECTED`

### ChurchClassTypeEnum

`BELIEVERS` · `BAPTISMAL` · `WORKERS_IN_TRAINING` · `BIBLE_COLLEGE` · `SCHOOL_OF_DISCIPLESHIP`

**Legacy — not used at runtime.** Class types are now admin-creatable via the `ClassType` entity (see Data Models above); this enum only documents the 5 values the `AddClassTypesTable` migration seeded as rows, for reference when reading that migration.

### EnrollmentStatusEnum

`IN_PROGRESS` · `COMPLETED` · `CANCELLED`

### AnnouncementAudienceEnum

`ALL` · `WORKERS_ONLY` · `MEMBERS_ONLY` · `DEPARTMENT` · `INDIVIDUAL` · `GROUP` · `CLASS`

### NoteTypeEnum *(path param values)*

`child_naming` · `child_dedication` · `marriage` · `baptism`

### EventRecurrencePatternEnum

`daily` · `weekly` · `monthly`

### OrderBy (Events)

`eventDate` · `createdAt` · `updatedAt`

### DepartmentCapability

**A fixed, validated enum — not free text.** `Department.capabilities: DepartmentCapability[]`;
`CreateDepartmentDto`/`UpdateDepartmentDto` validate every entry with `@IsEnum(DepartmentCapability, { each: true })`.
A department can hold any combination of these; each is named after the action it unlocks rather than after a
department, so it stays meaningful regardless of what a given church calls the department that holds it.

`MANAGE_SUNDAY_SCHOOL` · `MANAGE_CHILDREN_CHURCH` · `MANAGE_PRAYER_REQUESTS` · `MANAGE_EVANGELISM_CONVERTS` · `MANAGE_FOLLOW_UP` · `FRONT_DESK_OPERATIONS`

### SundaySchoolAttendanceStatus

`PRESENT` · `ABSENT` · `EXCUSED`

### GuardianRelationshipEnum

`MOTHER` · `FATHER` · `GRANDPARENT` · `SIBLING` · `UNCLE` · `AUNT` · `FAMILY_FRIEND` · `OTHER`

### ChildCheckInStatusEnum

`CHECKED_IN` · `CHECKED_OUT` · `FLAGGED`

### ReminderIntervalPresetEnum

`15m` (15 min) · `30m` (30 min) · `1h` (1 hour) · `3h` (3 hours) · `24h` (24 hours) · `48h` (48 hours)

### TitheBatchStatus

`PENDING` · `PROCESSING` · `COMPLETED` · `FAILED`

### TitheUnmatchedStatus

`PENDING` · `MATCHED` · `DISMISSED`

### TitheDisputeStatus

`PENDING` · `CONFIRMED_VALID` · `REJECTED`

### FinanceRequestStatus

`PENDING` · `APPROVED` · `REJECTED`

### FirstTimerSourceEnum

`WALK_IN` · `ONLINE` · `REFERRAL`

### FollowUpTaskTypeEnum

`FIRST_TIMER` · `ONLINE_NO_RESPONSE` · `MANUAL`

### FollowUpTaskStatusEnum

`PENDING` · `IN_PROGRESS` · `COMPLETED` · `UNREACHABLE`

### FollowUpOutcomeEnum

`JOINED` · `DECLINED` · `NO_ANSWER` · `PRAYED_WITH`

### ServiceProgrammeStatusEnum

`DRAFT` · `LIVE` · `COMPLETED`

### ServiceSlotTypeEnum

`SPEAKER` · `WORSHIP` · `PRAYER` · `OFFERING` · `ANNOUNCEMENT` · `BREAK`

### ServiceSessionStatusEnum

`LIVE` · `COMPLETED`

### ServiceSessionSlotStatusEnum

`PENDING` · `IN_PROGRESS` · `COMPLETED` · `SKIPPED`

### ServicePauseReasonEnum

`TECHNICAL_ISSUE` · `ANNOUNCEMENT` · `BREAK_INTERVAL` · `UNPLANNED_DELAY` · `OTHER`

### ServiceActionRoleEnum

`ADMIN` · `WORKER` · `PUBLIC_LINK` (action performed via the public Programme Manager share link, no authenticated member)

### IncidentStatusEnum

`OPEN` · `IN_PROGRESS` · `RESOLVED`

### AssetStatusEnum

`ACTIVE` · `INACTIVE` · `UNDER_MAINTENANCE` · `DECOMMISSIONED`

### MaintenanceFrequencyUnitEnum

`DAYS` · `WEEKS` · `MONTHS`

### MaintenanceRecordTypeEnum

`SCHEDULED` · `UNPLANNED`

### MaintenanceCompletionStatusEnum

`IN_PROGRESS` · `COMPLETED`

### AssetConditionEnum

`GOOD` · `FAIR` · `POOR`

### PrayerDayMode

`PHYSICAL` · `VIRTUAL`

### PrayerRuleType

`ROLE_FREQUENCY` · `MIN_LEADERS_PER_MEETING` · `MAX_PER_MEETING`

### PrayerAssignmentType

`FIXED` · `SELF_SELECTED` · `AUTO_ASSIGNED`

### PrayerRosterStatus

`SCHEDULED` · `RESCHEDULED`

### PrayerMeetingStatus

`SCHEDULED` · `COMPLETED` · `CANCELLED`

### PrayerWindowStatus

`PENDING` · `OPEN` · `CLOSED`

### RentalMemberCategory

`PUBLIC` · `MEMBER` · `WORKER` · `LEADER`

Determines which pricing tier is applied. Resolved at booking time: LEADER if a `DepartmentLead` record exists for the member, WORKER if `role = WORKER`, otherwise MEMBER.

### RentalDiscountType

`PERCENTAGE` · `FLAT`

### RentalDiscountSource

`NONE` · `TIER` · `OVERRIDE`

Stored as a snapshot on the booking to record how the discount was determined.

### RentalBookingStatus

`PENDING` · `CONFIRMED` · `IN_PROGRESS` · `COMPLETED` · `CANCELLED` · `REJECTED`

Transitions: PENDING → CONFIRMED (admin) or CANCELLED/REJECTED; CONFIRMED → IN_PROGRESS (scheduler); IN_PROGRESS → COMPLETED (scheduler).

### RentalPaymentType

`SERVICE_FEE` · `CAUTION`

### RentalPaymentStatus

`PENDING` · `PAID` · `REFUNDED` (REFUNDED only valid for CAUTION payments)

### LivePlatformEnum

`YOUTUBE` · `MIXLR`

Used by the Sermon Module's manual "Announce Live" trigger to pick the default announcement title.

### GameStatusEnum

`DRAFT` · `LIVE_SESSION_ACTIVE` · `ARCHIVED` (not yet reachable via any endpoint)

Informational, not a gate — a `DRAFT` game can always be edited even if `LIVE_SESSION_ACTIVE` from a past session
that hasn't been ended yet.

### GameSessionStatusEnum

`SCHEDULED` (not yet reachable — sessions start directly into LIVE) · `LIVE` · `ENDED`

### ReminderSettingKey

`pledge_reminder` · `budget_alert` · `follow_up_stale` · `asset_maintenance` · `asset_warranty` · `vehicle_expiry` ·
`assignment_due` · `class_session`

See "Reminder Settings Module" above — keys a tenant's per-category reminder timing/enabled settings
(`GET/PATCH /admin/reminder-settings`). Distinct from `EmailCategory` (a separate, coarser enum — see below).

### EmailCategory

`ATTENDANCE_CHECKIN` · `BIRTHDAY` · `EVENT_REMINDER` · `PRAYER_REMINDER` · `FOLLOW_UP` · `ASSET_ALERTS` ·
`GIVING_RECEIPT` · `FINANCE_ALERTS` · `SESSION_REPORT` · `INCIDENT_REPORT` · `CHILDREN_CHURCH` · `LOGIN_ALERT` ·
`SERVICE_PROGRAMME_ASSIGNMENT` · `PASTOR_FEEDBACK` · `MEMBERSHIP_ANNIVERSARY` · `ASSIGNMENT_REMINDER` ·
`CLASS_SESSION_REMINDER`

See "Email Category Settings Module" above — every category-tagged email checks a global env-flag gate, then a
per-tenant `EmailCategorySettingsService` gate, before `EmailQueueService.queueEmail` enqueues the job
(`GET/PATCH /admin/email-category-settings`). Emails sent with no category (OTP, password reset, account-locked —
security-critical auth flows) always send regardless, by design.
