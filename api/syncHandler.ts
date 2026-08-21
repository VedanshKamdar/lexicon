import { createClient, type Client } from '@libsql/client';
import type { HandlerResult } from './handler.js';

/**
 * The server never parses a card. It stores the whole record as an opaque JSON
 * payload keyed by lemma, and merges purely on updated_at. That means changing
 * the card shape never requires a server migration.
 */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS cards (
     lemma TEXT PRIMARY KEY,
     updated_at INTEGER NOT NULL,
     deleted_at INTEGER,
     written_at INTEGER NOT NULL DEFAULT 0,
     payload TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS cards_written_at ON cards (written_at)`,
  `CREATE TABLE IF NOT EXISTS encounters (
     id TEXT PRIMARY KEY,
     lemma TEXT NOT NULL,
     captured_at INTEGER NOT NULL,
     written_at INTEGER NOT NULL DEFAULT 0,
     payload TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS encounters_written_at ON encounters (written_at)`,
];

/**
 * Statements per batch. The first sync from a seeded device pushes the entire
 * book at once — a few hundred rows — and one oversized batch failing would
 * take the whole sync with it. Chunking keeps each round trip bounded.
 */
const BATCH_SIZE = 50;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

let client: Client | null = null;
let ready: Promise<void> | null = null;

function getClient(): Client {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

/**
 * Adds written_at to tables created before it existed, and backfills it to now
 * so every device pulls the whole store once. Backfilling from updated_at would
 * reproduce the bug it fixes: rows uploaded today but generated yesterday would
 * still look older than a device's last sync.
 */
async function migrate(db: Client): Promise<void> {
  for (const table of ['cards', 'encounters']) {
    // Ask whether the column exists rather than inferring it from a failed
    // ALTER. Swallowing that exception hides real errors, and the first attempt
    // at this did exactly that — leaving inserts to fail on a missing column.
    const info = await db.execute(`PRAGMA table_info(${table})`);
    const present = info.rows.some((r) => String(r.name) === 'written_at');
    if (!present) {
      await db.execute(
        `ALTER TABLE ${table} ADD COLUMN written_at INTEGER NOT NULL DEFAULT 0`
      );
    }
    await db.execute({
      sql: `UPDATE ${table} SET written_at = ? WHERE written_at = 0`,
      args: [Date.now()],
    });
  }
}

function ensureSchema(db: Client): Promise<void> {
  // Cached across warm invocations so we issue the DDL once, not per request.
  ready ??= (async () => {
    for (const statement of SCHEMA) await db.execute(statement);
    await migrate(db);
  })();
  return ready;
}

interface IncomingCard {
  lemma: string;
  updated_at: number;
  deleted_at: number | null;
}

interface IncomingEncounter {
  lemma: string;
  sentence: string;
  captured_at: number;
}

/** Content-addressed so the same encounter from two devices collapses into one. */
function encounterId(e: IncomingEncounter): string {
  let hash = 0;
  const text = `${e.lemma}\u0000${e.sentence}`;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return `${e.lemma}:${(hash >>> 0).toString(36)}`;
}

export async function handleSync(
  body: unknown,
  headers: Record<string, string | undefined>,
): Promise<HandlerResult> {
  const secret = process.env.APP_SECRET;
  if (secret && headers['x-app-secret'] !== secret) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }

  if (!process.env.TURSO_DATABASE_URL) {
    return {
      status: 503,
      body: { error: 'Sync is not configured on this deployment.' },
    };
  }

  const input = body as {
    since?: unknown;
    cards?: unknown;
    encounters?: unknown;
  };
  const since = typeof input?.since === 'number' ? input.since : 0;
  const cards = Array.isArray(input?.cards)
    ? (input.cards as IncomingCard[])
    : [];
  const encounters = Array.isArray(input?.encounters)
    ? (input.encounters as IncomingEncounter[])
    : [];

  try {
    const db = getClient();
    await ensureSchema(db);
    const writtenAt = Date.now();

    if (cards.length) {
      // Newest write wins. The WHERE clause makes this safe to replay: pushing a
      // stale card can never overwrite a fresher one already on the server.
      for (const batch of chunk(cards, BATCH_SIZE)) {
        await db.batch(
          batch.map((card) => ({
            sql: `INSERT INTO cards (lemma, updated_at, deleted_at, written_at, payload)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(lemma) DO UPDATE SET
                  updated_at = excluded.updated_at,
                  deleted_at = excluded.deleted_at,
                  written_at = excluded.written_at,
                  payload    = excluded.payload
                WHERE excluded.updated_at > cards.updated_at`,
            args: [
              card.lemma,
              card.updated_at,
              card.deleted_at ?? null,
              writtenAt,
              JSON.stringify(card),
            ],
          })),
          'write',
        );
      }
    }

    if (encounters.length) {
      for (const batch of chunk(encounters, BATCH_SIZE)) {
        await db.batch(
          batch.map((e) => ({
            sql: `INSERT INTO encounters (id, lemma, captured_at, written_at, payload)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO NOTHING`,
            args: [
              encounterId(e),
              e.lemma,
              e.captured_at,
              writtenAt,
              JSON.stringify(e),
            ],
          })),
          'write',
        );
      }
    }

    /*
     * Filtered on written_at, not on the card's own updated_at. A card generated
     * this morning but uploaded this afternoon must still reach a device that
     * synced at midday — its vintage is irrelevant, only when the server learned
     * about it matters.
     */
    const changedCards = await db.execute({
      sql: 'SELECT payload FROM cards WHERE written_at > ?',
      args: [since],
    });
    const changedEncounters = await db.execute({
      sql: 'SELECT payload FROM encounters WHERE written_at > ?',
      args: [since],
    });

    return {
      status: 200,
      body: {
        now: Date.now(),
        cards: changedCards.rows.map((r) => JSON.parse(String(r.payload))),
        encounters: changedEncounters.rows.map((r) =>
          JSON.parse(String(r.payload)),
        ),
      },
    };
  } catch (e) {
    return {
      status: 502,
      body: { error: `Sync failed: ${(e as Error).message}` },
    };
  }
}
