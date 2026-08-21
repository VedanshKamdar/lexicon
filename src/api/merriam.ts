import type { DictionaryResult } from './fetchers.js';

const TIMEOUT_MS = 5000;
const BASE = 'https://www.dictionaryapi.com/api/v3/references';

/**
 * Merriam-Webster wraps its text in typesetting tokens: {bc} is a bold colon,
 * {sx|word||} a cross-reference, {it}...{/it} italics. Piped tokens keep their
 * first argument, bare tokens are dropped.
 */
function stripTokens(text: string): string {
  return text
    .replace(/\{ldquo\}/g, '“')
    .replace(/\{rdquo\}/g, '”')
    .replace(/\{bc\}/g, '')
    .replace(/\{([a-z_]+)\|([^|}]*)(?:\|[^}]*)?\}/gi, (_, __, first) => first)
    .replace(/\{\/?[a-z_]+\}/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Audio lives on a CDN whose subdirectory is derived from the filename itself.
 * These rules come from the Merriam-Webster API documentation.
 */
function audioUrl(filename: string): string {
  let sub: string;
  if (filename.startsWith('bix')) sub = 'bix';
  else if (filename.startsWith('gg')) sub = 'gg';
  else if (/^[0-9_.]/.test(filename)) sub = 'number';
  else sub = filename[0];
  return `https://media.merriam-webster.com/audio/prons/en/us/mp3/${sub}/${filename}.mp3`;
}


const POS_ABBREV: Record<string, string> = {
  adjective: 'adj.',
  adverb: 'adv.',
  noun: 'n.',
  verb: 'v.',
  pronoun: 'pron.',
  preposition: 'prep.',
  conjunction: 'conj.',
  interjection: 'interj.',
};

/**
 * Merriam-Webster nests content in "definition text" tuples buried at varying
 * depths — ["text", "..."] for prose, ["vis", [{t}]] for usage examples. Rather
 * than hard-coding the sseq/sense/dt path, walk the tree and collect by tag.
 */
function collectTagged(node: unknown, tag: string, out: string[]): void {
  if (Array.isArray(node)) {
    if (node[0] === tag) {
      const payload = node[1];
      if (typeof payload === 'string') out.push(stripTokens(payload));
      else if (Array.isArray(payload)) {
        for (const item of payload) {
          const t = (item as { t?: unknown })?.t;
          if (typeof t === 'string') out.push(stripTokens(t));
        }
      }
      return;
    }
    for (const child of node) collectTagged(child, tag, out);
    return;
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectTagged(value, tag, out);
  }
}

function collectLabels(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const child of node) collectLabels(child, out);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'sls' && Array.isArray(value)) {
        for (const label of value) if (typeof label === 'string') out.add(label.toLowerCase());
      } else {
        collectLabels(value, out);
      }
    }
  }
}

