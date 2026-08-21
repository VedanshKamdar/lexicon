import type { RawPayload } from '../schema/raw';
import { merriamDictionary, merriamThesaurus } from './merriam';

const TIMEOUT_MS = 5000;

async function getJSON(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}


const POS_EXPANSION: Record<string, string> = {
  n: 'noun',
  v: 'verb',
  adj: 'adjective',
  adv: 'adverb',
  u: '',
};

const stripHtml = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();

export interface DictionaryResult {
  phonetic: string | null;
  audio: string | null;
  meanings: Array<{
    partOfSpeech: string;
    definitions: Array<{ definition: string; example?: string }>;
  }>;
}

export async function freeDictionary(word: string): Promise<DictionaryResult> {
  const data = (await getJSON(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`
  )) as Array<Record<string, any>>;

  const entries = Array.isArray(data) ? data : [];
  if (!entries.length) throw new Error('Empty dictionary response');

  const phonetic =
    entries.map((e) => e.phonetic).find((p: unknown) => typeof p === 'string' && p) ?? null;

  const audio =
    entries
      .flatMap((e) => e.phonetics ?? [])
      .map((p: any) => p?.audio)
      .find((a: unknown) => typeof a === 'string' && a) ?? null;

  const meanings = entries.flatMap((e) =>
    (e.meanings ?? []).map((m: any) => ({
      partOfSpeech: String(m.partOfSpeech ?? ''),
      definitions: (m.definitions ?? []).map((d: any) => ({
        definition: String(d.definition ?? ''),
        example: typeof d.example === 'string' ? d.example : undefined,
      })),
    }))
  );

  return { phonetic, audio, meanings };
}


/**
 * Wiktionary's REST definition endpoint. Keyless, structured, and served off
 * Wikimedia infrastructure — materially more reliable than dictionaryapi.dev,
 * which 404s intermittently on words it served correctly minutes earlier.
 * Downside: no audio and no IPA, so it supplements rather than replaces.
 */
export async function wiktionary(word: string): Promise<DictionaryResult> {
  const data = (await getJSON(
    `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`
  )) as Record<string, Array<Record<string, any>>>;

  const english = data?.en;
  if (!Array.isArray(english) || !english.length) throw new Error('No English section');

  const meanings = english.map((section) => ({
    partOfSpeech: String(section.partOfSpeech ?? '').toLowerCase(),
    definitions: (section.definitions ?? [])
      .map((d: any) => ({
        definition: stripHtml(String(d.definition ?? '')),
        example: d.parsedExamples?.[0]?.example
          ? stripHtml(String(d.parsedExamples[0].example))
          : undefined,
      }))
      .filter((d: { definition: string }) => d.definition.length > 0),
  }));

  const withContent = meanings.filter((m) => m.definitions.length > 0);
  if (!withContent.length) throw new Error('No usable definitions');

  return { phonetic: null, audio: null, meanings: withContent };
}

/** Datamuse can return WordNet definitions via md=d — free, on a call we already make. */
export async function datamuseDefinitions(word: string): Promise<DictionaryResult> {
  const data = (await getJSON(
    `https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&max=1&md=d`
  )) as Array<{ word?: string; defs?: string[] }>;

  const hit = data?.[0];
  if (!hit || hit.word?.toLowerCase() !== word.toLowerCase() || !hit.defs?.length) {
    throw new Error('No Datamuse definition');
  }

  // Datamuse encodes definitions as "pos	definition".
  const byPos = new Map<string, string[]>();
  for (const raw of hit.defs) {
    const [pos, ...rest] = raw.split('	');
    const text = rest.join('	').trim();
    if (!text) continue;
    const key = POS_EXPANSION[pos] ?? pos;
    byPos.set(key, [...(byPos.get(key) ?? []), text]);
  }

  return {
    phonetic: null,
    audio: null,
    meanings: [...byPos.entries()].map(([partOfSpeech, defs]) => ({
      partOfSpeech,
      definitions: defs.map((definition) => ({ definition })),
    })),
  };
}

async function datamuse(params: string): Promise<string[]> {
  const data = (await getJSON(`https://api.datamuse.com/words?${params}`)) as Array<{ word?: string }>;
  return (Array.isArray(data) ? data : [])
    .map((d) => d.word)
    .filter((w): w is string => typeof w === 'string' && !w.includes(' '));
}

export const datamuseSynonyms = (word: string) =>
  datamuse(`rel_syn=${encodeURIComponent(word)}&max=15`);

export const datamuseAntonyms = (word: string) =>
  datamuse(`rel_ant=${encodeURIComponent(word)}&max=10`);

export const datamuseSpelling = (word: string) =>
  datamuse(`sp=${encodeURIComponent(word)}&max=5`);

export interface Gathered {
  raw: RawPayload;
  audio: string | null;
  /** True when no source defined the word but it was confirmed to exist. */
  lowConfidence: boolean;
  /**
   * Set when a source explicitly identifies the input as a misspelling and names
   * the intended word. Wiktionary marks these as "Misspelling of receive." — an
   * authoritative signal, far better than guessing from word frequency.
   */
  misspellingOf: string | null;
  /** Merriam-Webster's own spelling suggestions, when it reported a miss. */
  suggestions: string[];
  /**
   * Which upstream actually supplied the definitions, and how long that one call
   * took. Timing the whole parallel batch and attributing it to "dictionary"
   * would credit one source with every other source's latency.
   */
  definitionSource: SourceTiming | null;
}

/** Deliberately excludes "alternative spelling of", which marks a valid variant. */
const MISSPELLING = /^(?:common |informal |obsolete )?misspelling of ([a-z][a-z'-]*)/i;

function detectMisspelling(result: DictionaryResult | null): string | null {
  if (!result) return null;
  for (const meaning of result.meanings) {
    for (const def of meaning.definitions) {
      const match = MISSPELLING.exec(def.definition.trim());
      if (match) return match[1].toLowerCase();
    }
  }
  return null;
}

export interface SourceTiming {
  label: string;
  ms: number;
  ok: boolean;
}

/** Times one upstream so the loading ledger can report what actually happened. */
async function timed<T>(
  label: string,
  work: Promise<T>
): Promise<{ label: string; ms: number; ok: boolean; value: T | null }> {
  const started = Date.now();
  try {
    const value = await work;
    return { label, ms: Date.now() - started, ok: true, value };
  } catch {
    return { label, ms: Date.now() - started, ok: false, value: null };
  }
}

export interface SourceKeys {
  mwDictionary?: string;
  mwThesaurus?: string;
}

/**
 * Resolves a word against every configured source in parallel and merges them.
 *
 * Definitions, in priority order:
 *   1. Merriam-Webster Collegiate — real editorial data, plus etymology and audio
 *   2. dictionaryapi.dev          — IPA and audio, but unreliable and flaky on CORS
 *   3. Wiktionary REST            — Wikimedia-backed, broad coverage
 *   4. Datamuse md=d              — WordNet senses, free on a call we already make
 *
 * Synonyms prefer the Merriam-Webster thesaurus, which is sense-grouped, and fall
 * back to Datamuse, which is noisier.
 *
 * lowConfidence is set only when NO source defined the word but it was still
 * confirmed to exist. Returns null when every source agrees it does not.
 */
export async function gather(word: string, keys: SourceKeys = {}): Promise<Gathered | null> {
  const [mw, mwThes, dict, wikt, dmDefs, syn, ant] = await Promise.all([
    timed(
      'merriam-webster',
      keys.mwDictionary
        ? merriamDictionary(word, keys.mwDictionary)
        : Promise.reject(new Error('no MW key'))
    ),
    timed(
      'mw thesaurus',
      keys.mwThesaurus
        ? merriamThesaurus(word, keys.mwThesaurus)
        : Promise.reject(new Error('no MW key'))
    ),
    timed('dictionaryapi.dev', freeDictionary(word)),
    timed('wiktionary', wiktionary(word)),
    timed('datamuse definitions', datamuseDefinitions(word)),
    timed('datamuse synonyms', datamuseSynonyms(word)),
    timed('datamuse antonyms', datamuseAntonyms(word)),
  ]);

  const mwValue = mw.value;
  const mwHit = mwValue && 'meanings' in mwValue ? mwValue : null;
  const mwMiss = mwValue && 'found' in mwValue ? mwValue.suggestions : null;

  const mwSyn = mwThes.value ?? { synonyms: [], antonyms: [] };
  const dmSyn = syn.value ?? [];
  const dmAnt = ant.value ?? [];

  const synonymCandidates = mwSyn.synonyms.length ? mwSyn.synonyms : dmSyn;
  const antonymCandidates = mwSyn.antonyms.length ? mwSyn.antonyms : dmAnt;

  const candidates = [
    { hit: mwHit, timing: mw },
    { hit: dict.value, timing: dict },
    { hit: wikt.value, timing: wikt },
    { hit: dmDefs.value, timing: dmDefs },
  ];
  const winner = candidates.find((c) => c.hit) ?? null;
  const primary = winner?.hit ?? null;
  const definitionSource: SourceTiming | null = winner
    ? { label: winner.timing.label, ms: winner.timing.ms, ok: true }
    : null;

  const dictHit = dict.value;
  const phonetic = mwHit?.phonetic ?? dictHit?.phonetic ?? null;
  const audio = mwHit?.audio ?? dictHit?.audio ?? null;

  if (primary) {
    const misspellingOf =
      detectMisspelling(primary) ??
      detectMisspelling(wikt.value);

    return {
      raw: {
        dictionary: { ...primary, phonetic, audio },
        etymology: mwHit?.etymology ?? null,
        family: mwHit?.family ?? [],
        usageExamples: mwHit?.usageExamples ?? [],
        plainDefinitions: mwHit?.plainDefinitions ?? [],
        labels: mwHit?.labels ?? [],
        synonymCandidates,
        antonymCandidates,
      },
      audio,
      lowConfidence: false,
      misspellingOf: misspellingOf === word.toLowerCase() ? null : misspellingOf,
      suggestions: [],
      definitionSource,
    };
  }

  const exists =
    synonymCandidates.length > 0 ||
    antonymCandidates.length > 0 ||
    (await datamuseSpelling(word).catch(() => [])).some(
      (w) => w.toLowerCase() === word.toLowerCase()
    );

  // A Merriam-Webster miss carries its own spelling suggestions — editorially
  // curated, and better than anything we can infer from word frequency.
  if (!exists) return null;

  return {
    raw: {
      dictionary: null,
      etymology: null,
      family: [],
      usageExamples: [],
      plainDefinitions: [],
      labels: [],
      synonymCandidates,
      antonymCandidates,
    },
    audio: null,
    lowConfidence: true,
    misspellingOf: null,
    suggestions: mwMiss ?? [],
    definitionSource: null,
  };
}
