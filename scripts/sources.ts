import { gather } from '../src/api/fetchers';

const WORDS = ['perspicacious', 'obdurate', 'zeitgeist', 'sanction', 'laconic', 'asdfgh', 'recieve'];

for (const w of WORDS) {
  const t0 = Date.now();
  const g = await gather(w);
  const ms = Date.now() - t0;
  if (!g) {
    console.log(`${w.padEnd(15)} NOT FOUND                     ${ms}ms`);
    continue;
  }
  const d = g.raw.dictionary;
  const senses = d?.meanings.reduce((n, m) => n + m.definitions.length, 0) ?? 0;
  console.log(
    `${w.padEnd(15)} ${(g.lowConfidence ? 'LOW CONFIDENCE' : 'defined').padEnd(15)} ` +
      `${String(senses).padStart(2)} senses  ipa:${d?.phonetic ? 'y' : 'n'}  audio:${g.audio ? 'y' : 'n'}  ` +
      `syn:${String(g.raw.synonymCandidates.length).padStart(2)}  ${ms}ms`
  );
}
