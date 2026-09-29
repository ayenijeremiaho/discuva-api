import { DataSource } from 'typeorm';
import type { CountryCode } from 'libphonenumber-js';
import dbConfig from './config/db.config';
import {
  normalizePhoneNumber,
  phoneRegionFromLocale,
} from './utility/decorators/normalize-phone.decorator';

// One-off backfill: rewrites stored phone numbers to E.164. Dry run unless --apply.
const PHONE_COLUMNS: { table: string; column: string }[] = [
  { table: 'members', column: 'phone_number' },
  { table: 'group_members', column: 'phone_number' },
  { table: 'child_guardians', column: 'phone_number' },
  { table: 'first_timers', column: 'phone' },
  { table: 'converts', column: 'phone' },
  { table: 'guests', column: 'phone' },
];

const UNIQUE_VIOLATION = '23505';

interface Issue {
  table: string;
  id: string;
  value: string;
  reason: string;
}

interface Context {
  dataSource: DataSource;
  schema: string;
  region: CountryCode;
  apply: boolean;
}

async function groupMemberClash(
  { dataSource, schema }: Context,
  id: string,
  normalized: string,
): Promise<boolean> {
  const rows = await dataSource.query(
    `SELECT 1 FROM ${schema}.group_members g
     WHERE g.phone_number = $1 AND g.id <> $2
       AND g.group_id = (SELECT group_id FROM ${schema}.group_members WHERE id = $2)
     LIMIT 1`,
    [normalized, id],
  );
  return rows.length > 0;
}

// Returns an issue reason, or null if the row was (or would be) updated.
async function normalizeRow(
  ctx: Context,
  table: string,
  column: string,
  id: string,
  normalized: string,
): Promise<string | null> {
  const duplicate = `duplicate of existing ${normalized}`;
  if (!ctx.apply) {
    const clash =
      table === 'group_members' &&
      (await groupMemberClash(ctx, id, normalized));
    return clash ? duplicate : null;
  }
  try {
    await ctx.dataSource.query(
      `UPDATE ${ctx.schema}.${table} SET ${column} = $1 WHERE id = $2`,
      [normalized, id],
    );
    return null;
  } catch (error) {
    if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
    return duplicate;
  }
}

async function normalizeColumn(
  ctx: Context,
  table: string,
  column: string,
  issues: Issue[],
): Promise<number> {
  const [{ exists }] = await ctx.dataSource.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`${ctx.schema}.${table}`],
  );
  if (!exists) return 0;

  const rows: { id: string; value: string }[] = await ctx.dataSource.query(
    `SELECT id, ${column} AS value FROM ${ctx.schema}.${table} WHERE ${column} IS NOT NULL AND ${column} <> ''`,
  );

  let changed = 0;
  for (const { id, value } of rows) {
    const normalized = normalizePhoneNumber(value, ctx.region);
    if (normalized === value) continue;

    const reason = normalized
      ? await normalizeRow(ctx, table, column, id, normalized)
      : 'invalid';
    if (reason) issues.push({ table, id, value, reason });
    else changed++;
  }
  return changed;
}

async function bootstrap() {
  const apply = process.argv.includes('--apply');
  const region = phoneRegionFromLocale(process.env.CURRENCY_LOCALE);

  const dataSource = new DataSource({
    ...dbConfig(),
    entities: [],
    migrations: [],
    migrationsRun: false,
    poolSize: 1,
    extra: { ...(dbConfig().extra as object), max: 1, min: 0 },
  });
  await dataSource.initialize();

  const tenants: { subdomain: string; schema_name: string }[] =
    await dataSource.query(
      `SELECT subdomain, schema_name FROM tenants WHERE is_active = true ORDER BY created_at`,
    );

  console.log(
    `${apply ? 'APPLYING' : 'DRY RUN'} — ${tenants.length} tenant(s), default region ${region}\n`,
  );

  let totalChanged = 0;
  let totalIssues = 0;

  for (const tenant of tenants) {
    const ctx: Context = {
      dataSource,
      schema: `"${tenant.schema_name.replaceAll('"', '""')}"`,
      region,
      apply,
    };
    const issues: Issue[] = [];
    let changed = 0;
    for (const { table, column } of PHONE_COLUMNS) {
      changed += await normalizeColumn(ctx, table, column, issues);
    }

    totalChanged += changed;
    totalIssues += issues.length;
    console.log(
      `  ${tenant.subdomain}: ${changed} ${apply ? 'updated' : 'to update'}, ${issues.length} need review`,
    );
    for (const i of issues) {
      console.log(`    ${i.table} ${i.id}: "${i.value}" — ${i.reason}`);
    }
  }

  console.log(
    `\n${totalChanged} number(s) ${apply ? 'updated' : 'would be updated'}, ${totalIssues} need manual review.${apply ? '' : ' Re-run with --apply to write.'}`,
  );
  await dataSource.destroy();
}

bootstrap().catch((err) => {
  console.error('normalize-tenant-phones failed:', err);
  process.exit(1);
});
