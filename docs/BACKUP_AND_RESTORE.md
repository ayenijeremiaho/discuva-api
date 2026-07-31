# Backup & Restore

This app has no application-level backup mechanism — data durability is entirely a database-operations concern.
There was previously no documented strategy at all; this fills that gap.

## What needs backing up

- **PostgreSQL** — the only system of record. Everything (members, finance, attendance, games, etc.) lives here.
  This is the one thing a launch cannot go live without a backup plan for.
- **Redis** — cache + session/lock/queue (Bull) state only. Nothing here is the source of truth; a full Redis
  flush is recoverable (caches repopulate, in-flight jobs are re-enqueued by their own retry logic where it
  matters). Not a backup target.
- **Cloudinary** (profile photos, finance proof-of-payment attachments, incident report media) — hosted by
  Cloudinary itself; their own retention/durability applies. Not this app's responsibility.
- **`.env` secrets** — not "backed up" via the DB, but losing the JWT signing secrets, DB credentials, or webhook
  HMAC secrets (Paystack/Flutterwave/YouTube) is an outage on its own. Keep these in a password manager or your
  hosting provider's secret store, not only on the one server.

## Recommended strategy

**If Postgres is a managed service (RDS, Cloud SQL, Render/Railway managed Postgres, etc.):** turn on the
provider's automated daily snapshots with point-in-time recovery (PITR) if offered, and set a retention window —
30 days is a reasonable default for a church-records system (financial records in particular benefit from a longer
window than the provider's default 7 days). This is almost always less error-prone than a self-rolled script, since
the provider handles consistency and storage. **Confirm this is actually turned on** — a managed DB does not
guarantee backups are enabled by default on every plan tier.

**If Postgres is self-hosted (a Docker container, a bare VM, etc. — no managed backup layer):** you need a
scripted `pg_dump` on a schedule, shipped off the host it runs on (a local-disk-only backup is not a backup — it
dies with the same disk the primary DB does).

```bash
# Nightly, from a host that has network access to postgres but isn't postgres itself:
pg_dump \
  --host="$DATABASE_HOST" --port="$DATABASE_PORT" \
  --username="$DATABASE_USER" --dbname="$DATABASE_NAME" \
  --format=custom --file="discovery-hub-$(date +%Y%m%d).dump"

# Ship it off-host immediately after — e.g. to S3/GCS/Backblaze:
# aws s3 cp discovery-hub-$(date +%Y%m%d).dump s3://your-backup-bucket/postgres/

# Prune anything older than 30 days on the remote store.
```

Run this on a cron/scheduled-task platform independent of the app server (a CI scheduled job, a separate small VM,
or the storage provider's own scheduled-backup feature if using a managed bucket) — a backup script that only runs
"when the app server happens to be up" isn't a reliable backup.

## Restore

```bash
pg_restore \
  --host="$DATABASE_HOST" --port="$DATABASE_PORT" \
  --username="$DATABASE_USER" --dbname="$DATABASE_NAME" \
  --clean --if-exists \
  discovery-hub-20260101.dump
```

`--clean --if-exists` drops existing objects before recreating them, so this is safe to run against an empty or
already-populated database (e.g. restoring into a fresh instance during a disaster-recovery drill).

**After any restore, run `npm run migration:show`** to confirm the restored schema's migration history lines up
with what's in `src/migrations/` — a backup taken before a migration shipped will be missing it, and
`migrationsRun: true` (see `src/config/db.config.ts`) will apply anything outstanding automatically on the next
app boot, but it's worth confirming explicitly for anything with a manual data-migration component.

## Restore drills

A backup that has never been restored is unverified. At minimum, before the first production launch and then on
some recurring cadence (quarterly is a reasonable starting point), actually restore the latest backup into a
throwaway database and confirm:
- the restore completes without error
- `npm run migration:show` reports a clean, fully-applied state
- the app boots against the restored DB and `/health` returns `200`

## Point-in-time recovery (PITR)

A daily/nightly snapshot only protects against total loss — it doesn't help recover from "an admin fat-fingered a
bulk delete at 2pm today." If the hosting provider offers WAL-based PITR (most managed Postgres offerings do), turn
it on — it's what actually answers "can we get back to 1:59pm today" rather than just "can we get back to last
night."