async function mwFetch(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}/${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** A miss returns plain strings — Merriam-Webster's own spelling suggestions. */
function isSuggestionList(data: unknown): data is string[] {
  return Array.isArray(data) && data.every((d) => typeof d === 'string');
}

const headwordOf = (entry: any): string =>
  String(entry?.hwi?.hw ?? '').replace(/\*/g, '').toLowerCase();

export interface MerriamResult extends DictionaryResult {
  /** Authoritative etymology, so the model does not have to invent morphemes. */
  etymology: string | null;
  /** Inflected forms Merriam-Webster maps to this headword — useful for lemmatising. */
  stems: string[];
  /** From "uros": related forms like "voluminously (adv.)". Replaces guesswork. */
  family: string[];
  /**
   * Learner's Dictionary senses, when the entry carries them. Already written in
   * plain English for non-native readers, which is precisely what "simple" wants.
   */
  plainDefinitions: string[];
  /** Real usage examples from the entry, to anchor the generated ones. */
  usageExamples: string[];
  /** Register labels Merriam-Webster states outright, e.g. "formal", "archaic". */
  labels: string[];
}

export interface MerriamMiss {
  found: false;
  suggestions: string[];
}

export async function merriamDictionary(
  word: string,
  key: string
): Promise<MerriamResult | MerriamMiss> {
  const data = await mwFetch(`collegiate/json/${encodeURIComponent(word)}?key=${key}`);

  if (isSuggestionList(data)) {
    return { found: false, suggestions: data.slice(0, 5) };
  }
  if (!Array.isArray(data) || !data.length) throw new Error('Unexpected MW response');

  // Merriam-Webster returns homographs ("sanction:1", "sanction:2") plus related
  // entries; keep only those whose headword actually matches what was asked for.
  const entries = data.filter((e: any) => headwordOf(e) === word.toLowerCase());
  if (!entries.length) throw new Error('No exact headword match');

  const meanings = entries
    .map((e: any) => ({
      partOfSpeech: String(e.fl ?? '').toLowerCase(),
      definitions: (e.shortdef ?? [])
        .map((d: string) => ({ definition: stripTokens(d) }))
        .filter((d: { definition: string }) => d.definition.length > 0),
    }))
    .filter((m: { definitions: unknown[] }) => m.definitions.length > 0);

  if (!meanings.length) throw new Error('No definitions');

  const pron = entries.map((e: any) => e.hwi?.prs?.[0]).find(Boolean);
  const audioFile = entries.map((e: any) => e.hwi?.prs?.[0]?.sound?.audio).find(Boolean);
  const etRaw = entries.map((e: any) => e.et?.[0]?.[1]).find(Boolean);

  const family = entries
    .flatMap((e: any) => e.uros ?? [])
    .map((u: any) => {
      const form = String(u.ure ?? '').replace(/\*/g, '');
      const pos = String(u.fl ?? '').toLowerCase();
      if (!form) return '';
      return pos ? `${form} (${POS_ABBREV[pos] ?? pos})` : form;
    })
    .filter(Boolean) as string[];

  const plainDefinitions: string[] = [];
  const usageExamples: string[] = [];
  const labelSet = new Set<string>();

  for (const entry of entries) {
    // The Learner's Dictionary block, when present, is already plain English.
    collectTagged(entry.suppl?.ldq?.def, 'text', plainDefinitions);
    for (const ex of entry.suppl?.examples ?? []) {
      if (typeof ex?.t === 'string') usageExamples.push(stripTokens(ex.t));
    }
    collectTagged(entry.def, 'vis', usageExamples);
    collectLabels(entry.suppl?.ldq?.def, labelSet);
  }

  return {
    phonetic: pron?.mw ? `/${pron.mw}/` : null,
    audio: audioFile ? audioUrl(String(audioFile)) : null,
    meanings,
    etymology: etRaw ? stripTokens(String(etRaw)) : null,
    stems: [...new Set(entries.flatMap((e: any) => e.meta?.stems ?? []))] as string[],
    family: [...new Set(family)],
    plainDefinitions: [...new Set(plainDefinitions.filter(Boolean))].slice(0, 4),
    usageExamples: [...new Set(usageExamples.filter(Boolean))].slice(0, 4),
    labels: [...labelSet],
  };
}

export interface MerriamThesaurus {
  synonyms: string[];
  antonyms: string[];
}

export async function merriamThesaurus(word: string, key: string): Promise<MerriamThesaurus> {
  const data = await mwFetch(`thesaurus/json/${encodeURIComponent(word)}?key=${key}`);
  if (isSuggestionList(data) || !Array.isArray(data) || !data.length) {
    return { synonyms: [], antonyms: [] };
  }

  const entries = data.filter((e: any) => headwordOf(e) === word.toLowerCase());
  const flatten = (field: 'syns' | 'ants') =>
    [
      ...new Set(
        entries
          .flatMap((e: any) => e.meta?.[field] ?? [])
          .flat()
          .map((w: unknown) => String(w).toLowerCase())
          .filter((w: string) => w && !w.includes(' '))
      ),
    ] as string[];

  return { synonyms: flatten('syns').slice(0, 15), antonyms: flatten('ants').slice(0, 10) };
}
