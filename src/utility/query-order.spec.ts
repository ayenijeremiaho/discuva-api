import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// TypeORM throws "Cannot read properties of undefined (reading 'databaseName')" when a query with a join and
// take()/skip() orders by a column name (c.created_at): it re-orders a distinct-id subquery that only maps properties.
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === 'migrations' ? [] : files(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });

describe('query builders with a join and a row limit', () => {
  it('order by property names, never column names', () => {
    const offenders: string[] = [];
    for (const file of files(join(__dirname, '..'))) {
      const source = readFileSync(file, 'utf8');
      // From each query builder to the call that runs it (a built-up qb is often run a few lines later).
      for (const { index: start } of source.matchAll(/createQueryBuilder\(/g)) {
        const next = source.indexOf('createQueryBuilder(', start + 1);
        const rest = source.slice(
          start,
          next === -1 ? start + 4000 : Math.min(next, start + 4000),
        );
        const end = rest.search(
          /\.(getMany|getManyAndCount|getOne|getOneOrFail|getRawMany|getRawOne|getRawAndEntities|getCount|stream)\(/,
        );
        const statement = end === -1 ? rest : rest.slice(0, end);
        if (!/\.(take|skip)\(/.test(statement) || !/Join/.test(statement))
          continue;
        const raw = statement.match(/\.(?:add)?[oO]rderBy\(\s*'\w+\.\w*_\w*'/g);
        if (raw) offenders.push(`${file.split('/src/')[1]}: ${raw.join(', ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
