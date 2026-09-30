import { DataSource } from 'typeorm';

const VALID_SCHEMA_NAME = /^[a-z_][a-z0-9_]*$/;

// Schema-qualified read: fire-and-forget sends run after the caller's tenant transaction has closed, when repositories fall back to public.
export async function queryTenant<T>(
  dataSource: DataSource,
  schemaName: string | undefined,
  sql: (schema: string) => string,
  params: unknown[] = [],
): Promise<T[]> {
  if (!schemaName || !VALID_SCHEMA_NAME.test(schemaName)) return [];
  return dataSource.query(sql(`"${schemaName}"`), params);
}
