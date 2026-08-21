/** Verifies the Merriam-Webster keys and shows what they add. Run after filling .env. */
import 'dotenv/config';
import { merriamDictionary, merriamThesaurus } from '../src/api/merriam';

const dk = process.env.MW_DICTIONARY_KEY;
const tk = process.env.MW_THESAURUS_KEY;

if (!dk || !tk) {
  console.error('Add MW_DICTIONARY_KEY and MW_THESAURUS_KEY to .env first.');
  process.exit(1);
}

for (const word of ['obdurate', 'zeitgeist', 'sanction', 'perspicacious', 'recieve', 'asdfgh']) {
  try {
    const d = await merriamDictionary(word, dk);
    if ('found' in d) {
      console.log(`${word.padEnd(15)} MISS — MW suggests: ${d.suggestions.join(', ') || '(none)'}`);
      continue;
    }
    const t = await merriamThesaurus(word, tk).catch(() => ({ synonyms: [], antonyms: [] }));
    console.log(
      `${word.padEnd(15)} ${d.meanings.length} pos  ipa:${d.phonetic ?? '-'}  audio:${d.audio ? 'yes' : 'no'}`
    );
    console.log(`   def: ${d.meanings[0].definitions[0].definition.slice(0, 80)}`);
    console.log(`   etymology: ${d.etymology?.slice(0, 100) ?? '(none)'}`);
    console.log(`   plain: ${d.plainDefinitions[0] ?? '(none)'}`);
    console.log(`   family: ${d.family.join(', ') || '(none)'}`);
    console.log(`   labels: ${d.labels.join(', ') || '(none)'}`);
    console.log(`   usage: ${d.usageExamples[0] ?? '(none)'}`);
    console.log(`   syns: ${t.synonyms.slice(0, 8).join(', ') || '(none)'}`);
    console.log(`   ants: ${t.antonyms.slice(0, 5).join(', ') || '(none)'}`);
  } catch (e) {
    console.log(`${word.padEnd(15)} ERROR ${(e as Error).message}`);
  }
}
