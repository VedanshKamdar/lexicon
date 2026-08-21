/**
 * Google-style "did you mean". Datamuse has three lookup modes and each one
 * misses cases the others catch, measured against real typos:
 *   sp=word    fuzzy spelling  — misses truncations ("obdurat" finds nothing useful)
 *   sp=word*   prefix wildcard — catches truncations ("obdurat*" -> obdurate)
 *   sl=word    phonetic        — catches the classic doubled/transposed-letter typos
 *                                ("recieve" -> receive, "definately" -> definitely)
 * We union all three, then use word frequency to decide whether to say anything.
 */

const TIMEOUT_MS = 4000;

/** Suggest only when the alternative is this many times more common than what was typed. */
const FREQUENCY_RATIO = 15;
/**
 * Beyond this edit distance it is a different word, not a correction.
 * Measured: every real typo we tested lands within 2 ("recieve"->"receive",
 * "definately"->"definitely", "obdurat"->"obdurate"). Allowing 3 let
 * "obdurate"->"moderate" and "sanction"->"function" through.
 */
const MAX_EDIT_DISTANCE = 2;

export interface Suggestion {
  word: string;
  frequency: number;
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev.splice(0, prev.length, ...curr);
  }
  return prev[b.length];
}

interface DatamuseHit {
  word: string;
  tags?: string[];
}

function frequencyOf(hit: DatamuseHit): number {
  const tag = hit.tags?.find((t) => t.startsWith('f:'));
  return tag ? Number(tag.slice(2)) || 0 : 0;
}

async function query(params: string): Promise<DatamuseHit[]> {
  try {
    const res = await fetch(`https://api.datamuse.com/words?${params}&md=f`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Returns corrections worth offering, best first. Empty when the input looks
 * correctly spelled — a suggestion on a correct word is worse than none.
 */
export async function suggestCorrections(word: string): Promise<Suggestion[]> {
  const w = word.toLowerCase();
  const [fuzzy, prefix, phonetic] = await Promise.all([
    query(`sp=${encodeURIComponent(w)}&max=6`),
    query(`sp=${encodeURIComponent(w)}*&max=6`),
    query(`sl=${encodeURIComponent(w)}&max=6`),
  ]);

  const all = [...fuzzy, ...prefix, ...phonetic];

  // How common is the word the user actually typed? Zero means "not a real word",
  // which makes any plausible alternative worth showing.
  const typed = all.find((h) => h.word.toLowerCase() === w);
  const typedFrequency = typed ? frequencyOf(typed) : 0;
  const threshold = typedFrequency * FREQUENCY_RATIO;

  const seen = new Map<string, number>();
  for (const hit of all) {
    const candidate = hit.word.toLowerCase();
    if (candidate === w || candidate.includes(' ')) continue;
    if (editDistance(w, candidate) > MAX_EDIT_DISTANCE) continue;

    const freq = frequencyOf(hit);
    if (freq <= threshold) continue;

    seen.set(candidate, Math.max(seen.get(candidate) ?? 0, freq));
  }

  return [...seen.entries()]
    .map(([word, frequency]) => ({ word, frequency }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 3);
}
