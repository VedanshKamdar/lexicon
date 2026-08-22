/**
 * Hammers the question generator against the real deck and checks the invariants
 * that make a question fair. The one that matters most is that no distractor is
 * secretly also correct.
 *
 *   npx tsx scripts/quizcheck.ts [runs]
 */
import { readFileSync } from 'node:fs';
import { nextQuestion, type Question } from '../src/quiz/generate.js';
import type { StoredCard } from '../src/schema/card.js';

const runs = Number(process.argv[2] ?? 4000);
const backup = JSON.parse(readFileSync('lexicon-seed.json', 'utf8')) as { cards: StoredCard[] };
const cards = backup.cards;
const byLemma = new Map(cards.map((c) => [c.lemma, c]));

const problems: string[] = [];
const kinds: Record<string, number> = {};
const optionCounts: Record<number, number> = {};
let built = 0;

const bare = (s: string) => s.replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase();

function check(q: Question) {
  const card = byLemma.get(q.lemma)!;
  const correct = q.options[q.answerIndex];

  if (q.answerIndex < 0) problems.push(`${q.lemma} ${q.kind}: answer not among options`);

  const lower = q.options.map((o) => o.toLowerCase());
  if (new Set(lower).size !== lower.length) {
    problems.push(`${q.lemma} ${q.kind}: duplicate options`);
  }
  if (q.options.length < 2 || q.options.length > 4) {
    problems.push(`${q.lemma} ${q.kind}: ${q.options.length} options`);
  }

  // The real trap: a distractor that is also a right answer.
  const wrong = q.options.filter((_, i) => i !== q.answerIndex);

  if (q.kind === 'word-to-synonym') {
    const alsoSynonym = wrong.filter((w) =>
      card.synonyms.some((s) => s.word.toLowerCase() === w.toLowerCase())
    );
    if (alsoSynonym.length) {
      problems.push(`${q.lemma} word-to-synonym: distractor is also a synonym — ${alsoSynonym}`);
    }
    if (!card.synonyms.some((s) => s.word === correct)) {
      problems.push(`${q.lemma} word-to-synonym: answer is not a synonym`);
    }
  }

  if (q.kind === 'word-to-antonym') {
    const alsoAntonym = wrong.filter((w) =>
      card.antonyms.some((a) => a.toLowerCase() === w.toLowerCase())
    );
    if (alsoAntonym.length) {
      problems.push(`${q.lemma} word-to-antonym: distractor is also an antonym — ${alsoAntonym}`);
    }
  }

  if (q.kind === 'meaning-to-word' || q.kind === 'cloze') {
    if (correct !== card.display) problems.push(`${q.lemma} ${q.kind}: wrong answer word`);
    // A family form as a distractor would be defensibly correct too.
    const family = new Set(card.family.map(bare));
    const bad = wrong.filter((w) => family.has(w.toLowerCase()));
    if (bad.length) problems.push(`${q.lemma} ${q.kind}: distractor is a family form — ${bad}`);
  }

  if (q.kind === 'word-to-meaning' && correct !== card.simple) {
    problems.push(`${q.lemma} word-to-meaning: answer is not this card's meaning`);
  }

  if (q.kind === 'cloze' && !q.prompt.includes('——')) {
    problems.push(`${q.lemma} cloze: no gap in the sentence`);
  }
  if (q.kind === 'cloze' && new RegExp(`\\b${card.lemma}\\b`, 'i').test(q.prompt)) {
    problems.push(`${q.lemma} cloze: the answer is still visible in the sentence`);
  }
}

for (let i = 0; i < runs; i++) {
  const q = nextQuestion(cards);
  if (!q) continue;
  built++;
  kinds[q.kind] = (kinds[q.kind] ?? 0) + 1;
  optionCounts[q.options.length] = (optionCounts[q.options.length] ?? 0) + 1;
  check(q);
}

console.log(`${built}/${runs} questions built from ${cards.length} cards\n`);
console.log('kinds:');
for (const [k, n] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(18)} ${String(n).padStart(5)}  ${Math.round((n / built) * 100)}%`);
}
console.log('\noptions per question:');
for (const [n, c] of Object.entries(optionCounts).sort()) {
  console.log(`  ${n} options  ${String(c).padStart(5)}  ${Math.round((c / built) * 100)}%`);
}

const unique = [...new Set(problems)];
console.log(`\n${problems.length} invariant violations (${unique.length} distinct)`);
for (const p of unique.slice(0, 12)) console.log(`  ${p}`);
