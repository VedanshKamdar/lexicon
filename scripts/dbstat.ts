import 'dotenv/config';
import { createClient } from '@libsql/client';
const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const tables = await db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
console.log('tables:', tables.rows.map((r) => String(r.name)).join(', '));
for (const t of ['cards', 'encounters']) {
  const c = await db.execute(`SELECT COUNT(*) n FROM ${t}`);
  console.log(`  ${t}: ${c.rows[0].n} rows`);
}
const bytes = await db.execute('SELECT SUM(LENGTH(payload)) b FROM cards');
console.log('payload bytes:', bytes.rows[0].b);
