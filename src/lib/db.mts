// Database access. In production this is Netlify DB (Postgres, auto-provisioned).
// In tests (COACH_DB=pglite) it's an in-process Postgres so the SQL is exercised for real.
type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>;
let _sql: SqlTag | undefined;

export function db(): { sql: SqlTag } {
  if (!_sql) throw new Error('db not initialised — call initDb() first');
  return { sql: _sql };
}

let _init: Promise<void> | undefined;
export function initDb(): Promise<void> {
  return (_init ??= (async () => {
    if (process.env.COACH_DB === 'pglite') {
      const { PGlite } = await import('@electric-sql/pglite');
      const pg = new PGlite();
      const { readFileSync, readdirSync } = await import('node:fs');
      const dir = new URL('../../netlify/database/migrations/', import.meta.url);
      for (const d of readdirSync(dir).sort()) await pg.exec(readFileSync(new URL(`${d}/migration.sql`, dir), 'utf8'));
      _sql = async (strings, ...values) => {
        let text = ''; strings.forEach((s, i) => { text += s; if (i < values.length) text += `$${i + 1}`; });
        const r = await pg.query(text, values.map(v => v === undefined ? null : v));
        return r.rows as any[];
      };
    } else {
      const { getDatabase } = await import('@netlify/database');
      const d = getDatabase();
      _sql = (strings, ...values) => d.sql(strings, ...values) as unknown as Promise<any[]>;
    }
  })());
}

export async function getSetting<T = unknown>(key: string, fallback: T): Promise<T> {
  await initDb();
  const rows = await db().sql`SELECT value FROM settings WHERE key = ${key}`;
  return rows.length ? (rows[0].value as T) : fallback;
}
export async function setSetting(key: string, value: unknown) {
  await initDb();
  await db().sql`INSERT INTO settings (key, value) VALUES (${key}, ${JSON.stringify(value)}::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}
