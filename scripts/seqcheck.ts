import 'dotenv/config';
import { createClient } from '@libsql/client';
const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const n = await db.execute('SELECT COUNT(*) c FROM cards');
console.log('cards on server:', n.rows[0].c);
const r = await db.execute('SELECT MIN(updated_at) lo, MAX(updated_at) hi FROM cards');
console.log('updated_at range:', new Date(Number(r.rows[0].lo)).toISOString(), '->', new Date(Number(r.rows[0].hi)).toISOString());
console.log('now             :', new Date().toISOString());
const cols = await db.execute("PRAGMA table_info(cards)");
console.log('columns:', cols.rows.map((c) => String(c.name)).join(', '));
