/**
 * Prompt iteration harness. Runs the real pipeline for one or more words and
 * prints the card plus a quality audit, without any UI or storage in the way.
 *
 *   npx tsx scripts/try.ts obdurate sanction zeitgeist
 */
import 'dotenv/config';
import { gather } from '../src/api/fetchers';
import { generateCard } from '../api/groq';
import { auditCard } from './audit';

async function run(word: string) {
  const t0 = Date.now();
  const gathered = await gather(word, {
    mwDictionary: process.env.MW_DICTIONARY_KEY,
    mwThesaurus: process.env.MW_THESAURUS_KEY,
  });
  const tGather = Date.now() - t0;

  if (!gathered) {
    console.log(`\n=== ${word} ===\nNOT FOUND (dictionary miss + no Datamuse match) [${tGather}ms]`);
    return;
  }

  const t1 = Date.now();
  const { card, model, repaired } = await generateCard(word, gathered.raw, undefined, {
    apiKey: process.env.GROQ_API_KEY!,
    model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b',
    fallbackModel: process.env.GROQ_FALLBACK_MODEL,
  });
  const tGen = Date.now() - t1;

  console.log(`\n=== ${word} ===`);
  console.log(
    `gather ${tGather}ms · generate ${tGen}ms · total ${tGather + tGen}ms · ${model}` +
      `${repaired ? ' · REPAIRED' : ''}${gathered.lowConfidence ? ' · LOW CONFIDENCE' : ''}`
  );
  console.log(`\n${card.display}  ${card.ipa ?? ''}  (${card.pos})  [${card.connotation}/${card.register}]`);
  console.log(`  simple: ${card.simple}`);
  console.log(`  formal: ${card.formal}`);
  console.log('  synonyms:');
  for (const s of card.synonyms) console.log(`    ${s.word.padEnd(16)} ${s.note}`);
  console.log(`  antonyms: ${card.antonyms.join(', ') || '(none)'}`);
  console.log(`  roots: ${card.roots.map((r) => `${r.part}=${r.meaning} (${r.origin})`).join(' + ') || '(none)'}`);
  console.log(`  family: ${card.family.join(', ') || '(none)'}`);
  for (const ex of card.examples) console.log(`  ex: ${ex}`);
  console.log(`  mnemonic: ${card.mnemonic}`);
  console.log(`  confusables: ${card.confusables.join(', ') || '(none)'}`);

  const problems = auditCard(card);
  console.log(problems.length ? `\n  ⚠ AUDIT: ${problems.join(' | ')}` : '\n  ✓ audit clean');
}

const words = process.argv.slice(2);
if (!words.length) {
  console.error('usage: npx tsx scripts/try.ts <word> [word...]');
  process.exit(1);
}

for (const w of words) {
  await run(w.toLowerCase()).catch((e) => console.error(`\n=== ${w} ===\nFAILED: ${e.message}`));
}
