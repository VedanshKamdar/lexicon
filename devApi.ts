import type { Plugin } from 'vite';

/**
 * Serves /api/generate during `vite dev` using the same handler Vercel runs in
 * production, so there is no second code path and no need for `vercel dev`.
 */
export function devApi(): Plugin {
  return {
    name: 'lexicon-dev-api',
    apply: 'serve',
    configureServer(server) {
      const mount = (path: string, moduleId: string, exportName: string) =>
        server.middlewares.use(path, async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');

          const mod = await server.ssrLoadModule(moduleId);
          const { status, body } = await mod[exportName](
            parsed,
            req.headers as Record<string, string | undefined>
          );
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: (e as Error).message }));
        }
        });

      mount('/api/resolve', '/api/handler.ts', 'handleResolve');
      mount('/api/generate', '/api/handler.ts', 'handleGenerate');
      mount('/api/sync', '/api/syncHandler.ts', 'handleSync');
    },
  };
}
