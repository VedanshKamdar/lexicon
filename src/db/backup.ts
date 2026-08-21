import { z } from 'zod';
import { db, markStorageBroken } from './schema';
import { resetSyncMarker } from './sync';
import { StoredCardSchema, type StoredCard, type Encounter } from '../schema/card';

const BACKUP_VERSION = 1;

const EncounterSchema = z.object({
  id: z.number().optional(),
  lemma: z.string(),
  sentence: z.string(),
  source: z.string().nullable(),
  captured_at: z.number(),
});

const BackupSchema = z.object({
  version: z.number(),
  exported_at: z.number(),
  cards: z.array(StoredCardSchema),
  encounters: z.array(EncounterSchema),
});

export type Backup = z.infer<typeof BackupSchema>;

/**
 * Tombstones are included deliberately. Restoring a backup onto a device that
 * still holds a deleted word must delete it there too, otherwise the restore
 * resurrects words you removed on purpose.
 */
export async function buildBackup(): Promise<Backup> {
  const [cards, encounters] = await Promise.all([
    db.cards.toArray(),
    db.encounters.toArray(),
  ]);
  return { version: BACKUP_VERSION, exported_at: Date.now(), cards, encounters };
}

function filename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `lexicon-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

export async function downloadBackup(): Promise<number> {
  const backup = await buildBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick; revoking synchronously can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return backup.cards.filter((c) => !c.deleted_at).length;
}

export interface RestoreResult {
  added: number;
  updated: number;
  skipped: number;
  encounters: number;
}

/**
 * Merges a backup into the local store, newest-wins per word on updated_at.
 * The same rule the server merge uses, so a restore and a sync cannot disagree.
 */
export async function restoreBackup(json: string): Promise<RestoreResult> {
  const parsed = BackupSchema.safeParse(JSON.parse(json));
  if (!parsed.success) {
    throw new Error('That file is not a Lexicon backup, or it is from a newer version.');
  }

  const backup = parsed.data;
  const result: RestoreResult = { added: 0, updated: 0, skipped: 0, encounters: 0 };

  try {
    await db.transaction('rw', db.cards, db.encounters, async () => {
      const incoming: StoredCard[] = [];

      for (const card of backup.cards) {
        const existing = await db.cards.get(card.lemma);
        if (!existing) {
          incoming.push(card);
          result.added++;
        } else if (card.updated_at > existing.updated_at) {
          incoming.push(card);
          result.updated++;
        } else {
          result.skipped++;
        }
      }

      if (incoming.length) await db.cards.bulkPut(incoming);

      // Encounters carry auto-increment ids that will collide across devices, so
      // match on content instead and drop the incoming id.
      const known = new Set(
        (await db.encounters.toArray()).map((e) => `${e.lemma}\u0000${e.sentence}`)
      );
      const fresh: Encounter[] = backup.encounters
        .filter((e) => !known.has(`${e.lemma}\u0000${e.sentence}`))
        .map(({ id: _id, ...rest }) => rest);

      if (fresh.length) await db.encounters.bulkAdd(fresh);
      result.encounters = fresh.length;
    });
  } catch (e) {
    markStorageBroken((e as Error).message);
    throw e;
  }

  // A restore brings in cards of unknown vintage, so this device can no longer
  // assume everything older than its last sync is already on the server.
  resetSyncMarker();

  return result;
}
