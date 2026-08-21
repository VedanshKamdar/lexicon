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

export function useEncounters(lemma: string | null): Encounter[] {
  return (
    useLiveQuery(
      (): Promise<Encounter[]> =>
        lemma ? db.encounters.where('lemma').equals(lemma).toArray() : Promise.resolve([]),
      [lemma]
    ) ?? []
  );
}
