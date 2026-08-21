/**
 * Verifies the Turso connection and the merge rules, without touching the app.
 * Run after filling TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env:
 *
 *   npx tsx scripts/sync.ts
 */
import 'dotenv/config';
import { handleSync } from '../api/syncHandler.js';

if (!process.env.TURSO_DATABASE_URL) {
  console.error('Add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to .env first.');
  process.exit(1);
}

const headers = { 'x-app-secret': process.env.APP_SECRET };
const call = (body: unknown) => handleSync(body, headers);

const probe = `__selftest_${Date.now()}`;
const t0 = Date.now();

// 1. Push a card.
const push = await call({
  since: 0,
  cards: [{ lemma: probe, updated_at: t0, deleted_at: null, simple: 'first write' }],
});
console.log(`push          HTTP ${push.status}`);
if (push.status !== 200) {
  console.error(push.body);
  process.exit(1);
}

// 2. A stale write must NOT overwrite a fresher one.
await call({
  since: 0,
  cards: [{ lemma: probe, updated_at: t0 - 5000, deleted_at: null, simple: 'STALE — must lose' }],
});
const afterStale = (await call({ since: t0 - 1 })) as { body: { cards: any[] } };
const row = afterStale.body.cards.find((c) => c.lemma === probe);
console.log(
  `stale write   ${row?.simple === 'first write' ? 'correctly ignored' : `LOST — got "${row?.simple}"`}`
);

// 3. A newer write must win.
await call({
  since: 0,
  cards: [{ lemma: probe, updated_at: t0 + 5000, deleted_at: null, simple: 'second write' }],
});
const afterFresh = (await call({ since: t0 - 1 })) as { body: { cards: any[] } };
const row2 = afterFresh.body.cards.find((c) => c.lemma === probe);
console.log(`newer write   ${row2?.simple === 'second write' ? 'correctly applied' : 'FAILED'}`);

// 4. A tombstone must propagate.
await call({
  since: 0,
  cards: [{ lemma: probe, updated_at: t0 + 9000, deleted_at: t0 + 9000, simple: 'second write' }],
});
const afterDelete = (await call({ since: t0 - 1 })) as { body: { cards: any[] } };
const row3 = afterDelete.body.cards.find((c) => c.lemma === probe);
console.log(`tombstone     ${row3?.deleted_at ? 'propagated' : 'FAILED — no deleted_at'}`);

// 5. "Changes since now" must be empty.
const empty = (await call({ since: Date.now() + 60000 })) as { body: { cards: any[] } };
console.log(`since filter  ${empty.body.cards.length === 0 ? 'returns nothing, as expected' : 'FAILED'}`);

console.log(`\nProbe row left behind as ${probe} — delete it from Turso if you care.`);
