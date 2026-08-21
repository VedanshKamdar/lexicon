import { gather, wiktionary, freeDictionary } from '../src/api/fetchers.js';
for (const w of ['recieve', 'seperate', 'definately']) {
  const g = await gather(w);
  const wk = await wiktionary(w).catch((e) => ({ err: e.message }) as any);
  const fd = await freeDictionary(w).catch((e) => ({ err: e.message }) as any);
  console.log(`${w}: misspellingOf=${g?.misspellingOf ?? 'null'}`);
  console.log(`   wiktionary: ${wk.err ?? JSON.stringify(wk.meanings?.[0]?.definitions?.[0])}`);
  console.log(`   dictapi   : ${fd.err ?? JSON.stringify(fd.meanings?.[0]?.definitions?.[0]).slice(0, 90)}`);
}
