import type { GeneratedCard } from '../src/schema/card.js';

/**
 * Checks a generated card for the specific ways these models drift — generic
 * synonym notes, the headword listed as its own synonym, circular definitions,
 * invented antonyms. Shared by the single-word harness and the bulk seeder,
 * because on a long unattended run nobody is reading every card.
 */
const BAD_NOTE_OPENERS = /^(a synonym|synonym|similar|means|same|common)\b/i;
const META_NOTE = /\b(headword|the entry|for completeness|not a single word|this card|the target|the term)\b/i;
const GENDERED = /\b(his|her|he|she|him)\b/i;

const words = (s: string) => s.trim().split(/\s+/).length;

export function auditCard(card: GeneratedCard): string[] {
  const problems: string[] = [];
  const head = card.display.toLowerCase();

  if (words(card.simple) < 6) problems.push(`simple too short (${words(card.simple)}w)`);
  if (words(card.simple) > 20) problems.push(`simple too long (${words(card.simple)}w)`);
  if (card.formal.trim().toLowerCase() === head) problems.push('formal echoes the headword');

  const defStem = head.slice(0, Math.max(4, card.display.length - 2));
  if (card.simple.toLowerCase().includes(defStem)) problems.push('simple is circular');
  if (GENDERED.test(card.simple)) problems.push('simple uses gendered pronouns');

  const selfRef = (list: string[], field: string) => {
    for (const w of list) {
      if (w.toLowerCase().replace(/\s*\(.*\)$/, '').trim() === head) {
        problems.push(`${field} contains the headword`);
      }
    }
  };
  selfRef(card.synonyms.map((s) => s.word), 'synonyms');
  selfRef(card.antonyms, 'antonyms');
  selfRef(card.family, 'family');
  selfRef(card.confusables, 'confusables');

  const stem = head.slice(0, -1);
  for (const c of card.confusables) {
    if (c.toLowerCase().startsWith(stem)) problems.push(`confusable is a family form: ${c}`);
  }

  if (card.synonyms.length < 3 || card.synonyms.length > 5) {
    problems.push(`${card.synonyms.length} synonyms (want 3-5)`);
  }
  for (const s of card.synonyms) {
    if (/\s/.test(s.word.trim())) problems.push(`synonym is a phrase: ${s.word}`);
    if (words(s.note) < 5) problems.push(`note too short: ${s.word}`);
    else if (BAD_NOTE_OPENERS.test(s.note)) problems.push(`generic note: ${s.word}`);
    else if (META_NOTE.test(s.note)) problems.push(`meta note: ${s.word}`);
  }
  for (const a of card.antonyms) {
    if (/\s/.test(a.trim())) problems.push(`antonym is a phrase: ${a}`);
  }
  if (card.examples.length !== 2) problems.push(`${card.examples.length} examples (want 2)`);
  for (const ex of card.examples) {
    if (words(ex) < 8) problems.push('example too short');
  }

  return problems;
}
