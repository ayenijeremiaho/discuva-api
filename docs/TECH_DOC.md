# Discovery Hub — Technical Documentation

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
@nestjs/throttler · Handlebars · DOMPurify · ExcelJS · PDFKit · Cloudinary · Nodemailer (Gmail SMTP) · Resend SDK

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
| pastor                | Pastor \| null    | OneToOne, null unless the member carries a pastoral designation — see Pastor table below                  |
| attendances           | Attendance[]      | OneToMany                                                                                                 |
| enrollments           | ClassEnrollment[] | OneToMany                                                                                                 |

**Profile picture:** self-service via `POST/DELETE members/me/photo` (`JwtAuthGuard`), uploaded to Cloudinary folder `profile-pictures` (3MB limit, image mimetypes only). Replacing a photo uploads the new one first, saves it, then deletes the previous Cloudinary asset by `photoPublicId` (fire-and-forget). Admins can also clear a member's photo via `DELETE members/:id/photo` (`AdminGuard` + `MEMBERS_WRITE`) for moderation. `GET /birthday/today`'s `BirthdayCelebrant` shape also carries `photoUrl`, alongside the existing role/department/pastorType disambiguation for same-named celebrants (see Birthday Module).

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

### Pastor

A pastoral designation on a member, independent of `WorkerProfile`/`Department` — a pastor may have no department
(e.g. a Lead Pastor) or may separately also be an HOD. At most one row per member (`OneToOne` on `member`).

| Field  | Type           | Notes                                              |
|--------|----------------|-----------------------------------------------------|
| id     | UUID           | PK                                                   |
| member | Member         | OneToOne, `onDelete: CASCADE`                        |
| type   | PastorTypeEnum | LEAD \| PARISH \| ASSOCIATE                          |

Managed via `POST/PATCH/DELETE /members/:id/pastor` (see Member Module). Surfaced on `MemberDto` as
`pastorType: PastorTypeEnum | null`, computed from the `pastor` relation.

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
| eventDate         | Date (date only) | Derived, not user-entered: the earliest `serviceSlots[].startTime` (UTC date). Recomputed whenever slots are (re)created via `EventService`. |
| endDate           | Date (date only) | Derived: the latest `serviceSlots[].endTime` (UTC date). Recomputed alongside `eventDate`.               |
| attendanceMarked           | boolean          | Set to `true` by the cron job after absence records are created. Guards against double-processing.      |
| onlineAttendanceEnabled    | boolean          | Default `false`. When `true`, absent members receive an online-confirm email after the event ends.      |
| onlineNotificationSentAt   | timestamptz \| null | Set when the online-confirm emails are dispatched. Used to calculate the confirmation window.        |
| thankYouSentAt             | timestamptz \| null | Set after thank-you emails are queued for the event; guards against resending on re-trigger.        |
| recurringEventId           | UUID             | Groups events in a recurring series                                                                     |
| serviceSlots      | ServiceSlot[]    | OneToMany — at least one slot is required at creation                                                   |
| attendances       | Attendance[]     | OneToMany                                                                                               |

### Venue

A named, reusable physical location. Referenced by `EventConfig.defaultVenue` and optionally overridden per slot via
`ServiceSlot.venueOverride`.

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
|-------------------|-------------|-------------------------------------------------------------------|
| id                | UUID        | PK                                                                |
| event             | Event       | ManyToOne                                                         |
| name              | string      | Default: "Service"                                                |
| startTime         | timestamptz |                                                                   |
| endTime           | timestamptz |                                                                   |
| config            | EventConfig | ManyToOne, nullable                                               |
| venueOverride     | Venue       | ManyToOne, nullable — overrides config.defaultVenue for this slot |
| *Override columns | int         | Per-slot overrides that take priority over EventConfig            |

Override columns: `workerCheckinStartOverride`, `workerLateOverride`, `memberCheckinStartOverride`,
`checkinStopOverride`, `allowedDistanceOverride`

**effectiveVenue:** computed as `slot.venueOverride ?? slot.config.defaultVenue`. Throws 400 if neither is set.

### EventConfig

A reusable timing template assigned to service slots. Venue is now a first-class relation rather than raw lat/lon.

| Field                           | Type   | Description                                                                                 |
|---------------------------------|--------|---------------------------------------------------------------------------------------------|
| name                            | string | Unique                                                                                      |
| defaultVenue                    | Venue  | ManyToOne, NOT NULL — the venue used by all slots referencing this config unless overridden |
| workerCheckinStartOffsetSeconds | int    | Seconds relative to `startTime` when workers can start checking in. Negative = before start |
| workerLateOffsetSeconds         | int    | Seconds after `startTime` after which workers are LATE                                      |
| memberCheckinStartOffsetSeconds | int    | When members can start checking in                                                          |
| checkinStopOffsetSeconds        | int    | When check-in closes for everyone                                                           |
| allowedDistanceInMeters         | int    | Max distance from effectiveVenue for location validation                                    |

**Constraint:** `workerLateOffset > workerCheckinStartOffset` and `checkinStopOffset > workerLateOffset`

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
| key            | DepartmentKeyEnum \| null — access-control category for department-gated modules; not unique (multiple departments can share the same key, e.g. MEDIA) |
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
| respondedByPastor      | ManyToOne → Pastor, nullable (`onDelete: SET NULL`)                                              |
| respondedByPastorName  | Snapshotted at response time, same rationale as `submittedByName`                                |
| pastorResponse         | text, nullable                                                                                   |
| pastorRespondedAt      | timestamp, nullable                                                                              |

**Unique constraint:** (department, weekOf) — one submission per department per week. Editing after submission is a `PATCH` on the same row; there's no draft/submitted status or read-receipt lock.

**Ownership check (submission/edit):** the caller must be an HOD or Assistant HOD (`DepartmentLead` row) of the target department — checked via `DepartmentLead.exists({ workerProfile, department })`, mirroring the `isHod` check in `auth.service.ts:getProfile()`. Not gated by `RolesGuard`/`@Roles(WORKER)` alone, since being a worker isn't sufficient — must specifically lead that department.

**Ownership check (pastor response):** the caller must have a `Pastor` record (`pastorRepo.exists({ member: { id } })`, any `PastorTypeEnum`). Available via both the admin portal (an `Admin` account whose linked `Member` has a `Pastor` record) and the mobile app (any member with a `Pastor` record).

### PrayerRequest

A private prayer request submitted by any member/worker — visible only to the submitter, Prayer department workers, and pastors.

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
| facilitator         | ManyToOne → Member (nullable)                                  |
| startDate / endDate | date strings                                                   |

**Delete guard:** Deleting a class is blocked if any enrolment record exists (any status — IN_PROGRESS, COMPLETED, or CANCELLED). This preserves historical enrolment data. A class with enrolment history cannot be deleted.

### ClassType

