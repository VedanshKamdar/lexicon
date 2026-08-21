import 'dotenv/config';
import { createClient } from '@libsql/client';
const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
for (const table of ['cards', 'encounters']) {
  const before = await db.execute(`PRAGMA table_info(${table})`);
  const has = before.rows.some((r) => String(r.name) === 'written_at');
  console.log(`${table}: written_at ${has ? 'already present' : 'missing'}`);
  if (!has) {
    try {
      await db.execute(`ALTER TABLE ${table} ADD COLUMN written_at INTEGER NOT NULL DEFAULT 0`);
      console.log(`  ALTER ok`);
    } catch (e) {
      console.log(`  ALTER FAILED: ${(e as Error).message}`);
      continue;
    }
  }
  const r = await db.execute({
    sql: `UPDATE ${table} SET written_at = ? WHERE written_at = 0`,
    args: [Date.now()],
  });
  console.log(`  backfilled ${r.rowsAffected} rows`);
}
