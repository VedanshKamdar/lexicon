/**
 * Bulk-generates cards for a word list and writes them as a Lexicon backup file,
 * importable through the app's "Restore from file" control.
 *
 *   npx tsx scripts/seed.ts                     # default list, default output
 *   npx tsx scripts/seed.ts --limit 40          # stop after 40 new cards
 *   npx tsx scripts/seed.ts --list my.txt --out my-seed.json
 *
 * Resumable by design: the output file is rewritten after every card, and words
 * already present in it are skipped. The Groq free tier cannot produce a list of
 * this size in one sitting, so the expected usage is to re-run it across days
 * and let it pick up where it stopped.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gather } from '../src/api/fetchers.js';
import { generateCard, getLastUsage } from '../api/groq.js';
import { StoredCardSchema, type StoredCard } from '../src/schema/card.js';
import { auditCard } from './audit.js';

const args = process.argv.slice(2);
const argOf = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const LIST = argOf('list', 'scripts/cat-words.txt');
const OUT = argOf('out', 'lexicon-seed.json');
const LIMIT = Number(argOf('limit', '1000'));
/*
 * Falling back to the smaller model is right for an interactive lookup — a
 * card now beats an error. For bulk generation it is wrong: the run silently
 * produces weaker cards, and the weaker model also fails strict decoding
 * outright. With --no-fallback the seeder waits for the good model instead.
 */
const NO_FALLBACK = args.includes('--no-fallback');

/** Free-tier TPM is the binding constraint; this keeps us just under it. */
const MIN_GAP_MS = 31_000;

/**
 * A per-minute 429 asks for a few seconds and is worth waiting out. A 429 that
 * asks for minutes means the daily token budget is gone, and sleeping through
 * that would hang an unattended run for hours. Stop instead — the output file
 * is already written, so tomorrow's run resumes where this one left off.
 */
const MAX_WAIT_S = 120;

interface Backup {
  version: number;
  exported_at: number;
  cards: StoredCard[];
  encounters: never[];
}

function loadBackup(): Backup {
  if (!existsSync(OUT)) return { version: 1, exported_at: Date.now(), cards: [], encounters: [] };
  try {
    return JSON.parse(readFileSync(OUT, 'utf8')) as Backup;
  } catch {
    console.error(`${OUT} exists but is not readable JSON — move it aside first.`);
    process.exit(1);
  }
}

const words = readFileSync(LIST, 'utf8')
  .split('\n')
  .map((l) => l.trim().toLowerCase())
  .filter((l) => l && !l.startsWith('#'));

const backup = loadBackup();
const done = new Set(backup.cards.map((c) => c.lemma));
const todo = words.filter((w) => !done.has(w)).slice(0, LIMIT);

console.log(`list ${words.length} words · already have ${done.size} · attempting ${todo.length}\n`);

const keys = {
  mwDictionary: process.env.MW_DICTIONARY_KEY,
  mwThesaurus: process.env.MW_THESAURUS_KEY,
};

const retryAfter = (message: string): number | null => {
  const m = /try again in about (\d+)s/.exec(message);
  return m ? Number(m[1]) : null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let made = 0;
let failed = 0;
let flagged = 0;
let exhausted = false;
let tokens = 0;
const started = Date.now();

for (const [index, word] of todo.entries()) {
  const label = `[${index + 1}/${todo.length}] ${word}`;

  let attempt = 0;
  const maxAttempts = NO_FALLBACK ? 5 : 3;
  while (attempt < maxAttempts) {
    attempt++;
    const t0 = Date.now();
    try {
      const gathered = await gather(word, keys);
      if (!gathered) {
        console.log(`${label.padEnd(34)} skipped — no source recognises it`);
        failed++;
        break;
      }
      if (gathered.misspellingOf) {
        console.log(`${label.padEnd(34)} skipped — flagged as a misspelling of ${gathered.misspellingOf}`);
        failed++;
        break;
      }

      const { card, model } = await generateCard(word, gathered.raw, undefined, {
        apiKey: process.env.GROQ_API_KEY!,
        model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b',
        fallbackModel: NO_FALLBACK ? undefined : process.env.GROQ_FALLBACK_MODEL,
      });

      const now = Date.now();
      const stored: StoredCard = {
        ...card,
        lemma: word,
        audio_url: gathered.audio,
        low_confidence: gathered.lowConfidence,
        created_at: now,
        updated_at: now,
        user_edited: false,
        view_count: 0,
        last_viewed_at: null,
        deleted_at: null,
        rootParts: card.roots.map((r) => r.part),
      };

      const check = StoredCardSchema.safeParse(stored);
      if (!check.success) {
        console.log(`${label.padEnd(34)} FAILED validation — not saved`);
        failed++;
        break;
      }

      backup.cards.push(check.data);
      backup.exported_at = Date.now();
      // Written every card so an interrupted run loses nothing.
      writeFileSync(OUT, JSON.stringify(backup, null, 2));

      const usage = getLastUsage();
      tokens += usage?.totalTokens ?? 0;
      made++;
      const { problems, warnings } = auditCard(card);
      if (problems.length) flagged++;
      console.log(
        `${label.padEnd(34)} ${problems.length ? 'flag' : 'ok  '} ` +
          `${String(Date.now() - t0).padStart(5)}ms  ${model.replace('openai/', '')}  ` +
          `${usage?.totalTokens ?? '?'} tok` +
          (problems.length ? `
${' '.repeat(36)}⚠ ${problems.join(' | ')}` : '') +
          (warnings.length ? `
${' '.repeat(36)}· ${warnings.join(' | ')}` : '')
      );
      break;
    } catch (e) {
      const message = (e as Error).message;
      let wait = retryAfter(message);
      // A bare "Rate limited." with no time carries no hint; wait one TPM window.
      if (wait === null && /rate limited/i.test(message)) wait = 60;
      if (wait !== null && wait > MAX_WAIT_S) {
        console.log(
          `${label.padEnd(34)} daily token budget exhausted (asks for ${wait}s)`
        );
        exhausted = true;
        break;
      }
      if (wait !== null && attempt < maxAttempts) {
        console.log(`${label.padEnd(34)} rate limited — waiting ${wait + 2}s`);
        await sleep((wait + 2) * 1000);
        continue;
      }
      console.log(`${label.padEnd(34)} FAILED — ${message.slice(0, 90)}`);
      failed++;
      break;
    }
  }

  if (exhausted) break;
  if (index < todo.length - 1) await sleep(MIN_GAP_MS);
}

const minutes = Math.round((Date.now() - started) / 60000);
console.log(
  `
done · ${made} made · ${flagged} flagged by audit · ${failed} failed · ${backup.cards.length} total in ${OUT}` +
    `\n${tokens.toLocaleString()} tokens over ${minutes} min` +
    `\nImport ${OUT} with "Restore from file" on the Words screen.`
);
