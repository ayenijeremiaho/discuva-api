import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { TenantProvisioningService } from './tenant/service/tenant-provisioning.service';

// Run during every production deployment (docs/MULTI_TENANT_MIGRATION.md
// §4.9). Bounded concurrency — schemas are lock-independent so migrating
// several at once is safe, but unbounded parallelism risks exhausting
// Postgres max_connections at real tenant counts.
//
// Fail-fast means "the script alerts loudly and exits non-zero if any
// tenant failed," not "abort mid-flight" — letting already-running
// migrations finish is safer than cutting one off partway through. No
// separate tenant_migration_runs log table yet: TypeORM's own per-schema
// migrations table already makes each run idempotent and resumable simply
// by re-running the script, which covers correctness; the log table is an
// observability nice-to-have deferred until there's a real fleet of
// tenants to watch.
const CONCURRENCY = 8;

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  // Booting AppModule also fires unrelated onApplicationBootstrap hooks
  // (BirthdayService, MembershipAnniversaryService) that kick off their own
  // startup catch-up work in the background, not awaited by Nest. Those
  // hooks use this app's own fire-and-forget cache calls (CacheService
  // conventions), so a graceful app.close() here can tear down the Redis
  // connection while one of them is still mid-flight — an unhandled
  // rejection from a dangling call ("Connection is closed") then kills this
  // process even though tenant migrations already succeeded. This script's
  // job is done once migrations finish, so skip the graceful shutdown
  // entirely and hard-exit instead of calling app.close().
  const dataSource = app.get(DataSource);
  const provisioningService = app.get(TenantProvisioningService);

  const tenants: { subdomain: string; schema_name: string }[] =
    await dataSource.query(
      `SELECT subdomain, schema_name FROM tenants WHERE is_active = true ORDER BY created_at`,
    );

  console.log(`Migrating ${tenants.length} active tenant schema(s)...`);

  let cursor = 0;
  const failures: { subdomain: string; error: unknown }[] = [];

  async function worker() {
    while (cursor < tenants.length) {
      const tenant = tenants[cursor++];
      try {
        await provisioningService.runTenantMigrations(tenant.schema_name);
        console.log(`  ✓ ${tenant.subdomain}`);
      } catch (error) {
        console.error(`  ✗ ${tenant.subdomain}:`, error);
        failures.push({ subdomain: tenant.subdomain, error });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, tenants.length) }, worker),
  );

  if (failures.length) {
    console.error(
      `\n${failures.length}/${tenants.length} tenant migration(s) failed: ${failures
        .map((f) => f.subdomain)
        .join(', ')}`,
    );
    process.exit(1);
  }

  console.log(`\nAll ${tenants.length} tenant schema(s) up to date.`);
  process.exit(0);
}

bootstrap().catch((err) => {
  console.error('migrate-all-tenants failed:', err);
  process.exit(1);
});
