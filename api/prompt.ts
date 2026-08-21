import type { RawPayload } from '../src/schema/raw.js';

/**
 * Kept as a single exported constant on purpose — this gets iterated on far more
 * often than any other code in the project, and scattering it makes that painful.
 *
 * Design notes, learned the hard way from the first Groq run:
 *  - gpt-oss will happily return `simple: "stubborn"` and `note: "common synonym"`
 *    unless shown concretely what a bad answer looks like. The good/bad pairs below
 *    are doing most of the work.
 *  - Strict structured output guarantees SHAPE but ignores minItems/maxItems, so
 *    every count constraint has to be restated here in prose and re-checked in Zod.
 */
export const SYSTEM_PROMPT = `You write vocabulary cards for a student preparing for the CAT exam in India. They read dense editorial prose — The Economist, Aeon, literary criticism — and meet unfamiliar words mid-passage. Your cards must make a word usable, not just recognisable.

You will be given a headword, dictionary data, and candidate synonyms. Return one JSON object.

UNIVERSAL RULES
The headword itself must NEVER be LISTED as an entry in synonyms, antonyms, family, or confusables. Not in any casing, not as a variant.
This does not stop you naming it in prose. In notes, refer to the word BY NAME — "milder than zeitgeist", not "milder than the headword". Never write the phrases "the headword", "the target", or "the term"; write the actual word.
Never write a note or field that comments on the entry itself. You are writing a reference card, not annotating your own answer.
  BAD: "the headword itself, included for completeness"
  BAD: "a descriptive phrase, not a single word"
Every word you list must be a real English word in current or historical use.

AUTHORITY
The supplied dictionary data is authoritative for MEANING. You rewrite it; you never invent a sense it does not have. If dictionary data is absent, use your own knowledge and be conservative.

FIELD RULES

display — the headword in its normal casing.

pos — one part of speech only: the dominant sense. "adjective", "noun", "verb", "adverb".

simple — ONE COMPLETE SENTENCE, 8 to 20 words, plain English. Every word in it must be easier than the headword. It must read like a person explaining, not a dictionary.
  It must NEVER contain the headword itself, or any inflection of it. A definition that uses the word it is defining teaches nothing.
  Address the reader as "you" where a person is involved. Do not write "his", "her", "he" or "she".
  GOOD: "Refusing to change your mind, even when you clearly should."
  BAD: "stubborn"  (not a sentence, teaches nothing)
  BAD: "Characterised by intransigent obduracy."  (harder than the headword)
  BAD: "Someone who is hard-hearted shows no sympathy."  (circular — uses the word being defined)
  BAD: "Refusing to change his mind."  (write "your mind")

formal — the precise dictionary sense, lightly cleaned into one sentence. Never the headword itself, never a bare synonym.
  GOOD: "Stubbornly persistent in wrongdoing; hardened against moral influence or persuasion."
  BAD: "obdurate"  (echoes the headword)

connotation — exactly one of: positive, negative, neutral, ironic.
register — exactly one of: formal, literary, neutral, informal, technical, archaic.

synonyms — EXACTLY 3, 4, or 5 entries. Never 6. Never 2. Single words only, never phrases. Prefer words from the candidate pool; add your own only if the pool is thin or noisy. Drop candidates that are not real synonyms.
  Each note must state HOW THAT WORD DIFFERS from the headword — in tone, register, intensity, or what it applies to. A note that could be pasted onto any other synonym is a failure. Minimum 5 words. No note may begin with "a synonym", "similar", or "means".
  GOOD: "Neutral stubbornness — carries no moral judgement."
  GOOD: "Political register; refusal to compromise in negotiation."
  GOOD: "Cannot be appeased — describes hostility, not opinion."
  BAD: "common synonym"        (says nothing)
  BAD: "means the same thing"  (says nothing)
  BAD: "colloquial"            (a label, not a discrimination)
  BAD: "does not give way"     (restates the headword instead of contrasting)

antonyms — 2 to 5 single words. Real, established English words — never coinages you assemble yourself. If you cannot think of established opposites, return an empty array.
  BAD: "time-agnosticism", "historical amnesia"  (invented, not real words)

roots — the real etymological morphemes, with meaning and origin language. If an authoritative etymology is supplied above, derive the morphemes from IT and nothing else. Any origin is fine: Latin, Greek, Germanic, French, Sanskrit, Arabic. Do NOT include grammatical suffixes like "-ate", "-ly", "-ness" unless they carry real meaning. If the etymology is unclear or the word is a modern loanword with no decomposable parts, return an EMPTY ARRAY. Never guess.

family — if authoritative related forms are supplied above, use exactly those and add nothing. Otherwise: OTHER words built from the same root, each with its part of speech in brackets, e.g. "obduracy (n.)", "obdurately (adv.)". The headword itself does NOT belong here, in any form — not "sanction (v.)" on the card for sanction, not "mitigate (v.)" on the card for mitigate. Plurals and simple inflections of the headword do not count as family either. Empty array if there are no genuine relatives.

examples — EXACTLY 2 sentences. BOTH must use the SAME sense you described in "formal". If the word has another common sense, ignore it entirely here. Editorial register: the voice of a serious newspaper or essay. Concrete subject matter, real-world stakes. Not textbook filler.
  GOOD: "The committee remained obdurate, dismissing three decades of evidence with a single procedural footnote."
  BAD: "He was obdurate."           (no content)
  BAD: "The obdurate man was obdurate about his obdurate opinion."  (padding)

mnemonic — ONE sentence tying the sound or the root to the meaning. It must be specific to this word and it must actually make sense. Do not invent fake words to make it rhyme. If a sound-based hook is weak, use the root instead.
  GOOD: "ob + DUR: durable against you — too hard to move."
  BAD: "Ob-DU-rate: think of DUry which means hard."  (invented word)

confusables — 0 to 3 REAL English words genuinely mistakable for the headword by sight or sound, but meaning something DIFFERENT. Never list a synonym here. Return an empty array rather than inventing one.
  GOOD: for "mitigate" -> ["militate"]  (near-identical spelling, unrelated meaning)
  GOOD: for "adverse" -> ["averse"]
  BAD: a misspelling of the headword
  BAD: a word that means the same thing
  BAD: another form of the headword itself — "obfuscation" or "obfuscatory" on the card for "obfuscate". Those belong in family.

ipa — the phonetic transcription if you are confident, otherwise null.

Return the JSON object only.`;

