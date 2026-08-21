import { db, markStorageBroken } from './schema';
import type { StoredCard, Encounter, GeneratedCard } from '../schema/card';

export function normalize(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z'-]/g, '');
}

export async function getCard(lemma: string): Promise<StoredCard | undefined> {
  try {
    const card = await db.cards.get(lemma);
    return card?.deleted_at ? undefined : card;
  } catch (e) {
    markStorageBroken((e as Error).message);
    return undefined;
  }
}

export function toStoredCard(
  lemma: string,
  generated: GeneratedCard,
  audio: string | null,
  lowConfidence: boolean
): StoredCard {
  const now = Date.now();
  return {
    ...generated,
    lemma,
    audio_url: audio,
    low_confidence: lowConfidence,
    created_at: now,
    updated_at: now,
    user_edited: false,
    view_count: 0,
    last_viewed_at: null,
    deleted_at: null,
    rootParts: generated.roots.map((r) => r.part),
  };
}

export async function saveCard(card: StoredCard): Promise<void> {
  try {
    await db.cards.put(card);
  } catch (e) {
    markStorageBroken((e as Error).message);
  }
}

export async function updateCard(lemma: string, patch: Partial<StoredCard>): Promise<void> {
  try {
    await db.cards.update(lemma, { ...patch, updated_at: Date.now() });
  } catch (e) {
    markStorageBroken((e as Error).message);
  }
}

/**
 * Soft delete: the row stays as a tombstone so sync can propagate the deletion.
 * A hard delete would be undone by the next merge from a device that still has
 * the card. Encounters go with it, since they are meaningless without the card.
 */
export async function deleteCard(lemma: string): Promise<void> {
  const now = Date.now();
  try {
    await db.transaction('rw', db.cards, db.encounters, async () => {
      await db.cards.update(lemma, { deleted_at: now, updated_at: now });
      await db.encounters.where('lemma').equals(lemma).delete();
    });
  } catch (e) {
    markStorageBroken((e as Error).message);
  }
}

/**
 * Bumped on every card open — feeds the "cards revisited" metric and decides
 * whether the card opens covered for recall practice. Returns the new count.
 */
export async function recordView(lemma: string): Promise<number> {
  try {
    const card = await db.cards.get(lemma);
    if (!card) return 0;
    const view_count = card.view_count + 1;
    await db.cards.update(lemma, { view_count, last_viewed_at: Date.now() });
    return view_count;
  } catch {
    /* view tracking is best-effort; never block a read on it */
    return 0;
  }
}

export async function addEncounter(
  lemma: string,
  sentence: string,
  source: string | null
): Promise<void> {
  try {
    await db.encounters.add({ lemma, sentence, source, captured_at: Date.now() });
  } catch (e) {
    markStorageBroken((e as Error).message);
  }
}

export function encountersFor(lemma: string): Promise<Encounter[]> {
  return db.encounters.where('lemma').equals(lemma).toArray().catch(() => []);
}
