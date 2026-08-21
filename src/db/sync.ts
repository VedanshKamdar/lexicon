import { db, markStorageBroken } from './schema';
import { StoredCardSchema, type StoredCard, type Encounter } from '../schema/card';
import { apiHeaders } from '../api/headers';

const LAST_SYNC_KEY = 'lexicon:lastSync';

/** Thrown when the deployment has no Turso credentials — local-only, not a fault. */
export class SyncDisabled extends Error {}

export function lastSyncAt(): number {
  const raw = localStorage.getItem(LAST_SYNC_KEY);
  return raw ? Number(raw) || 0 : 0;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  at: number;
}

/**
 * Push everything changed locally since the last sync, pull everything changed
 * remotely, and merge newest-wins per word on updated_at — the same rule the
 * server and the backup restore use, so the three can never disagree.
 *
 * IndexedDB stays the source of truth locally: sync is additive and the app
 * keeps working with no network at all.
 */
export async function sync(): Promise<SyncResult> {
  const since = lastSyncAt();

  // Tombstones must be pushed too, or a deletion never reaches the other device.
  const localChanges = await db.cards.where('updated_at').above(since).toArray();
  const localEncounters = await db.encounters.where('captured_at').above(since).toArray();

  const res = await fetch('/api/sync', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({
      since,
      cards: localChanges,
      encounters: localEncounters.map(({ id: _id, ...rest }) => rest),
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (res.status === 503) throw new SyncDisabled(payload?.error ?? 'Sync is not configured.');
  if (!res.ok) throw new Error(payload?.error ?? `Sync returned ${res.status}`);

  const incoming: StoredCard[] = [];
  for (const raw of payload.cards ?? []) {
    // Never trust the wire — a malformed card in the store is worse than no sync.
    const parsed = StoredCardSchema.safeParse(raw);
    if (parsed.success) incoming.push(parsed.data);
  }

  let pulled = 0;
  try {
    await db.transaction('rw', db.cards, db.encounters, async () => {
      const toWrite: StoredCard[] = [];
      for (const card of incoming) {
        const existing = await db.cards.get(card.lemma);
        if (!existing || card.updated_at > existing.updated_at) toWrite.push(card);
      }
      if (toWrite.length) await db.cards.bulkPut(toWrite);
      pulled = toWrite.length;

      const known = new Set(
        (await db.encounters.toArray()).map((e) => `${e.lemma} ${e.sentence}`)
      );
      const fresh: Encounter[] = (payload.encounters ?? [])
        .filter(
          (e: Encounter) => e?.lemma && e?.sentence && !known.has(`${e.lemma} ${e.sentence}`)
        )
        .map((e: Encounter) => ({
          lemma: e.lemma,
          sentence: e.sentence,
          source: e.source ?? null,
          captured_at: e.captured_at,
        }));
      if (fresh.length) await db.encounters.bulkAdd(fresh);
    });
  } catch (e) {
    markStorageBroken((e as Error).message);
    throw e;
  }

  const at = Number(payload.now) || Date.now();
  localStorage.setItem(LAST_SYNC_KEY, String(at));

  return { pushed: localChanges.length, pulled, at };
}
