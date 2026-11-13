# Export configuration review — 2026-11-13

The configuration stores two rows per tenant in `church_settings`, keyed by
`member-export:members` and `member-export:workers`. It stores field choices,
not member records. All operations use tenant-scoped repositories.

| Operation | Database work | Index |
| --- | --- | --- |
| Read | Select only `value` where `key = :key`, limit 1; skipped on cache hit | `uq_church_settings_key` |
| Create / update | Atomic INSERT … ON CONFLICT (`key`) DO UPDATE | `uq_church_settings_key` conflict arbiter |
| Reset to core fields | Save `{ fields: [] }` through the same upsert | Same unique index |

There is no delete endpoint. Resetting the configuration stores an empty optional
field selection. Required columns are always included. Read requires MEMBERS_READ;
save/reset requires MEMBERS_WRITE. Saves emit CHURCH_SETTING_UPDATED audit events.
No new table, index, migration, polling or scheduler is required.

The unique B-tree index exists in the tenant genesis migration:
`1790726400000-TenantSchemaGenesis.ts`, constraint `uq_church_settings_key UNIQUE (key)`.
The entity also declares `key` unique. A separate redundant index would add write
and storage cost without helping these queries.

The cache uses the existing tenant-scoped CacheService with a 300-second TTL.
Save invalidates only the relevant member/worker key. A cache miss costs one
indexed settings query; a save costs one settings upsert plus the existing audit
record. Email export reads defaults only if the request omits explicit fields.
There are no member joins, count queries or N+1 queries in configuration reads.

## Local PostgreSQL plan verification

Verified in a disposable PostgreSQL 15 container using the table and unique
constraint extracted directly from the migration, 10,000 synthetic settings and
two sample export configurations. Production data was not accessed. The container
was removed after verification. These are local plan checks, not production
latency benchmarks.

Read plan:

```text
Limit
  -> Index Scan using uq_church_settings_key on church_settings
       Index Cond: ((key)::text = 'member-export:members'::text)
       Buffers: shared hit=3
```

Upsert plan:

```text
Insert on church_settings
  Conflict Resolution: UPDATE
  Conflict Arbiter Indexes: uq_church_settings_key
  Tuples Inserted: 0
  Conflicting Tuples: 1
```

Updating worker fields preserved the separate member configuration. For a tiny
settings table PostgreSQL may reasonably prefer a sequential scan; the matching
index exists and is used when table size warrants it.

## Portal UI verification

The export dialog uses the portal's brand, surface, foreground, muted and border
variables, including the Send button, selected checkboxes and default-setting
actions. The dialog supports light/dark appearance and existing portal colors.
Its header and Send footer stay visible while the content scrolls. Phone layouts
use one field column; desktop uses two. Recipient has an associated label and
native email validation. The dialog has an accessible name, traps keyboard focus,
closes on Escape, restores focus to its trigger and prevents closing while an
email request is being queued. Shared settings remain independent for members
and workers. Browser checks use mocked APIs and fictional records.