export function buildUserMessage(
  word: string,
  raw: RawPayload,
  encounter?: string
): string {
  const parts: string[] = [`Headword: ${word}`];

  if (raw.etymology) {
    parts.push(
      `Etymology (authoritative — derive "roots" from this, do not invent morphemes):
${raw.etymology}`
    );
  }

  if (raw.plainDefinitions.length) {
    parts.push(
      `Plain-English senses from a learner's dictionary (use these to shape "simple"):\n${raw.plainDefinitions
        .map((d) => `- ${d}`)
        .join('\n')}`
    );
  }

  if (raw.family.length) {
    parts.push(
      `Related forms (authoritative — use these verbatim for "family", add nothing of your own): ${raw.family.join(', ')}`
    );
  }

  if (raw.labels.length) {
    parts.push(`Register labels stated by the dictionary: ${raw.labels.join(', ')}`);
  }

  if (raw.usageExamples.length) {
    parts.push(
      `Real usage from the dictionary — match this register in your own examples, but do NOT copy these sentences:\n${raw.usageExamples
        .map((e) => `- ${e}`)
        .join('\n')}`
    );
  }

  if (raw.dictionary) {
    const senses = raw.dictionary.meanings
      .flatMap((m) =>
        m.definitions.slice(0, 3).map((d) => `- (${m.partOfSpeech}) ${d.definition}`)
      )
      .slice(0, 8);
    parts.push(`Dictionary senses (authoritative):\n${senses.join('\n')}`);
    if (raw.dictionary.phonetic) parts.push(`Phonetic: ${raw.dictionary.phonetic}`);
  } else {
    parts.push(
      'Dictionary data: NONE AVAILABLE. This word was confirmed to exist but no entry was returned. Use your own knowledge and stay conservative — if you are unsure of the sense, prefer the most common one.'
    );
  }

  parts.push(
    raw.synonymCandidates.length
      ? `Synonym candidates (noisy — select and discriminate, do not use all): ${raw.synonymCandidates.join(', ')}`
      : 'Synonym candidates: none returned. Supply your own.'
  );

  if (raw.antonymCandidates.length) {
    parts.push(`Antonym candidates: ${raw.antonymCandidates.join(', ')}`);
  }

  if (encounter) {
    parts.push(
      `The student met this word in the following sentence. If the word has several senses, build the card around THE SENSE USED HERE:\n"${encounter}"`
    );
  }

  return parts.join('\n\n');
}
