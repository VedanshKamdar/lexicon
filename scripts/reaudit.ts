/** Re-runs the audit over an existing seed file, without spending any quota. */
import { readFileSync } from 'node:fs';
import { auditCard } from './audit.js';
import type { GeneratedCard } from '../src/schema/card.js';

const file = process.argv[2] ?? 'lexicon-seed.json';
const backup = JSON.parse(readFileSync(file, 'utf8')) as { cards: GeneratedCard[] };

let clean = 0;
const bad: string[] = [];
for (const card of backup.cards) {
  const { problems, warnings } = auditCard(card);
  if (!problems.length) {
    clean++;
    if (warnings.length) console.log(`  ${card.display.padEnd(16)} · ${warnings.join(' | ')}`);
    continue;
  }
  bad.push(card.display);
  console.log(`⚠ ${card.display.padEnd(16)} ${problems.join(' | ')}`);
}
console.log(`\n${backup.cards.length} cards · ${clean} clean · ${bad.length} need regenerating`);
console.log(bad.length ? `\nregenerate: ${bad.join(' ')}` : '');
