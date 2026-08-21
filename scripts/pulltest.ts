import 'dotenv/config';
import { handleSync } from '../api/syncHandler.js';

const headers = { 'x-app-secret': process.env.APP_SECRET };

// A card generated hours ago, pushed to the server right now.
const old = Date.now() - 5 * 60 * 60 * 1000;
await handleSync(
  { since: 0, cards: [{ lemma: '__pulltest', updated_at: old, deleted_at: null, simple: 'old card' }] },
  headers
);

// A device that last synced one minute ago asks what changed.
const deviceSyncedAt = Date.now() - 60 * 1000;
const res = (await handleSync({ since: deviceSyncedAt, cards: [] }, headers)) as {
  body: { cards: Array<{ lemma: string }> };
};
const got = res.body.cards.some((c) => c.lemma === '__pulltest');
console.log(`card generated 5h ago, uploaded now, device synced 1min ago:`);
console.log(`  device receives it: ${got ? 'YES — fixed' : 'NO — still broken'}`);
