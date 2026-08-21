import Dexie, { type EntityTable } from 'dexie';
import type { StoredCard, Encounter } from '../schema/card';

interface ReviewRow {
  lemma: string;
  due_at: number;
  stability: number;
  difficulty: number;
  last_grade: number;
}

export const db = new Dexie('lexicon') as Dexie & {
  cards: EntityTable<StoredCard, 'lemma'>;
  encounters: EntityTable<Encounter, 'id'>;
  review: EntityTable<ReviewRow, 'lemma'>;
};

db.version(1).stores({
  cards: 'lemma, created_at, pos, connotation, *rootParts',
  encounters: '++id, lemma, captured_at',
  // Created empty and unused in v1 so FSRS can drop in without a migration.
  review: 'lemma, due_at, stability, difficulty, last_grade',
});

// v2 adds updated_at to the index so sync can ask for "everything changed since
// X" without scanning, and backfills deleted_at on rows written before soft
// deletes existed.
db.version(2)
  .stores({
    cards: 'lemma, created_at, updated_at, pos, connotation, *rootParts',
    encounters: '++id, lemma, captured_at',
    review: 'lemma, due_at, stability, difficulty, last_grade',
  })
  .upgrade((tx) =>
    tx
      .table('cards')
      .toCollection()
      .modify((card) => {
        if (card.deleted_at === undefined) card.deleted_at = null;
      })
  );

/** Set when IndexedDB is unavailable or over quota, so the UI can warn instead of crashing. */
export let storageBroken: string | null = null;

export function markStorageBroken(reason: string) {
  storageBroken = reason;
}
