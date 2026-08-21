import { handleSync } from './syncHandler';

/** Vercel serverless entry point. */
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { status, body } = await handleSync(req.body, req.headers);
  res.status(status).json(body);
}