Replaces the old hardcoded `ChurchClassTypeEnum` — class types are now admin-creatable and admin-editable, not a fixed set. `ChurchClassTypeEnum` still exists in code purely as a reference for the migration's seed data; it's not used at runtime anymore (removed from the generic `/enums` endpoint's `churchClassTypes` key for the same reason — it no longer reflects reality once admins add their own types).

| Field           | Notes                                                                 |
|-----------------|------------------------------------------------------------------------|
| name            | unique                                                                  |
| description     | nullable text                                                          |
| isActive        | boolean, default true — deactivated types are hidden from class-create pickers but existing classes keep referencing them (RESTRICT prevents hard-deleting a type still in use) |
| nextClassType   | ManyToOne → ClassType, nullable, self-referencing (`onDelete: SET NULL`) |

**Promotion chain:** `nextClassType` is a self-referencing pointer, not a `level` number — a class type either points to the next type in its progression or is `null` (standalone, no promotion). The chain is entirely admin-configured via the ClassType CRUD endpoints; nothing is pre-wired by the migration (the 5 seeded legacy types — Believers' Class, Baptismal Class, Workers in Training, Bible College, School of Discipleship — all seed with `nextClassType = null`). Writes are validated server-side against self-reference and cycles (walks the proposed chain up to 20 hops looking for a loop back to the type being edited) since a DB FK can't express "no cycles."

### ClassEnrollment

| Field                     | Notes                                 |
|---------------------------|---------------------------------------|
| member                    | ManyToOne → Member                    |
| churchClass               | ManyToOne → ChurchClass               |
| status                    | IN_PROGRESS \| COMPLETED \| CANCELLED |
| enrolledAt                | auto timestamp                        |
| completedAt / cancelledAt | set when status changes               |
| certificateIssued         | boolean, default false                |
| certificateIssuedAt       | timestamptz, nullable                 |
| certificateNumber         | varchar, nullable                     |

**Unique constraint:** (member, churchClass)

**Level promotion:** When an enrollment is `COMPLETED` and its class's `classType.nextClassType` is set, `GET classes/enrollments/:enrollmentId/promotion-candidate` reports eligibility plus any currently-open (`ACTIVE`) classes of that next type. Promotion itself is a separate, explicit, admin-confirmed action — `POST classes/enrollments/:enrollmentId/promote` (body: `targetClassId`) — mirroring the `promoteToWorker` pattern (transaction + `CLASS_LEVEL_PROMOTED` audit log entry + a `class-level-promotion` templated email to the member). Nothing is auto-enrolled on completion; standalone class types (no `nextClassType`) simply have no promotion affordance.

**Certificates:** Once an enrollment is `COMPLETED`, `PATCH classes/enrollments/:enrollmentId/certificate` (body: optional `certificateNumber`) marks it as having received a certificate — sets `certificateIssued = true`, `certificateIssuedAt = now()`, and stores `certificateNumber` if given. This is a manual, admin-confirmed record only (no file upload); it logs `CLASS_CERTIFICATE_ISSUED`.

### Announcement

| Field        | Notes                                                                     |
|--------------|----------------------------------------------------------------------------|
| audience     | ALL \| WORKERS_ONLY \| MEMBERS_ONLY \| DEPARTMENT \| INDIVIDUAL \| GROUP   |
| department   | ManyToOne → Department (required when audience=DEPARTMENT)                 |
| targetMember | ManyToOne → Member, nullable (required when audience=INDIVIDUAL)           |
| group        | ManyToOne → Group, nullable (required when audience=GROUP); triggers a push notification to every group member on create |
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
| provider       | varchar     | `gmail` or `resend` — which email provider delivered (or attempted) the message |
| createdAt      | timestamptz | When the terminal outcome was recorded                                   |

**Written by:** `@OnQueueCompleted` (status = `sent`) and `@OnQueueFailed` (status = `failed`, only on the final
attempt after all retries are exhausted). Transient failures that Bull subsequently retries do **not** produce a log
row — only the final outcome is recorded.

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
`ASSET_CREATED` · `ASSET_UPDATED` · `ASSET_MAINTENANCE_SCHEDULED` · `ASSET_MAINTENANCE_LOGGED` · `ASSET_INVENTORY_UPDATED`

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

**Duplicate detection:** `(memberId, paymentDate, amount)` — if all three match an existing record, the row is flagged as a dispute instead. The destination bank account is inherited from the batch's `titheAccount`.

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
   and sends a confirmation email. On success the member must log in fresh from the new device.
   - If the attempt count reaches the configured maximum, the email is rate-limited and the member must contact an
     admin for an out-of-band device purge (`DELETE /admin/members/:id/device`).

### Forgot Password / OTP Reset Flow

1. `POST /auth/forgot-password` — rate-limited (default: 3 attempts per hour, configurable via env). Generates a 6-digit
   OTP, stores an Argon2 hash in `password_reset_otps`, and emails the code. Always returns the same success message to
   avoid leaking account existence.
2. `POST /auth/reset-password` — verifies the OTP against the hash, checks expiry (default: 15 min), marks the OTP as
   used, updates the password, **invalidates any existing session**, and emails a confirmation. On success the user must
   log in fresh.

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

### Role Elevation

The access token's role is re-validated from the live database on every request via `validateAccessToken`. This means if
a member is promoted to WORKER, their existing token will reflect the new role on the next request after the DB is
updated.

### Department-Key-Based Access Control

Certain modules are gated by a department `key` rather than a specific department name. This allows multiple departments
to share access to the same module (e.g. both "Technical Media" and "Social Media" can carry `key=MEDIA`).

**How it works:**

- Each `Department` record has a nullable `key: DepartmentKeyEnum | null` field. The key is **not unique** — many
  departments may share the same key.
- A `WorkerProfile` has a primary `department` and an optional `secondaryDepartment`. A worker passes a key-based gate
  if **either** their primary or secondary department carries the required key.
- HOD (head-of-department) assignment is always restricted to the worker's **primary** department.

**Sunday School access** — a request passes if any of the following is true:

1. Caller is a WORKER whose primary or secondary department has `key = SUNDAY_SCHOOL`.
2. Caller is the appointed teacher of the specific Sunday School class being acted upon.

Admin-only SS routes (delete class/session) use `AdminGuard + SUNDAY_SCHOOL_WRITE` instead.

**Children Church access** — a request passes if any of the following is true:

1. Caller is a WORKER whose primary or secondary department has `key = CHILDREN_CHURCH`.

Admin-only CC routes (age group/class group CRUD, slot-level check-in report) use
`AdminGuard + CHILDREN_CHURCH_WRITE/READ` instead.

**Fixed: `key` was never reaching clients.** The mechanism above was fully enforced server-side, but `DepartmentRefDto`
(the shape of `department`/`secondaryDepartment` on `WorkerProfileDto`, returned by `GET /auth/me` and `GET /members/me`)
only exposed `id`/`name` — `key` had no `@Expose()` and was stripped by `class-transformer`'s `excludeExtraneousValues`.
Faithapp (the member PWA) has no way to read a field the API never sends, so its Children's Church tab was gated on
`department.name === "Children Church"` — a literal string match that ignored `secondaryDepartment` entirely and would
silently break the moment the department was renamed, even though the *actual* authorization check above never cared
about the name at all. `DepartmentRefDto` now exposes `key: DepartmentKeyEnum | null`, and Faithapp's
`children-church.tsx` gates on `department?.key === "CHILDREN_CHURCH" || secondaryDepartment?.key === "CHILDREN_CHURCH"`,
matching the backend's own rule exactly (including the secondary-department case it previously missed).

---

## 5. Module Reference

### Auth Module

**Routes:** `POST /auth/signup`, `POST /auth/login`, `POST /auth/admin-login`, `POST /auth/refresh`,
`POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password`, `POST /auth/email-change/request`,
`POST /auth/email-change/confirm`, `POST /auth/forgot-password`,
`POST /auth/reset-password`, `POST /auth/device-reset/request`, `POST /auth/device-reset/verify`

`POST /auth/email-change/*` require an authenticated session (member or worker) — see Self-Service Email Change Flow
above for the full request/confirm sequence.

**Route separation:** `POST /auth/login` is for the **mobile app** (members & workers) and enforces device lock —
`deviceId` is required. `POST /auth/admin-login` is for the **web admin portal** — it verifies that the caller has an
active `Admin` record and has no device check. Both routes use the same Passport `LocalAuthGuard` for credential
validation.

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

**Pastor designation:** three `AdminGuard` + `MEMBERS_WRITE` routes manage the optional `Pastor` relation on a member
(same permission as promote-to-worker — no separate permission was introduced):

- `POST /members/:id/pastor` — body `{ type: PastorTypeEnum }` — assigns the designation; `409 Conflict` if the
  member is already a pastor.
- `PATCH /members/:id/pastor` — body `{ type: PastorTypeEnum }` — changes the type; `404` if the member is not a
  pastor.
- `DELETE /members/:id/pastor` — removes the designation; `404` if the member is not a pastor. Returns `204`.

`pastorType: PastorTypeEnum | null` is surfaced on `MemberDto` (`GET /auth/me`, `GET /members/me`,
`GET /members/:id`, `GET /members`, `GET /members/workers`), computed from the `pastor` relation.

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
to the module's default label). Both Faithapp-admin's sidebar and Faithapp mobile's Explore/Ministry/Leadership
tiles read from this single endpoint (`useModuleState()` hook, near-identical implementation in both frontends)
rather than each frontend independently guessing module state — the same duplication risk already seen once with
Faithapp-admin's hardcoded permission-group list (see Admin Module's `AdminPermissionGroups` note below).

**`AdminPermissionGroups` visibility tied to module state:** each `AdminPermissionGroup` (see `AdminPermission` enum
reference) optionally carries a `moduleKey`. Faithapp-admin's role-permission picker (`app/admin-management/page.tsx`)
and the read-only permission display (`app/profile/page.tsx`) both filter `PERMISSION_GROUPS`/`AdminPermissionGroups`
through `isModuleEnabled(group.moduleKey)` before rendering — an admin is never offered permissions for a feature
that's disabled for their church. Core, non-toggleable groups (Members, Events & Venues, Departments, Attendance,
Finance, Administration, etc.) carry no `moduleKey` and are always shown.

**Routes prefix:** `/admin/settings` (admin CRUD), `/modules/state` (shared read endpoint, all authenticated roles)

### Event Module

Manages events and service slots. Events can be single or recurring (daily/weekly/monthly). At least one `serviceSlot`
is required at creation — each slot carries an optional `configId` pointing to an `EventConfig`. For recurring events
the same slot template (including `configId`) is stamped onto every generated occurrence; updating the config later
propagates to all check-ins that reference it.

`CreateEventDto` takes no `eventDate`/`endDate` fields — `Event.eventDate`/`endDate` are always derived from the
supplied `serviceSlots` (`eventDate` = earliest `startTime`, `endDate` = latest `endTime`, both UTC-date-truncated so
the result doesn't depend on server timezone). This applies on both `create` (including each recurring occurrence,
computed from its own offset-shifted slots) and `update` (whenever `serviceSlots` is replaced). There is no longer a
"manual" date range independent of the slots — previously a caller could set an event date range that didn't match
its slot times (e.g. editing a slot's time left the event's dates stale), which this removes by construction.

**Routes prefix:** `/events`, `/event-config`

Each slot can have multiple reminder schedules via sub-resource `/events/slots/:slotId/reminders` (admin-only). See EventReminder model.

**Admin frontend UX (`Faithapp-admin`, `app/events/page.tsx`):** since the event's date range is entirely derived from its slots' times (no manual override, per above), the create/edit form's `SlotRow` sets `min` on the datetime-local inputs (a slot's End Time can't be earlier than its own Start Time; each slot after the first has its Start Time's `min` set to the previous slot's End Time, since slots run in sequence) — but `min` on `type="datetime-local"` only reliably restricts the browser's *calendar* date view; the time-of-day spinner on an already-valid date isn't blocked interactively in Chrome/most browsers, only flagged `:invalid` on blur/submit, which read as "not working" for the time portion. `updateSlot()` therefore also clamps values in JS the instant they change: a slot's End Time snaps forward to match its Start Time if set earlier, a slot's Start Time snaps forward to the previous slot's End Time if set earlier (pulling its own End Time along if that would now precede it), and moving a slot's End Time later pulls the next slot's Start Time forward with it if it would otherwise fall behind. `min` is kept alongside this for the calendar-level hint; the JS clamp is what actually prevents an invalid time-of-day from sticking. Neither replaces backend validation, which still governs what's actually accepted on submit.

**Reminder dispatch (cron `*/15 * * * *`):** Queries `EventReminder` rows where `enabled = true`, `lastSentAt IS NULL`, `fireAt <= now`, and `slot.startTime > now`. The filter runs entirely in SQL — `fireAt` is pre-computed at reminder creation (and recalculated if `intervalPreset` is updated). When a slot is deleted or recreated (e.g., event update), its reminders are cascade-deleted. On `create`, `fireAt = slot.startTime − preset_minutes`. On `update` with a new `intervalPreset`, `fireAt` is recalculated from the existing slot's `startTime`.

