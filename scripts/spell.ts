import { suggestCorrections } from '../src/api/spellcheck';

const TYPOS = ['recieve', 'seperate', 'definately', 'acheive', 'obdurat', 'mitigat', 'perspicacous', 'occured'];
const CORRECT = ['obdurate', 'mitigate', 'perspicacious', 'laconic', 'zeitgeist', 'sanction'];

console.log('TYPOS — should suggest');
for (const w of TYPOS) {
  const s = await suggestCorrections(w);
  const list = s.map((x) => `${x.word} (${x.frequency.toFixed(2)})`).join(', ');
  console.log(`  ${w.padEnd(15)} ${list || '✗ NOTHING'}`);
}

console.log('\nCORRECTLY SPELLED — should stay silent');
for (const w of CORRECT) {
  const s = await suggestCorrections(w);
  const list = s.map((x) => x.word).join(', ');
  console.log(`  ${w.padEnd(15)} ${list ? '✗ FALSE POSITIVE: ' + list : 'silent'}`);
}
