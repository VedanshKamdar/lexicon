import type { StoredCard } from '../schema/card';

export type QuestionKind =
  | 'word-to-meaning'
  | 'meaning-to-word'
  | 'word-to-synonym'
  | 'word-to-antonym'
  | 'cloze';

export interface Question {
  kind: QuestionKind;
  /** Shown above the options. */
  prompt: string;
  /** Rendered in serif when the prompt is itself a word rather than a sentence. */
  promptIsWord: boolean;
  /** Small mono line under the prompt — part of speech, or the instruction. */
  hint: string;
  options: string[];
  answerIndex: number;
  /** The card being tested, so a result can be recorded against it. */
  lemma: string;
}

const DAY_MS = 86_400_000;

const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Same staleness weighting the revisit strip uses: a word you have not looked at
 * in weeks should come up more often than one you read a minute ago.
 */
function weightedPick(cards: StoredCard[]): StoredCard {
  const now = Date.now();
  const weighted = cards.map((card) => {
    const since = card.last_viewed_at ?? card.created_at;
    const days = Math.max(0, (now - since) / DAY_MS);
    return { card, weight: Math.sqrt((1 + days) / (1 + card.view_count)) };
  });
  const total = weighted.reduce((sum, w) => sum + w.weight, 0);
  let r = Math.random() * total;
  for (const w of weighted) {
    r -= w.weight;
    if (r <= 0) return w.card;
  }
  return weighted[weighted.length - 1].card;
}

/** Distractors read as plausible only when they share the target's part of speech. */
function distractorPool(target: StoredCard, all: StoredCard[]): StoredCard[] {
  const others = all.filter((c) => c.lemma !== target.lemma);
  const samePos = others.filter((c) => c.pos === target.pos);
  return samePos.length >= 3 ? samePos : others;
}

/** Everything already tied to this word, so a distractor is never secretly correct. */
function relatedTo(card: StoredCard): Set<string> {
  const bare = (s: string) => s.replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase();
  return new Set(
    [
      card.lemma,
      ...card.synonyms.map((s) => s.word),
      ...card.antonyms,
      ...card.family.map(bare),
      ...card.confusables,
    ].map((w) => w.toLowerCase())
  );
}

function buildOptions(correct: string, candidates: string[], count: number): string[] | null {
  const seen = new Set([correct.toLowerCase()]);
  const distractors: string[] = [];
  for (const c of shuffle(candidates)) {
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    distractors.push(c);
    if (distractors.length === count - 1) break;
  }
  if (distractors.length < count - 1) return null;
  return shuffle([correct, ...distractors]);
}

function make(
  kind: QuestionKind,
  target: StoredCard,
  pool: StoredCard[],
  optionCount: number
): Question | null {
  const finish = (
    prompt: string,
    promptIsWord: boolean,
    hint: string,
    correct: string,
    candidates: string[]
  ): Question | null => {
    const options = buildOptions(correct, candidates, optionCount);
    if (!options) return null;
    return {
      kind,
      prompt,
      promptIsWord,
      hint,
      options,
      answerIndex: options.indexOf(correct),
      lemma: target.lemma,
    };
  };

  if (kind === 'word-to-meaning') {
    return finish(
      target.display,
      true,
      'which meaning fits?',
      target.simple,
      pool.map((c) => c.simple)
    );
  }

  if (kind === 'meaning-to-word') {
    return finish(
      target.simple,
      false,
      'which word is this?',
      target.display,
      pool.map((c) => c.display)
    );
  }

  if (kind === 'word-to-synonym') {
    if (!target.synonyms.length) return null;
    const related = relatedTo(target);
    // A distractor drawn from another card could still be a genuine synonym of
    // the target, which would make two options correct. Exclude anything the
    // target already names.
    const candidates = pool
      .flatMap((c) => [c.display, ...c.synonyms.map((s) => s.word)])
      .filter((w) => !related.has(w.toLowerCase()));
    return finish(
      target.display,
      true,
      'closest in meaning',
      pick(target.synonyms).word,
      candidates
    );
  }

  if (kind === 'word-to-antonym') {
    if (target.antonyms.length === 0) return null;
    const related = relatedTo(target);
    const candidates = pool
      .flatMap((c) => [c.display, ...c.synonyms.map((s) => s.word)])
      .filter((w) => !related.has(w.toLowerCase()));
    return finish(target.display, true, 'the opposite', pick(target.antonyms), candidates);
  }

  // cloze
  const usable = target.examples.filter((ex) =>
    new RegExp(`\\b${target.lemma.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\b`, 'i').test(ex)
  );
  if (!usable.length) return null;
  const sentence = pick(usable).replace(
    new RegExp(`\\b${target.lemma.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\b`, 'gi'),
    '——'
  );
  return finish(
    sentence,
    false,
    'fill the gap',
    target.display,
    pool.map((c) => c.display)
  );
}

const ALL_KINDS: QuestionKind[] = [
  'word-to-meaning',
  'meaning-to-word',
  'word-to-synonym',
  'word-to-antonym',
  'cloze',
];

export const MIN_CARDS = 4;

/**
 * Builds one question. Returns null only when the deck genuinely cannot support
 * one — too few cards, or no card with enough material.
 */
export function nextQuestion(cards: StoredCard[], avoidLemma?: string): Question | null {
  const usable = cards.filter((c) => !c.deleted_at);
  if (usable.length < MIN_CARDS) return null;

  const candidates = usable.length > MIN_CARDS
    ? usable.filter((c) => c.lemma !== avoidLemma)
    : usable;

  // Several attempts, because a given card may not support the kind drawn —
  // no antonyms, or no example containing the headword.
  for (let attempt = 0; attempt < 25; attempt++) {
    const target = weightedPick(candidates);
    const pool = distractorPool(target, usable);
    const optionCount = Math.min(2 + Math.floor(Math.random() * 3), pool.length + 1);
    const question = make(pick(ALL_KINDS), target, pool, optionCount);
    if (question) return question;
  }
  return null;
}