**Service slot ordering:** `EventService.getAll()`, `getById()`, and `getUpcomingEvents()` all explicitly order the `serviceSlots` relation by `startTime` ASC (query-builder `.addOrderBy('serviceSlots.startTime', 'ASC')` for `getAll`; TypeORM's relation `order` option for the other two, e.g. `order: { serviceSlots: { startTime: 'ASC' } }`). Without this, a joined one-to-many relation has no guaranteed order — First/Second Service could come back in either order depending on DB/join internals, which showed up as the admin portal's event list not consistently showing slots in the order they begin.

### Venue Module

Manages named venue records referenced by event configs and individual service slots. Venues decouple location data from
event creation — create a venue once, reference it by ID in any config or slot.

**Routes prefix:** `/venues`  
**ADMIN:** create, update, delete  
**Any authenticated user:** list (full, unpaginated — admin-controlled reference data), get by ID

### Attendance Module

**Check-in window logic:**

- Window opens: `slot.startTime + workerCheckinStartOffsetSeconds` (workers) or `+ memberCheckinStartOffsetSeconds` (
  members)
- Window closes: `slot.startTime + checkinStopOffsetSeconds` (same for all)
- Workers are LATE if they check in after `slot.startTime + workerLateOffsetSeconds`
- Members are always PRESENT if within the window

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
  `assertIsAdminDeptWorker()` (the caller's `workerProfile.department` or `secondaryDepartment` must have
  `key === DepartmentKeyEnum.ADMIN` — the same department-key idiom already used by
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
  `PATCH /prayer-requests/team/:id/status`. Gated in-service by `assertIsPrayerTeamOrPastor()`: any worker whose
  primary or secondary department key is `PRAYER`, or any member with a `Pastor` record.
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
managed entirely by the Prayer team/pastors on the woman's behalf — there is no worker-facing self-submit
controller. `PregnancyPrayerCase.lastPrayedAt` is denormalized and updated whenever a new visit is logged, so the
UI can show "last prayed" without joining the visit log on every read. Reuses `PRAYER_READ`/`PRAYER_WRITE` — no new
permission. Every `PregnancyPrayerVisit` is also readable back via `GET
prayer-requests/team/pregnancy-cases/:id/visits` (mobile) and `GET
prayer-requests/admin/pregnancy-cases/:id/visits` (admin, `PRAYER_READ`) — paginated, newest first, so the full
visit-and-note history is reviewable, not just the denormalized `lastPrayedAt` date. Routes: `GET/POST
prayer-requests/team/pregnancy-cases`, `POST prayer-requests/team/pregnancy-cases/:id/visit`, `PATCH
prayer-requests/team/pregnancy-cases/:id/status`, `GET prayer-requests/team/pregnancy-cases/:id/visits` (mobile,
`assertIsPrayerTeamOrPastor` gated) and the parallel `GET prayer-requests/admin/pregnancy-cases`, `PATCH
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

**Routes prefix:** `/classes`, `/classes/types`

### Announcements Module

Audience-targeted broadcast messages. The `/announcements/feed` endpoint filters automatically based on the caller's
role and optional `departmentId`.

**Audience rules:**

- MEMBER → sees `ALL` + `MEMBERS_ONLY` + any `INDIVIDUAL` announcements addressed to them + any `GROUP` announcement for a group they belong to
- WORKER → sees `ALL` + `WORKERS_ONLY` + `DEPARTMENT` (for their department) + `INDIVIDUAL` (addressed to them) + any `GROUP` announcement for a group they belong to
- ADMIN → sees all audiences
- Expired announcements (`expiresAt < now`) are excluded from the feed

**Audience types:** `ALL` | `WORKERS_ONLY` | `MEMBERS_ONLY` | `DEPARTMENT` | `INDIVIDUAL` | `GROUP`  
When `audience = DEPARTMENT`, `departmentId` is required. When `audience = INDIVIDUAL`, `targetMemberId` (UUID) is
required. When `audience = GROUP`, `groupId` (UUID) is required.

**GROUP audience + push notification:** When an announcement is created with `audience = GROUP`, `AnnouncementService.create()` resolves the group's member ids (`GroupService.getMemberIdsForGroup`) and fire-and-forgets a single `PushNotificationService.dispatchToMemberIds()` call (idempotency key = the announcement id, so a retry or duplicate call never double-sends). Failure to dispatch is logged as a warning and never fails the announcement creation itself — the announcement is still visible in-app via the feed regardless of push delivery outcome.

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

`resolvePhoneNumbers` takes a plain `{ audience, departmentId?, targetMemberId?, groupId? }` target rather than an
`Announcement` entity, so it's reusable outside the announcement-creation flow — see `sendSmsBroadcast` below.

**SMS-only broadcast (`POST /announcements/sms-broadcast`), no announcement created:** For sending a text blast to an
audience without publishing anything to the in-app feed. Guarded solely by `SMS_SEND` (not `ANNOUNCEMENTS_WRITE` —
an admin with SMS access but no announcement-authoring access can use this). Body: `SendSmsBroadcastDto` —
`audience` (required) + the matching `departmentId`/`targetMemberId`/`groupId` for `DEPARTMENT`/`INDIVIDUAL`/`GROUP`
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

**Known limitation (as of this writing):** push notifications on `create()` are only dispatched for `audience: GROUP`
(`notifyGroup()`) — `ALL`/`MEMBERS_ONLY`/`WORKERS_ONLY`/`DEPARTMENT` announcements are created and appear in the feed
but never trigger a push notification. Slated to be fixed alongside the Sermon Archive's livestream-triggered
announcements (see Sermon Module), since a system-triggered "we're live" announcement needs to reach everyone, not
just a group.

**Routes prefix:** `/announcements`

**Picking a group when creating a `GROUP` announcement** does not require `groups:read`/`groups:write` — the admin
frontend's group picker (`GroupSearchInput`, a searchable combobox filtering the already-fetched list client-side
rather than a plain `<select>`) calls `GET /groups/lookup` via `useGroupLookup()` (see Groups Module), gated on
`announcements:write` only, since choosing a group here is a component of the announcement feature rather than a
separate group-management capability.

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

Provider-agnostic SMS sending, currently backed by Termii. Consumers (e.g. `AnnouncementService`) depend only on
`SmsService`/`SmsProvider` — swapping vendors means writing a new class implementing `SmsProvider` and changing one
line in `SmsModule`, with no other call site changes.

**Provider abstraction (`src/sms/interface/sms-provider.interface.ts`):**

```ts
interface SmsProvider {
  send(to: string[], message: string, encoding: 'plain' | 'unicode'): Promise<{ messageId: string; status: string }>;
  getBalance(): Promise<{ balance: number; currency: string }>;
  getMessageHistory(): Promise<SmsLogEntry[]>;
}
```

Registered under the `SMS_PROVIDER` DI token in `SmsModule`; `TermiiSmsProvider` is the current concrete
implementation.

**`SmsService`:**

- `calculateSegments(message)` — determines encoding and segment count for billing purposes. A message is encoded
  `plain` (GSM-7, 160 chars/segment) unless it contains a non-ASCII character **or** one of the characters Termii
  documents as forcing UCS-2/unicode encoding even though they're otherwise ordinary ASCII punctuation:
  `; ^ { } \ [ ~ ] | € ' "` — in which case it's encoded `unicode` (70 chars/segment). Returns
  `{ segments, encoding, characterCount }`.
- `send(to, message)` — batches `to` into groups of 100 (Termii's per-request recipient cap,
  `TERMII_MAX_RECIPIENTS_PER_REQUEST`) and calls the provider once per batch. A failed batch is logged and skipped;
  it does not abort the remaining batches.
- `getLogs()` — pure passthrough to `provider.getMessageHistory()`. No local persistence: every call to
  `GET /admin/sms/logs` re-fetches Termii's own message-history endpoint live, so this is always current but also
  always network-dependent (no caching/sync job exists).

**Message history (`TermiiSmsProvider.getMessageHistory`):** calls Termii's `GET /api/sms/inbox?api_key=...`
(undocumented pagination or date-filter params — it's a flat array of every message on the account) and maps its
raw field names (`receiver`, `message`, `status`, `sms_type`, `message_id`, `created_at`, `sender?`) to the
provider-agnostic `SmsLogEntry` shape (`recipient`, `message`, `status`, `type`, `messageId`, `sentAt`, `sender?`).
A non-array response body is treated as empty rather than thrown.

**Routes prefix:** `/admin/sms` (`AdminGuard`)

| Method | Path                       | Permission | Description                                                            |
|--------|----------------------------|------------|--------------------------------------------------------------------------|
| GET    | `/admin/sms/balance`       | SMS_READ   | Returns `{ balance, currency }` from the provider                        |
| POST   | `/admin/sms/segment-count` | SMS_READ   | Body `{ message }` — returns `{ segments, encoding, characterCount }` without sending anything |
| GET    | `/admin/sms/logs`          | SMS_READ   | Live passthrough to the provider's message history — `SmsLogEntry[]`, not paginated or filtered server-side (Termii's endpoint doesn't support either); the frontend paginates/filters the returned array client-side |

**Env vars:** `TERMII_API_KEY`, `TERMII_SENDER_ID`, `TERMII_BASE_URL` (default `https://api.ng.termii.com`) — see
Environment Variables.

**Announcement integration:** see "Optional SMS delivery" under Announcements Module — sending SMS on an
announcement requires the `SMS_SEND` permission (distinct from `SMS_READ`, which only allows checking balance/cost).

### Utility Module

Shared infrastructure used across the entire application.

**Bull Board (queue dashboard):** Mounted at `GET /queues` on the NestJS HTTP server. Provides a standalone web UI showing all six queues (`email`, `push-notifications`, `follow-up`, `tithe`, `finance-reconciliation`, `audit-log`) with pending/active/completed/failed job counts and per-job retry controls. Protected by HTTP Basic Auth (`BULL_BOARD_USER` / `BULL_BOARD_PASSWORD` env vars). If either env var is absent the dashboard is not mounted. Registered before Helmet so the `/queues` path is exempt from the strict Content Security Policy.

**Email queue (`EmailQueueService` + `EmailProcessor`):** All outbound email goes through a Bull queue backed by Redis. `EmailQueueService.queueEmailWithTemplate()` compiles the HTML template using **Handlebars** and adds a job to the `email` queue. The active email provider is resolved at startup from `EMAIL_PROVIDER` and injected via `EMAIL_PROVIDER_TOKEN`. Two providers are available: `GmailProvider` (Nodemailer/SMTP) and `ResendProvider` (Resend SDK). Bull handles retries automatically — 5 attempts, 5-second fixed backoff. On success or permanent failure, a row is written to `email_logs` with the `provider` field set to whichever provider processed the job.

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

Template files live in `src/utility/templates/*.html` and use `{{variable}}` for simple substitution, `{{#if}}` for
conditionals, and `{{#each}}` for loops. Values are HTML-escaped automatically; use `{{{variable}}}` only for
intentional raw HTML.

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

**Fields returned by `/birthday/today`** (member-facing, `BirthdayCelebrant`): `id`, `firstname`, `lastname`, `birthMonth`, `birthDay`, `birthYear`, `role`, `departmentName`, `pastorType`, `alreadyWishedByMe`, `photoUrl`. Deliberately does **not** include `email`/`phoneNumber` — those are fine for the admin-only `/birthday/upcoming` view but not for a response every member can call. Same-named celebrants are disambiguated instead via `role`/`departmentName` (from `workerProfile.department`, loaded via the `workerProfile` and `workerProfile.department` relations), `pastorType` (from the `pastor` relation), and now `photoUrl` (from `Member.photoUrl` — see Member Module) — the mobile UI shows the photo when set, falling back to initials.

**`alreadyWishedByMe` on `/birthday/today`:** computed per request from the caller's own JWT identity (not present on `/birthday/upcoming`, which is admin-only and has no "sender" concept) — `true` when the calling member already has a `BirthdayWish` row for that recipient this calendar year. `sendWish()` already enforced one-wish-per-sender-per-recipient-per-year at the DB level (`@Unique(['recipient', 'sender', 'year'])` on `BirthdayWish`) and rejected a second attempt with 400 — this field just surfaces that same state proactively on load, computed via a single extra query (`BirthdayWish.find({ sender, year, recipient: In(todaysBirthdayIds) })`) rather than the client only discovering it reactively after a failed second send.

**Routes prefix:** `/birthday`

### Notes Module

Pastoral records of significant events (child naming, dedication, marriage). Admin-only. Stored as typed JSON detail
objects.

**Note types:** `child_naming`, `child_dedication`, `marriage`

**Routes prefix:** `/notes`, `/notes-analytics`

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

**Member visibility:** Members view their own tithes at `GET /tithes/me` and request a PDF statement emailed to them at `POST /tithes/me/statement/send` (`TitheService.emailTitheStatement` — renamed from `/tithes/me/download`, which never downloaded anything; it always emailed a PDF). Optional query params `fromMonth` and `toMonth` (format `YYYY-MM`) filter the records included in the statement and display a period range in the PDF (e.g. `?fromMonth=2026-01&toMonth=2026-06`). If only one bound is supplied the other is open-ended. Returns `{ message, recordCount }` (200 OK) — previously returned `204 No Content`, which meant the frontend's success message could never actually render since HTTP clients discard the body of a 204 regardless of what the server sends. The email body itself (not just the attached PDF) also states the period in prose (`formatStatementPeriod()` — "January 2026 – June 2026" / "March 2026 onwards" / "Up to June 2026") and the record count, falling back to "all N tithe records on file" when no range was requested, so the email is accurate on its own without needing to open the PDF.

**Tithe payment proof:** Members and workers submit proof of an offline tithe payment via `POST /tithes/proof` (multipart, field: `file`, max 2 MB; body field `titheAccountId` — the account they paid into). The file is uploaded to Cloudinary and a `TithePaymentProof` record is created with status `PENDING` and `expiresAt` set to `TITHE_PROOF_EXPIRY_DAYS` days from submission (default 90). Finance team admins review proofs at `GET /admin/tithes/proofs` and can `CONFIRM` or `DECLINE` each one. Confirming or declining triggers an email to the member that includes the bank name and account-level currency. A daily cron at `03:00` (church-local time, see [Timezone](#timezone)) (with distributed Redis lock `lock:tithe-proof-cleanup`) finds all expired proofs (`expiresAt ≤ now`), deletes each file from Cloudinary using the stored `publicId` + `resourceType`, and removes the DB rows.

**Routes prefix (admin):** `/admin/tithes`  
**Routes prefix (member):** `/tithes`

### Finance Module

Full double-entry accounting system for the church. All financial data is fund-scoped (RESTRICTED / UNRESTRICTED). Every posted entry has balanced debit and credit lines; the balance is enforced at the service layer before posting, and a DB-level `CHECK (current_balance >= -0.01)` on `finance_accounts` is a last-resort safety net.

**Core concepts:**

| Concept | Description |
|---|---|
| **Fund** | RESTRICTED or UNRESTRICTED pool of money. Every account, offering, budget, and pledge belongs to a fund. |
| **AccountingPeriod** | A calendar month (year + month). Entries can only be posted to OPEN periods. Closing a period is irreversible by design (only admins with `FINANCE_RECONCILE` can close or reopen). |
| **Chart of Accounts** | `finance_accounts` table. Each account has an optional unique `code` (e.g. `1001`), a type (ASSET / LIABILITY / INCOME / EXPENSE), subtype, normal balance (DEBIT or CREDIT), and an optional fund assignment. `code` is nullable but unique when provided — 409 if a duplicate code is submitted. |
| **JournalEntry** | The root transaction record. Must be BALANCED (sum of debits = sum of credits) before posting. Created as `PENDING_APPROVAL`; a separate admin with `FINANCE_APPROVE` (who is not the creator — segregation of duties) approves and posts it. |
| **JournalEntryLine** | One debit or credit line on a journal entry. Linked to an account. `journal_entry_id` and `account_id` are both indexed. |
| **JournalEntryLink** | Polymorphic association table attaching a journal entry to members, departments, service events, or external payees. Stored as a separate table to preserve FK integrity and allow multiple associations per transaction. |
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

**Tithe virtual accounts:** Members can request a dedicated bank account from a supported provider (Paystack / Flutterwave). BVN / NIN details are forwarded to the provider API and never stored in this database. One active account per provider per member. Admin-only deactivation. A new account for the same provider can only be created after the previous one is deactivated. Provider webhooks auto-create `TitheRecord` with `source = VIRTUAL_ACCOUNT` and link to the `MemberVirtualAccount` row.

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

The `annual-giving-statement.html` template was also silently rendering with a blank church name/address and no currency symbol — it referenced `{{ churchName }}`/`{{ churchAddress }}` (camelCase) and `{{ currency }}`, but `EmailQueueService.compileTemplate()` only ever injects `church_name`/`church_address`/`logo_url` (snake_case) globally, and the scheduler never passed `currency`. Handlebars renders unresolved variables as an empty string, not literal `{{ }}` text, so this went unnoticed. Fixed: template now references the snake_case globals, and both `sendForMember()` and `run()` pass `currency: configService.get('CURRENCY_CODE')`.

**Recurring entry scheduler:** Runs daily at 08:00 (Redis lock). For each active `RecurringEntry` where `nextDueAt ≤ now`, generates a `PENDING_APPROVAL` journal entry in the current month's open accounting period and advances `nextDueAt` to the next due date. The journal entry creation, line saves, and `nextDueAt` update all run inside a single `dataSource.transaction()` — a crash mid-write cannot leave a journal entry with no lines.

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
| `TITHE_WRITE` | Manage tithe accounts, virtual accounts, deactivate member virtual accounts |

**Routes prefix (admin):** `/admin/finance/...`

| Resource | Prefix |
|---|---|
| Funds | `/admin/finance/funds` |
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

**Virtual account endpoints:**

| Method | Path | Auth | Permission | Description |
|---|---|---|---|---|
| `POST` | `/tithes/me/virtual-account` | Member JWT | — | Request a new virtual bank account from a provider |
| `GET` | `/tithes/me/virtual-accounts` | Member JWT | — | List all virtual accounts for the authenticated member |
| `PATCH` | `/admin/tithes/virtual-accounts/:id/deactivate` | Admin JWT | `TITHE_WRITE` | Deactivate a member's virtual account |
| `POST` | `/webhooks/virtual-account-credit` | None (HMAC) | — | Provider webhook — creates `TitheRecord` with `source = VIRTUAL_ACCOUNT` |

The webhook is unauthenticated but verified with an HMAC-SHA512 signature against `VIRTUAL_ACCOUNT_WEBHOOK_SECRET`. Signature is read from `x-paystack-signature` (Paystack) or `verif-hash` (Flutterwave) headers. Duplicate credits are ignored via idempotency on `external_reference`.

**Environment variables added:**

| Variable | Default | Description |
|---|---|---|
| `ASSET_OVERDUE_NOTIFICATION_DAYS` | `1,3,7` | Comma-separated days-overdue thresholds for checkout reminders. Empty string disables. |
| `VIRTUAL_ACCOUNT_WEBHOOK_SECRET` | *(required)* | HMAC-SHA512 secret for verifying provider webhook calls |
| `PAYSTACK_SECRET_KEY` | *(optional)* | Paystack secret key; required if using Paystack as a virtual account provider |
| `FLUTTERWAVE_SECRET_KEY` | *(optional)* | Flutterwave secret key; required if using Flutterwave as a virtual account provider |
| `ANNUAL_GIVING_STATEMENT_ENABLED` | `false` | Set to `true` to enable the Jan 1 batch annual giving statement emails to all members |

**Entities:** `finance_funds`, `finance_accounting_periods`, `finance_accounts`, `finance_external_payees`, `finance_journal_entries`, `finance_journal_entry_lines`, `finance_journal_entry_links`, `finance_offerings`, `finance_budgets`, `finance_pledge_campaigns`, `finance_pledges`, `finance_recurring_entries`, `finance_petty_cash_replenishments`, `finance_bulk_upload_jobs`, `finance_reconciliation_rows`, `finance_bank_import_profiles`, `member_virtual_accounts`. New FK on `finance_offerings`: `reconciled_by_id`. New FK on `finance_bulk_upload_jobs`: `profile_id`. New columns on `tithe_records`: `source`, `external_reference`, `payment_channel`, `virtual_account_id`; `batch_id` is now nullable (webhook-created records have no batch). New columns on `assets`: `insurance_expiry`, `roadworthiness_expiry`, plus 8 notification-timestamp columns (`insurance_notified_*`, `roadworthiness_notified_*`).

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
  whose primary or secondary department key is `EVANGELISM` — enforced by
  `ConvertService.assertIsEvangelismDeptWorker()`, a direct copy of `assertIsAdminDeptWorker()`
  (`service-programme/service/service-session.service.ts`) with the department swapped.
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

### ServiceHeadcount Module

Records and retrieves physical attendance counts for services, broken down by demographic group. All routes are admin-portal only (`AdminGuard`). Headcount data can be filtered by service slot, date range, or slot name; trends are bucketed by week, month, or quarter.

**Entity:** `ServiceHeadcount` — one record per service slot (`OneToOne`, enforced by a unique constraint on `service_slot_id`). `POST /service-headcount` is an upsert: recording again for a slot that already has a headcount edits that row in place instead of creating a sibling, so summing across a service's sub-services never double-counts.

**Computed total:** Every response includes a `total` field (sum of fixed groups + all `customGroups` values). Not stored in DB.

**Event-level summary (`GET /service-headcount/event/:eventId/summary`):** The service-level view for a multi-service Sunday — returns every sub-service (`ServiceSlot`) under the event ordered by `startTime`, each with its headcount if recorded (`null` otherwise), plus an aggregate `total` summed across whichever sub-services have been recorded so far (`recordedCount`/`slotCount` show how many are still outstanding). This is the primary admin-facing view (`app/service-headcount`'s "By Event" tab) — an admin picks the Event once and records each sub-service's count inline without leaving the page, and sees the full-service total without adding sub-services up by hand. Reuses the same 5-field-plus-custom-groups form as the flat `POST` route; no new DTO.

**No separate correction endpoint (by design):** `PATCH /service-headcount/:id` existed early on for correcting a record, consumed only by the Records tab's now-removed "Edit" button (a flat historical list, separate from the "By Event" tab). Once headcount became upsert-on-`POST`, that PATCH route had no remaining frontend caller — removed entirely (controller route, service method, `UpdateServiceHeadcountDto`) rather than left as dead, unconsumed admin API surface. Corrections now happen exactly one way: re-recording the same sub-service through the "By Event" tab, which pre-fills the existing values and edits in place.

**Trends:** `GET /service-headcount/trends` returns bucketed data. Each bucket is keyed by `periodLabel + serviceSlotName` so multiple slots on the same Sunday appear as separate series. `customGroups`' dynamic per-church keys mean the per-bucket aggregation stays in-memory rather than SQL `GROUP BY`, but omitting `from` now defaults to a bounded ~365-day lookback (`defaultTrendsFrom()`) instead of scanning every headcount record ever logged — an explicit `from` is always honored as-is.

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

**Trigger points:**

| Event | Who is notified |
|---|---|
| Selection window opened (`openSelectionWindow`) | All active workers |
| Auto-assign completes (`autoAssign`) | Each newly assigned worker |
| Manual assignment (`manualAssign`) | The assigned worker or member |
| Entry removed (`removeEntry`) | The affected worker or member |
| Entry rescheduled (`reschedule`) | The affected worker or member |
| Prayer reminder — 2 days before (`PrayerReminderScheduler`) | The assigned worker (alongside email) |
| Prayer reminder — day of (`PrayerReminderScheduler`) | The assigned worker (alongside email) |
| Service/event reminder (`EventReminderService`) | All eligible members per audience scope (alongside email) |

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
  - CORS on the gateway now reads `CORS_ORIGINS` (same env var as the HTTP API) instead of the previous wide-open `origin: '*'`.
  - Frontend: `hooks/use-live-session-socket.ts` connects to the namespace, joins the session's room, and calls back into each view's `setPayload` on every `session:state` event. Each of the four views kept only a much slower (30s) safety-net `setInterval` poll as a fallback for the rare case a broadcast is missed during a disconnect/reconnect or a backend restart — this is a defense-in-depth measure, not the primary update path anymore. The socket origin is derived from `NEXT_PUBLIC_API_URL`'s origin (stripping the versioned `/v1` path — Socket.IO attaches to the raw HTTP server, not the REST prefix).
  - The per-IP `@Throttle({ limit: 300, ttl: 60_000 })` override on `GET :code/state`/`GET :code/slots/:position` is left in place for the initial load and safety-net poll, but is no longer the thing standing between this module and a real capacity problem — it never bounded aggregate load across many distinct viewer IPs in the first place.
- The presentation view's countdown has three visual states: normal (white) → **caution** ("Wrapping Up", amber, pulsing) once remaining time drops to `SERVICE_SLOT_CAUTION_THRESHOLD_RATIO` (env, default `0.25`, i.e. the last 25% of the slot's allocated time) → **overtime** ("Time's Up", red, pulsing) once elapsed exceeds the allocation, after which the display counts up (`+MM:SS`). The ratio is resolved server-side and returned as `cautionThresholdRatio` on `GET /service-session/:code/state`, so the frontend has a single source of truth rather than duplicating the value in its own env config. See `SlotTimerDisplay` (frontend). The presentation page also supports a keyboard shortcut (`F`) to toggle browser fullscreen via the Fullscreen API.
- When a `ServiceProgrammeSlot` is assigned a member (via `addSlot` or `updateSlot`'s `memberId`), `notifySlotAssignment()` fires two independent, fire-and-forget notifications — neither gates the other, since a member may have one channel but not the other:
  - **Email** (template: `service-slot-assigned`) if the member has an email on file, with a generated `.ics` calendar invite attached when the underlying `ServiceSlot` has both a `startTime` and `endTime`. The template body includes the formatted service **date** (`{{ serviceDate }}`, e.g. "Sunday, 19 July 2026") and **time range** (`{{ serviceTime }}`, e.g. "8:00 AM – 10:00 AM") as plain text in the "Your slot" attributes table — not just carried in the `.ics` attachment, so the schedule is readable even without a calendar client. Both fields are computed once via `fmtAssignmentDate`/`fmtAssignmentTime` and reused for the push body below.
  - **Push notification** (`PushNotificationService.dispatchToMemberIds`, `@Global()` module — no explicit import needed) to the assigned member, unconditionally (no email required). `idempotencyKey: service-slot-assigned:${slot.id}:${member.id}` keys it per slot-and-person so a primary/backup reassignment on the same slot doesn't dedupe against each other. Body includes the slot type, service name, and date/time when available (e.g. "Speaker — Sunday Service — First Service on Sunday, 19 July 2026 at 8:00 AM – 10:00 AM"); links to `/events` in the member app.

  Guests (`guestName`, no member record) never reach this method — nothing to email or push. Re-editing a slot without changing its assigned member does not re-send either notification. The response from `addSlot`/`updateSlot` may include a non-blocking `conflictWarning` string when the assigned member already has another slot (in a different programme) whose service time overlaps this one — surfaced in the admin UI but never prevents the save.
- Assigning a **backup** member (`backupMemberId`, via the same two endpoints) triggers the identical email + push pair for the backup, with `isBackup: true` in the template data — the template (`{{#if isBackup}}`) swaps the heading/body copy to make clear they're the backup, not the primary, and the subject/push title reads "You're the Backup for: …" instead of "You've Been Added to the Programme: …". Same at-most-once-per-change rule as the primary: re-editing a slot without changing the backup does not re-send.
- **`POST /service-programme` (`create`) is fully batched, not one round trip per programme/slot.** Given N programmes (each with its own set of slots — e.g. creating First Service and Second Service's whole order-of-service in one request), the previous implementation looped per programme (`programmeRepo.save` once each) and, within that, per slot (a `memberRepo.findOne` for the assignee, another for the backup, then `slotRepo.save`) — a 2-programme, 15-slot-each request was 60+ sequential DB round trips. It now: resolves every referenced `memberId`/`backupMemberId` across every programme's slots in one `memberRepo.find({id: In(...)})`, bulk-inserts all programmes in one `programmeRepo.save(array)`, bulk-inserts all slots in one `slotRepo.save(array)`, and reloads all created programmes for the response in one `programmeRepo.find({id: In(...)})` instead of an N-times `findOne`. No change to the request/response shape. One intentional side-effect of the batching: the per-slot `conflictWarning` computation (`findMemberConflictWarning`) is no longer run during `create()` — its result was already discarded here even before this change (only `addSlot`/`updateSlot`'s single-slot paths surface it), so skipping the computation removes wasted queries without changing any observable behavior.
- `ServiceProgrammeReminderScheduler` runs daily at 09:00 (`@Cron('0 9 * * *')`, guarded by a Redis lock so only one instance runs it) and emails a reminder (template: `service-slot-reminder`, same `.ics` attachment logic as the assignment email) to every assigned member whose `ServiceProgrammeSlot.reminderSentAt` is still null and whose programme is DRAFT with a `ServiceSlot.startTime` 24–48 hours away. `reminderSentAt` is stamped immediately after queuing to guarantee at-most-once delivery even if the cron overlaps a slow run.
- `GET /service-session/:code/action-log/csv` streams the full `ServiceActionEntry` audit trail for a session as a CSV download (Timestamp, Actor Role, Actor, Action, Detail) for admins who need an offline record beyond the in-app log; `GET /service-session/:code/action-log` returns the 10 most recent entries as JSON for the dashboard's in-app activity feed. `GET /service-session/:code/report/pdf` (session report PDF), `GET /service-session/event/:eventId/report/pdf` (full event report), and `GET /service-session/event/:eventId/report/summary-pdf` (event summary) all existed on the backend with no frontend consumer for a while — all three are now wired: the Live Session Dashboard's "Share & Access" card has a "Session Report (PDF)" button (next to "Audit Log (CSV)") for the first; the Programmes list's per-event header has "Full Report"/"Session Report"/"Summary" download buttons for the other two (see Service Programme Module notes below for their distinct availability gating).
- **Session report fixes** — `buildSessionReport()`'s `totalPauseDurationSeconds` only ever summed pause entries that had a `resumedAt` (`ServicePauseEntry.resumedAt: Date | null`); a session ended while still paused left that final pause entry with `resumedAt: null` forever, silently dropping its entire duration from the total (and showing "ongoing" in the pause log indefinitely). `end()` now closes any still-open pause entry (`resumedAt IS NULL`, same query used by `advance()`/`resume()`) inside its existing transaction before finalizing the session, so the total and the pause log are always accurate once a session ends. Separately, the session-report PDF's per-slot table (`PdfService.drawSessionReport`/`drawFullEventReport`) dropped its "Type" column and split the previous combined "Topic / Speaker" column (joined with `·`) into two distinct "Topic" and "Speaker" columns — removing the Type column on its own would have made any slot with no topic set indistinguishable from another (`SessionSlotReport.topic` is nullable), so the new `PdfService.slotTopicLabel()` falls back to a human-readable type label (`ServiceSlotTypeLabels[type]`, e.g. "Praise & Worship") whenever a slot has no topic, rather than a bare "—"; `drawEventSummaryReport`'s already-separate Topic/Speaker columns and `drawOrderOfServiceTable`'s topic column were both updated to use the same shared helper for consistency. The single-session PDF also gained a small **Analysis** section — a handful of narrative, presentation-only insights derived from data already on `SessionReport` (on-time/over/under completion counts and combined variance, skipped-slot count, the single biggest overrun slot, and a pause summary with the most common reason) — rendered between the Pause Log and the closing time-summary band. These insights are computed in `PdfService` at render time and are deliberately **not** added to the `SessionReport` JSON contract or the `GET /service-session/:code/report` response. The Pause Log table (in both `drawSessionReport` and `drawFullEventReport`) also stopped rendering a bare `Slot ${p.slotPosition + 1}` — `ServicePauseEntry` only ever stored the slot's numeric position with no name, so the report showed unexplained entries like "Slot 3" with nothing tying it back to the actual slot. `PdfService.pauseSlotLabel()` now resolves that position back to the matching `SessionSlotReport` and reuses `slotTopicLabel()`, so the Pause Log shows the same human-readable topic/type label as the Slots table above it.
- **`GET /service-session/:code/pm/report/pdf`** — the same session report PDF, now also reachable from the public Programme Manager link (`ShareTokenGuard` + `NamedAccessGuard`, controller delegates to a shared private `sendSessionReportPdf` helper alongside the admin route to avoid duplicating the response-header logic). `getReportPdf`/`getFormattedReport` have no session-status precondition — this works whether the session is still LIVE or already COMPLETED — but the frontend surfaces it specifically on the manage page's "Session Ended" screen, since that's the point a PM user actually wants it. This required reordering `/live/:code/manage`'s early-return checks: the name+PIN sign-in gate now runs **before** the "Session Ended" check (previously the reverse — anyone with just the raw link could see the ended-session message with no PIN at all, and a report-download button placed there would have failed silently for anyone who hadn't signed in). Now reaching the ended-session screen guarantees a `grantToken` is already in hand.
- Admin frontend information architecture: the `GET /service-programme` list groups programmes under their parent event (using the `event`/`serviceSlotDetail` fields above) instead of rendering every service slot as an unrelated row, so multi-slot events (e.g. First/Second Service on the same Sunday) visibly belong together. A persistent "Live" pill in the admin top bar (`useActiveSessions`, polling `GET /service-session/active`) is reachable from any page and deep-links straight into a dedicated full-width Live Session Dashboard at `/service-programme/live/:sessionCode` — replacing the old cramped side-panel controls, which now show only a status summary with a link to the dashboard. The poll interval backs off adaptively: 20s while at least one session is LIVE, 60s while idle (the common case, since most of the time nothing is live) — this cut the steady-state request volume from this always-mounted, every-page component by 3x without slowing detection of a session actually starting/ending.
- All four live-session frontend surfaces (Live Session Dashboard, Programme Manager, Presentation, Audience) explicitly check `anchor.status === 'COMPLETED'` and render a dedicated "Session Ended" screen — previously they only checked whether the anchor/payload existed at all, so once a session legitimately ended, `currentSlot` (looked up by `anchor.currentSlotPosition`) still resolved fine and every view kept showing the ordinary live stage with no active slot to display, reading as a stuck/broken UI rather than a finished session.
- Starting a session late (after its `ServiceSlot.startTime` has passed) has never been restricted — `ServiceSessionService.start()` has no time-window check, so any DRAFT programme with slots can be started at any time via `POST /service-session/programme/:programmeId/start`.
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
  - **"My Upcoming Assignments"** — previously a member/worker's only signal that they were scheduled was the one-off `service-slot-assigned` email; there was no way to look it up later. `GET /service-programme/my-assignments` (`getMyUpcomingAssignments()` in `ServiceProgrammeService`) fixes this on the read side: any authenticated member/worker can pull their own upcoming slots — as primary or backup — across every not-yet-completed programme. This is admin-portal-agnostic (`JwtAuthGuard` only, no admin permission), consumed by the **member-facing** app (`Faithapp`, a separate Next.js PWA from the admin portal `Faithapp-admin`) rather than the admin dashboard — `hooks/use-my-assignments.ts` there fetches it and `components/layout/home.tsx` renders a horizontally-scrolling "My Upcoming Assignments" card row on the member home screen (dark cards matching the existing hero's palette), shown only when the member actually has something coming up.
  - **Real-time "my slot" view + personal service history** — two more member-facing additions alongside "My Upcoming Assignments" in `Faithapp`: (1) once a member's upcoming assignment's programme goes LIVE, its card becomes tappable (pulsing "Live" badge) and links to `/my-assignment/:sessionCode`, a page backed by `GET /service-session/:sessionCode/my-status` (`getMyLiveStatus()`) — shows a live countdown to their turn, an "you're up now" banner once it arrives, an "your part is complete" state afterward, and the full running order with their own row highlighted; the countdown ticks locally client-side between 8s polls using the same `fetchedAt` + elapsed-time technique the admin Live Session Dashboard already uses, rather than polling more aggressively. (2) `/service-history` (`hooks/use-my-service-history.ts` → `GET /service-session/my-history`) — a paginated list of the member's own completed slots with total time served and a per-slot-type breakdown, linked from Profile's Worker Operations section. Both reuse existing server-side logic rather than introducing new authorization concepts: `getMyLiveStatus` never exposes other members' identities (only role/position/timing derived values), and `getMyServiceHistory`'s effective-speaker crediting rule is identical to `getAnalytics`'s `memberId` filter, so the two can never disagree about who gets credit for a slot.
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
- Programme CRUD and reporting: `AdminGuard` + `SERVICE_PROGRAMME_READ` (reads) or `SERVICE_PROGRAMME_WRITE` (mutations). Assign these permissions to admin roles via the role management API.
- Authenticated session control (start, advance, rewind, pause, resume, adjust-time, reorder, end): controller only requires `JwtAuthGuard` (any authenticated member or admin); the real rule is enforced once in `ServiceSessionService.assertCanControlSession()` — **Admin-only**: passes only for an active `Admin` entity holding `SERVICE_PROGRAMME_WRITE`. Admin-department workers do **not** get an authenticated control path (this was previously allowed via a WORKER-department check, reserved for a mobile worker UI that was never built against these endpoints — it has been removed by design). Anyone who isn't a `SERVICE_PROGRAMME_WRITE` admin, staff included, controls a session exclusively through the public Programme Manager link with a named PIN grant (see below) — so every control action outside the admin dashboard is attributable to a specific named person, not a role. This does **not** affect `getEventSummaryReportPdfForWorker` (`GET /service-session/event/:eventId/summary-pdf`, a read-only mobile PDF download) — that keeps its own narrower `assertIsAdminDeptWorker()` check (Admin-department worker, no `SERVICE_PROGRAMME_WRITE` fallback needed), deliberately kept separate so tightening session-control access doesn't also lock Admin-department workers out of an unrelated report download.
- Public Programme Manager routes (`POST/PUT /service-session/:code/pm/*` — advance, rewind, pause, resume, adjust-time, reorder, end): `@Public()` + `ShareTokenGuard` (`?token=`), **and** `NamedAccessGuard` (`?grantToken=`). The share token only proves "has the link"; every PM-link holder used to be logged as the same generic `PUBLIC_LINK` actor with no way to tell people apart or revoke one person without rotating the link for everyone. `NamedAccessGuard` layers named, individually-revocable identity on top: an admin/worker calls `POST /service-session/:code/access-grants` (`{ name }`, `JwtAuthGuard` + `assertCanControlSession`) to generate a 6-digit PIN for a collaborator (`randomInt`-generated, argon2-hashed via `UtilityService`, returned in plaintext exactly once — never stored or retrievable again). That person then calls the public `POST /service-session/:code/pm/access` (`ShareTokenGuard` only — this route establishes identity, so it can't itself require `NamedAccessGuard`) with `{ name, pin }`; on success `verifyAccessGrant` issues a `grantToken` (random UUID, Redis-cached alongside `{ grantId, name }`, same TTL as the session) that must be appended to every subsequent `pm/*` write call. `NamedAccessGuard.resolveGrantToken` resolves that token, re-checks the underlying `ServiceSessionAccessGrant` row's `revokedAt` on every call (not just at sign-in), and stamps the grant's name onto the request (`@ActorLabel()`) so it flows through to `logAction`'s `actorLabel` column — surfaced as the `actorName` fallback in `getActionLog`/`getActionLogCsv` whenever there's no `performedByMember`. Revoking via `POST /service-session/:code/access-grants/:grantId/revoke` takes effect on that person's very next action, without touching the shared link or anyone else's grant. Grants are scoped to a single session (table `service_session_access_grants`, `session_id` FK `ON DELETE CASCADE`) — a new PIN is needed each time someone needs PM access to a new session, by design (no cross-session standing identity to manage). The frontend Live Session Dashboard's "Programme Manager Access" panel manages grants (add/list/revoke, showing the PIN once); the public `/live/:code/manage` view gates itself behind a name+PIN sign-in form the first time, then caches the resulting `grantToken` in `localStorage` (keyed per session) so it isn't re-prompted on every visit, clearing that cache automatically if any action comes back with a revoked/expired-access error.
- **Duplicate active names are rejected, not silently allowed** — two active grants sharing a name make sign-in ambiguous (the name+PIN lookup could match whichever row it finds first, so a correct PIN for the second grant could get rejected). `generateAccessGrant` pre-checks for a non-revoked grant with the same name (trimmed, case-insensitive) and throws `ConflictException` (409) instead of creating the duplicate; a partial unique index (`uq_service_session_access_grants_session_name_active` on `(session_id, lower(name)) WHERE revoked_at IS NULL`, migration `AddServiceSessionAccessGrantUniqueActiveName`) catches the same race at the DB level as a safety net, translated back into the same 409. The caller can pass `replaceExisting: true` on `POST /service-session/:code/access-grants` to confirm the swap — this revokes the old grant (logged as `ACCESS_GRANT_REPLACED`) and issues a fresh PIN under the same name in one call. The Dashboard's "Programme Manager Access" panel surfaces this as a "Replace?" prompt when adding a name that's already active, rather than a bare error.
- `overrideSlot` (speaker runtime override) stays `RolesGuard (WORKER)` + Admin department key check only — not exposed in the admin dashboard.
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
- **CORS:** reads `CORS_ORIGINS` (same env var as the HTTP API's `app.enableCors()`), not a wide-open `origin: '*'`.

**Routes prefix:** `/service-programme`, `/service-session`

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
| GET    | /auth/me                                                   | Any                                                           | Own profile. Includes `isHod: boolean` — `true` if the authenticated member has a row in `department_leads`; `pastorType: PastorTypeEnum \| null`; and `isTrainee: boolean` — mirrors `workerProfile.isTrainee` (`false` for non-workers). Clients should fetch this once on load to drive HOD/trainee-gated UI.                                  |
| POST   | /auth/change-password                                      | Any                                                           | Change password (required when `requires_password_change` is true)                                            |
| POST   | /auth/email-change/request                                 | Any (JwtAuthGuard)                                            | Body `{ newEmail }` — sends a 6-digit OTP to the new address; rate-limited; `409` if already in use by another member |
| POST   | /auth/email-change/confirm                                 | Any (JwtAuthGuard)                                            | Body `{ otp }` — verifies OTP, updates own email, sends a confirmation email                                  |
| POST   | /auth/forgot-password                                      | Public                                                        | Request OTP reset code (rate-limited)                                                                         |
| POST   | /auth/reset-password                                       | Public                                                        | Verify OTP and set new password; invalidates current session                                                  |
| POST   | /auth/device-reset/request                                 | Public                                                        | Self-service device reset — rate-limited; issues OTP to registered email; locks in `newDeviceId` at request   |
| POST   | /auth/device-reset/verify                                  | Public                                                        | Verify OTP and swap `deviceId` to `newDeviceId`; invalidates all active sessions                              |
| GET    | /members/me                                                | Any (JwtAuthGuard)                                            | Own member profile with workerProfile + department relations                                                  |
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
| POST   | /members/:id/pastor                                        | AdminGuard (MEMBERS_WRITE)                                    | Assign pastoral designation, body `{ type: PastorTypeEnum }`; `409` if already a pastor                       |
| PATCH  | /members/:id/pastor                                        | AdminGuard (MEMBERS_WRITE)                                    | Change pastor type, body `{ type: PastorTypeEnum }`; `404` if not a pastor                                    |
| DELETE | /members/:id/pastor                                        | AdminGuard (MEMBERS_WRITE)                                    | Remove pastoral designation; `404` if not a pastor; returns `204`                                             |
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
| POST   | /attendances/checkin                                       | Any                                                           | Check in to a service slot (workers must include `location`; one record per event per member)                 |
| GET    | /attendances/my-history                                    | Any                                                           | Own attendance records                                                                                        |
| GET    | /attendances/my-summary                                    | Any                                                           | Own lifetime rate/streak, computed in SQL over full history (not just the current page) — `{ totalCount, presentCount, attendanceRatePercentage, lastCheckedInDate, attendanceStreak }` |
| GET    | /attendances/history                                       | AdminGuard (ATTENDANCE_READ)                                  | All attendance records; query: `page`, `limit`, `memberId`, `slotId`, `status`, `dateFrom`, `dateTo`, `search` (ILIKE on firstname, lastname, email) |
| GET    | /attendances/history/department?slotId=                    | WORKER                                                        | Department attendance for a slot (scoped to caller's own department via lead role)                            |
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
| POST   | /events                                                    | AdminGuard (EVENTS_WRITE)                                     | Create event (single or recurring)                                                                            |
| PATCH  | /events/:id                                                | AdminGuard (EVENTS_WRITE)                                     | Update event                                                                                                  |
| GET    | /events/:id                                                | Any                                                           | Get event by ID                                                                                               |
| GET    | /events                                                    | Any                                                           | List events. Query: `page`, `limit`, `orderBy`, `order`, `from` (YYYY-MM-DD), `to` (YYYY-MM-DD), `upcoming=true`, `search` (case-insensitive match on event name — powers searchable event pickers in the admin frontend) |
| DELETE | /events/:id                                                | AdminGuard (EVENTS_WRITE)                                     | Delete single event — blocked if `attendanceMarked = true` or event is in the past                           |
| DELETE | /events/recurring/:recurringEventId                        | AdminGuard (EVENTS_WRITE)                                     | Delete future recurring events                                                                                |
| POST   | /event-config                                              | AdminGuard (EVENTS_WRITE)                                     | Create timing config                                                                                          |
| PATCH  | /event-config/:id                                          | AdminGuard (EVENTS_WRITE)                                     | Update timing config                                                                                          |
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
| GET    | /venues/:id                                                | Any                                                           | Get venue by ID                                                                                               |
| GET    | /departments                                               | Any                                                           | List departments                                                                                              |
| GET    | /departments/keys                                          | Any                                                           | List all valid department key values                                                                          |
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
| GET    | /prayer-requests/team?status=&page=&limit=             | JwtAuthGuard (Prayer-dept worker or Pastor)                    | Cross-member browse (mobile)                                                                                    |
| PATCH  | /prayer-requests/team/:id/status                       | JwtAuthGuard (Prayer-dept worker or Pastor)                    | Update a request's status (mobile)                                                                              |
| GET    | /prayer-requests/admin?status=&page=&limit=            | AdminGuard (PRAYER_READ)                                       | Cross-member browse (admin portal)                                                                              |
| PATCH  | /prayer-requests/admin/:id/status                      | AdminGuard (PRAYER_WRITE)                                      | Update a request's status (admin portal)                                                                        |
| GET    | /testimonies/admin?page=&limit=                        | AdminGuard (PRAYER_READ)                                       | Full testimony browse (not just public ones)                                                                   |
| GET    | /prayer-requests/team/pregnancy-cases?status=&page=&limit= | JwtAuthGuard (Prayer-dept worker or Pastor)                | Cross-member pregnancy prayer case browse (mobile)                                                              |
| POST   | /prayer-requests/team/pregnancy-cases                  | JwtAuthGuard (Prayer-dept worker or Pastor)                    | Create a pregnancy prayer case (mobile)                                                                        |
| POST   | /prayer-requests/team/pregnancy-cases/:id/visit        | JwtAuthGuard (Prayer-dept worker or Pastor)                    | Log a prayer visit (mobile)                                                                                    |
| PATCH  | /prayer-requests/team/pregnancy-cases/:id/status       | JwtAuthGuard (Prayer-dept worker or Pastor)                    | Update case status (mobile)                                                                                    |
| GET    | /prayer-requests/team/pregnancy-cases/:id/visits       | JwtAuthGuard (Prayer-dept worker or Pastor)                    | Full visit log for a case, newest first (mobile)                                                              |
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
| GET    | /notes/:type                                               | AdminGuard (NOTES_READ)                                       | List notes by type                                                                                            |
| POST   | /notes                                                     | AdminGuard (NOTES_WRITE)                                      | Create note                                                                                                   |
| PUT    | /notes/:id                                                 | AdminGuard (NOTES_WRITE)                                      | Update note                                                                                                   |
| GET    | /notes/:type/:id                                           | AdminGuard (NOTES_READ)                                       | Get note                                                                                                      |
| DELETE | /notes/:type/:id                                           | AdminGuard (NOTES_WRITE)                                      | Delete note                                                                                                   |
| GET    | /notes-analytics/:type                                     | AdminGuard (NOTES_READ)                                       | Analytics for a note type                                                                                     |
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
| POST   | /tithes/me/statement/send                                  | Any (JwtAuthGuard)                                            | Email a PDF tithe statement to the caller's registered email. Optional query: `fromMonth` (YYYY-MM), `toMonth` (YYYY-MM) — filters records to the date range and prints the period on the PDF |
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

4. **Worker location** — workers **must** provide `location` coordinates. Throws 400 if `location` is absent for a WORKER.

5. **Duplicate check** — throws 400 if an attendance record already exists for `(member, event)`. One record per event, regardless of which slot the member enters.

6. **Resolve config** — merges per-slot overrides over EventConfig values. Throws 400 if no config and no overrides.

7. **Validate window:**
    - Workers: window opens at `startTime + workerCheckinStartOffsetSeconds` (typically negative)
    - Members: window opens at `startTime + memberCheckinStartOffsetSeconds`
    - Both close at `startTime + checkinStopOffsetSeconds`

8. **Validate location** *(if location provided)*: Resolves `effectiveVenue` (
   `slot.venueOverride ?? slot.config.defaultVenue`). Calculates Haversine distance between submitted coordinates and
   the venue's `latitude`/`longitude`. If distance exceeds `allowedDistanceInMeters` and `ENFORCE_DISTANCE_CHECK=true`,
   throws 400.

9. **Resolve status:**
    - Member → always `PRESENT`
    - Worker before late threshold → `PRESENT`
    - Worker at or after `startTime + workerLateOffsetSeconds` → `LATE`

10. **Save record** — creates `Attendance` with references to both `event` and `serviceSlot`, `roleAtCheckin` snapshot, and optional location.

---

## 8. Automated Absence Marking

A cron job runs every 5 minutes (`EVERY_5_MINUTES`).

**Logic:**

1. Finds all `Event` records where `attendanceMarked = false` AND `endDate < today` AND the event has at least one service slot.
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
| Prayer team inbox (view/update request status)  | —               | ✓ (PRAYER-dept worker or Pastor) |

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

---

## 10. Environment Variables

All variables are validated by Joi at startup (`src/config/env.validation.ts`). Missing required variables crash the
process with a clear error before any HTTP traffic is accepted.

### Runtime

| Variable       | Default        | Description                                  |
|----------------|----------------|----------------------------------------------|
| `NODE_ENV`     | `development`  | `development` \| `production` \| `test`      |
| `PORT`         | `3000`         | HTTP port the server listens on              |
| `CORS_ORIGINS` | — *(required)* | Comma-separated list of allowed CORS origins |

### Branding (used in email templates)

These are read through `ConfigService` at constructor time — **not** from bare `process.env` — so `.env` files are
loaded correctly before use.

| Variable         | Default                                         | Description                              |
|------------------|-------------------------------------------------|------------------------------------------|
| `PRODUCT_NAME`   | `Discovery Hub`                                 | Product name shown in email subjects     |
| `CHURCH_NAME`    | `RCCG Discovery Centre`                         | Church/org name shown in email templates |
| `CHURCH_ADDRESS` | `62 Igi Olugbin Street, Bariga. Lagos, Nigeria` | Church address shown in email templates  |

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
| `DATABASE_POOL_SIZE` | `50`           | Max connections in the pool                                                  |
| `DATABASE_POOL_MIN`  | `10`           | Min idle connections kept alive                                              |
| `DATABASE_POOL`      | `transaction`  | Pool mode for PgBouncer/Supavisor: `transaction` \| `session` \| `statement` |

### JWT

| Variable                | Default                      | Description                                  |
|-------------------------|------------------------------|----------------------------------------------|
| `JWT_SECRET`            | — *(required, min 32 chars)* | Access token signing secret                  |
| `JWT_EXPIRY_IN`         | `1h`                         | Access token expiry (e.g. `1h`, `15m`, `7d`) |
| `REFRESH_JWT_SECRET`    | — *(required, min 32 chars)* | Refresh token signing secret                 |
| `REFRESH_JWT_EXPIRY_IN` | `7d`                         | Refresh token expiry                         |
| `SESSION_MAX_AGE_DAYS`  | `30`                         | Absolute session lifetime in days — refresh rejected after this regardless of rotation |

### Email

Set `EMAIL_PROVIDER` to choose between Gmail SMTP (`gmail`) and the Resend API (`resend`). Only the variables for the active provider are required at runtime.

| Variable          | Default   | Description                                                           |
|-------------------|-----------|-----------------------------------------------------------------------|
| `EMAIL_PROVIDER`  | `gmail`   | Active provider: `gmail` \| `resend`                                  |
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
| `ENFORCE_DISTANCE_CHECK`      | `false` | Require members to be within `allowedDistanceInMeters` to check in |
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
| `DEFAULT_VENUE_NAME`                       | `RCCG Discovery Centre` | Name for the seeded default venue             |
| `DEFAULT_VENUE_ADDRESS`                    | —                       | Street address for the seeded default venue   |
| `DEFAULT_VENUE_LATITUDE`                   | —                       | WGS84 latitude of the default venue           |
| `DEFAULT_VENUE_LONGITUDE`                  | —                       | WGS84 longitude of the default venue          |
| `DEFAULT_EVENT_CONFIG_NAME`                | —                       | Name for the seeded default event config      |
| `DEFAULT_EVENT_ALLOWED_DISTANCE_IN_METERS` | `100`                   | Default allowed check-in radius (metres)      |
| `WORKER_CHECKIN_START_OFFSET_SECONDS`      | `-1800`                 | Workers can check in 30 min before start      |
| `WORKER_LATE_OFFSET_SECONDS`               | `0`                     | Workers arriving after `startTime` are LATE   |
| `MEMBER_CHECKIN_START_OFFSET_SECONDS`      | `-900`                  | Members can check in 15 min before start      |
| `CHECKIN_STOP_OFFSET_SECONDS`              | `3600`                  | Check-in closes 1 hr after start              |

### Cloudinary (file uploads)

Used for finance request attachments and payment proofs.

| Variable                  | Default        | Description                     |
|---------------------------|----------------|---------------------------------|
| `CLOUDINARY_CLOUD_NAME`      | — *(required)* | Cloudinary account cloud name                                              |
| `CLOUDINARY_API_KEY`         | — *(required)* | Cloudinary API key                                                         |
| `CLOUDINARY_API_SECRET`      | — *(required)* | Cloudinary API secret                                                      |
| `MAX_FILE_UPLOAD_BYTES`      | `5242880`      | Global hard ceiling for all file uploads (bytes). Registered via `MulterModule` in `AppModule`; individual endpoints may enforce a stricter limit. |
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

### SMS (Termii)

| Variable            | Default                        | Description                                                    |
|---------------------|---------------------------------|------------------------------------------------------------------|
| `TERMII_API_KEY`    | — *(optional)*                  | Termii API key                                                    |
| `TERMII_SENDER_ID`  | — *(optional)*                  | Termii sender ID shown as the SMS "from" name                    |
| `TERMII_BASE_URL`   | `https://api.ng.termii.com`     | Termii API base URL                                               |

---

## 11. Enum Reference

### MemberRoleEnum

`MEMBER` · `WORKER`

Admin portal access is not a member role — it is managed via the `Admin` entity and `AdminRole`.

### AdminPermission

Granular permissions assigned to `AdminRole` records:

`members:read` · `members:write` · `events:read` · `events:write` · `venues:read` · `venues:write` ·
`departments:read` · `departments:write` · `attendance:read` · `attendance:write` · `leave:read` · `leave:write` · `classes:read` ·
`classes:write` · `announcements:read` · `announcements:write` · `notes:read` · `notes:write` · `dashboard:read` ·
`sunday_school:read` · `sunday_school:write` · `children_church:read` · `children_church:write` · `admin:read` ·
`admin:write` · `audit:read` · `finance:read` · `finance:write` · `follow_up:read` · `follow_up:write` ·
`service_programme:read` · `service_programme:write` · `headcount:read` · `headcount:write` ·
`prayer:read` · `prayer:write` · `sms:read` · `sms:send`

`GET /enums` returns these as both a flat `adminPermissions` list (value + label) and a grouped `adminPermissionGroups` list (group name + permissions with value, label, and description) — use the grouped form to render the permission assignment UI. `sms:read`/`sms:send` are grouped under "SMS Messaging".

### PastorTypeEnum

`LEAD` · `PARISH` · `ASSOCIATE`

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

`ALL` · `WORKERS_ONLY` · `MEMBERS_ONLY` · `DEPARTMENT` · `INDIVIDUAL` · `GROUP`

### NoteTypeEnum *(path param values)*

`child_naming` · `child_dedication` · `marriage`

### EventRecurrencePatternEnum

`daily` · `weekly` · `monthly`

### OrderBy (Events)

`eventDate` · `createdAt` · `updatedAt`

### DepartmentKeyEnum

Access-control categories for department-gated modules. A department's `key` field uses one of these values (or is null
if the department is not linked to any gated module). Multiple departments can share the same key.

`SUNDAY_SCHOOL` · `CHILDREN_CHURCH` · `WORSHIP` · `USHERING` · `MEDIA` · `PROTOCOL` · `WELFARE` · `PRAYER` · `EVANGELISM` · `YOUTH` · `YOUNG_ADULTS` · `FOLLOW_UP`

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

### DepartmentKeyEnum (updated)

`SUNDAY_SCHOOL` · `CHILDREN_CHURCH` · `WORSHIP` · `USHERING` · `MEDIA` · `PROTOCOL` · `WELFARE` · `PRAYER` · `EVANGELISM` · `YOUTH` · `YOUNG_ADULTS` · `FOLLOW_UP` · `ADMIN`

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
