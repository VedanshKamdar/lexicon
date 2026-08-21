/**
 * Diagnostic probe. Imports nothing at module scope, so it loads even when the
 * real functions cannot, then reports which of their imports fails and why.
 *
 * Temporary — delete once the deployment is healthy.
 */
export default async function handler(_req: unknown, res: any) {
  const report: Record<string, unknown> = {
    node: process.version,
    cwd: process.cwd(),
    // Presence only. Never the values.
    env: {
      GROQ_API_KEY: Boolean(process.env.GROQ_API_KEY),
      MW_DICTIONARY_KEY: Boolean(process.env.MW_DICTIONARY_KEY),
      MW_THESAURUS_KEY: Boolean(process.env.MW_THESAURUS_KEY),
      APP_SECRET: Boolean(process.env.APP_SECRET),
      TURSO_DATABASE_URL: Boolean(process.env.TURSO_DATABASE_URL),
    },
  };

  const probe = async (label: string, load: () => Promise<unknown>) => {
    try {
      await load();
      report[label] = 'ok';
    } catch (e) {
      report[label] = String((e as Error)?.stack ?? e).slice(0, 400);
    }
  };

  await probe('import ../src/schema/raw', () => import('../src/schema/raw.js'));
  await probe('import ../src/schema/card', () => import('../src/schema/card.js'));
  await probe('import ../src/api/fetchers', () => import('../src/api/fetchers.js'));
  await probe('import ./prompt', () => import('./prompt.js'));
  await probe('import ./groq', () => import('./groq.js'));
  await probe('import ./handler', () => import('./handler.js'));
  await probe('import ./syncHandler', () => import('./syncHandler.js'));
  await probe('import @libsql/client', () => import('@libsql/client'));

  res.status(200).json(report);
}
