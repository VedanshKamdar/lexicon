/** Removes rows left behind by scripts/sync.ts self-tests. */
import 'dotenv/config';
import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const before = await db.execute('SELECT lemma FROM cards');
console.log('rows before:', before.rows.map((r) => String(r.lemma)).join(', ') || '(none)');

const removed = await db.execute("DELETE FROM cards WHERE lemma LIKE '__selftest_%'");
console.log('probe rows deleted:', removed.rowsAffected);

const after = await db.execute('SELECT lemma FROM cards');
console.log('rows after :', after.rows.map((r) => String(r.lemma)).join(', ') || '(none)');
