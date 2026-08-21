/** Shows what is actually in the remote store. */
import 'dotenv/config';
import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const cards = await db.execute('SELECT lemma, updated_at, deleted_at FROM cards ORDER BY lemma');
console.log(`cards on server: ${cards.rows.length}`);
for (const r of cards.rows) {
  console.log(`  ${String(r.lemma).padEnd(16)} ${r.deleted_at ? 'TOMBSTONE' : 'live'}`);
}
const enc = await db.execute('SELECT id, lemma FROM encounters');
console.log(`encounters: ${enc.rows.length}`);
for (const r of enc.rows) console.log(`  ${r.lemma}`);
