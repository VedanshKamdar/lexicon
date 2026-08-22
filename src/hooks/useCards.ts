import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import type { StoredCard, Encounter } from '../schema/card';

export function useCards(): StoredCard[] | undefined {
  return useLiveQuery(
    () =>
      db.cards
        .orderBy('created_at')
        .reverse()
        .filter((c) => !c.deleted_at)
        .toArray(),
    []
  );
}

/**
 * Live view of one card. The lookup hook reads storage once and holds a snapshot,
 * so a card left open goes stale the moment sync pulls a newer copy — or another
 * tab edits it. Reading through Dexie's live query keeps what is on screen equal
 * to what is stored.
 */
export function useCard(lemma: string | null): StoredCard | undefined {
  return useLiveQuery(
    (): Promise<StoredCard | undefined> =>
      lemma ? db.cards.get(lemma) : Promise.resolve(undefined),
    [lemma]
  );
}

export function useEncounters(lemma: string | null): Encounter[] {
  return (
    useLiveQuery(
      (): Promise<Encounter[]> =>
        lemma ? db.encounters.where('lemma').equals(lemma).toArray() : Promise.resolve([]),
      [lemma]
    ) ?? []
  );
}
