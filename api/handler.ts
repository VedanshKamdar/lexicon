import { generateCard } from './groq';
import { gather } from '../src/api/fetchers';
import { suggestCorrections } from '../src/api/spellcheck';
import type { Gathered } from '../src/api/fetchers';

export interface HandlerResult {
  status: number;
  body: unknown;
}

/**
 * Holds what /api/resolve fetched so /api/generate can reuse it without the
 * payload travelling out to the browser and back. Returning it to the client
 * would let a caller post arbitrary text as "authoritative dictionary data",
 * which the prompt explicitly trusts for meaning.
 *
 * Serverless instances are not shared, so a generate call may land somewhere
 * that never saw the resolve. That is why generate re-gathers on a miss rather
 * than failing — the cache is an optimisation, never a dependency.
 */
const RESOLVE_TTL_MS = 5 * 60 * 1000;
const RESOLVE_CACHE_MAX = 50;
const resolveCache = new Map<string, { at: number; gathered: Gathered }>();

function cacheResolve(word: string, gathered: Gathered): void {
  if (resolveCache.size >= RESOLVE_CACHE_MAX) {
    const oldest = resolveCache.keys().next().value;
    if (oldest) resolveCache.delete(oldest);
  }
  resolveCache.set(word, { at: Date.now(), gathered });
}

function takeResolved(word: string): Gathered | null {
  const hit = resolveCache.get(word);
  if (!hit) return null;
  if (Date.now() - hit.at > RESOLVE_TTL_MS) {
    resolveCache.delete(word);
    return null;
  }
  return hit.gathered;
}

function sourceKeys() {
  return {
    mwDictionary: process.env.MW_DICTIONARY_KEY || undefined,
    mwThesaurus: process.env.MW_THESAURUS_KEY || undefined,
  };
}

function authorised(headers: Record<string, string | undefined>): boolean {
  const secret = process.env.APP_SECRET;
  return !secret || headers['x-app-secret'] === secret;
}

export interface LedgerEntry {
  label: string;
  detail: string;
  ok: boolean;
}

/**
 * Step one: everything that is fast. Dictionary lookup, synonym and antonym
 * candidates, spelling verdict.
 *
 * Split from generation on purpose. The dictionary resolves in a few hundred
 * milliseconds while the model takes seconds, so returning them together would
 * make the user stare at an empty screen for the whole wait. Answering in two
 * steps lets the headword, IPA and part of speech paint almost immediately.
 *
 * Runs server-side because api.dictionaryapi.dev does not reliably send CORS
 * headers — from the browser it fails outright, silently costing IPA and audio.
 */
export async function handleResolve(
  body: unknown,
  headers: Record<string, string | undefined>
): Promise<HandlerResult> {
  if (!authorised(headers)) return { status: 401, body: { error: 'Unauthorized' } };

  const input = body as { word?: unknown };
  const word = typeof input?.word === 'string' ? input.word.trim().toLowerCase() : '';
  if (!word) return { status: 400, body: { error: 'word is required' } };

  let gathered;
  try {
    gathered = await gather(word, sourceKeys());
  } catch (e) {
    return { status: 502, body: { error: `Lookup failed: ${(e as Error).message}` } };
  }

  if (!gathered) {
    const suggestions = await suggestCorrections(word);
    return {
      status: 200,
      body: { status: 'not_found', suggestions: suggestions.map((s) => s.word) },
    };
  }

  if (gathered.misspellingOf) {
    const alternatives = (await suggestCorrections(word))
      .map((s) => s.word)
      .filter((w) => w !== gathered.misspellingOf)
      .slice(0, 2);
    return {
      status: 200,
      body: { status: 'misspelling', correction: gathered.misspellingOf, alternatives },
    };
  }

  // Merriam-Webster's own suggestions are editorially curated, so prefer them
  // over anything inferred from word frequency.
  const didYouMean = gathered.lowConfidence
    ? gathered.suggestions.length
      ? gathered.suggestions.slice(0, 3)
      : (await suggestCorrections(word)).map((s) => s.word)
    : [];

  const dictionary = gathered.raw.dictionary;
  const source = gathered.definitionSource;
  const ledger: LedgerEntry[] = [
    {
      // Names the upstream that actually supplied the definitions, timed on its
      // own call rather than on the whole parallel batch.
      label: source?.label ?? 'dictionary',
      detail: source ? `${source.ms}ms` : 'no entry',
      ok: Boolean(dictionary),
    },
    {
      label: 'synonym candidates',
      detail: `${gathered.raw.synonymCandidates.length}`,
      ok: gathered.raw.synonymCandidates.length > 0,
    },
    {
      label: 'antonym candidates',
      detail: `${gathered.raw.antonymCandidates.length}`,
      ok: gathered.raw.antonymCandidates.length > 0,
    },
  ];

  cacheResolve(word, gathered);

  return {
    status: 200,
    body: {
      status: 'resolved',
      audio: gathered.audio,
      lowConfidence: gathered.lowConfidence,
      didYouMean,
      ledger,
      // Paints immediately while the model is still writing.
      preview: {
        ipa: dictionary?.phonetic ?? null,
        pos: dictionary?.meanings[0]?.partOfSpeech ?? null,
      },
    },
  };
}

/**
 * Step two: the slow half. Reuses whatever step one fetched, and re-fetches when
 * that is not available — the payload is never accepted from the caller, because
 * the prompt treats dictionary data as authoritative for meaning.
 */
export async function handleGenerate(
  body: unknown,
  headers: Record<string, string | undefined>
): Promise<HandlerResult> {
  if (!authorised(headers)) return { status: 401, body: { error: 'Unauthorized' } };

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { status: 500, body: { error: 'GROQ_API_KEY is not configured on the server' } };
  }

  const input = body as { word?: unknown; encounter?: unknown };
  const word = typeof input?.word === 'string' ? input.word.trim().toLowerCase() : '';
  if (!word) return { status: 400, body: { error: 'word is required' } };

  const encounter =
    typeof input.encounter === 'string' && input.encounter.trim()
      ? input.encounter.trim()
      : undefined;

  let gathered: Gathered | null = takeResolved(word);
  if (!gathered) {
    try {
      gathered = await gather(word, sourceKeys());
    } catch (e) {
      return { status: 502, body: { error: `Lookup failed: ${(e as Error).message}` } };
    }
  }
  if (!gathered) return { status: 404, body: { error: 'No entry for that word.' } };

  try {
    const { card, model, repaired } = await generateCard(
      word,
      gathered.raw,
      encounter,
      {
        apiKey,
        model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b',
        fallbackModel: process.env.GROQ_FALLBACK_MODEL,
      }
    );
    return {
      status: 200,
      body: {
        status: 'card',
        card,
        model,
        repaired,
        // Echoed so the client can persist them without having held the payload.
        audio: gathered.audio,
        lowConfidence: gathered.lowConfidence,
      },
    };
  } catch (e) {
    return { status: 502, body: { error: (e as Error).message } };
  }
}
