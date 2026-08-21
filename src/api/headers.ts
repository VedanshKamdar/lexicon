/**
 * Headers for every /api call.
 *
 * When the deployment sets APP_SECRET, the server rejects requests without a
 * matching x-app-secret. The client's copy has to be a VITE_ variable, which
 * means it is compiled into the bundle and anyone who reads the source can
 * extract it.
 *
 * So be clear about what this buys: it stops opportunistic scanners from finding
 * an unauthenticated endpoint that spends your Groq and Merriam-Webster quota,
 * and it stops /api/sync being writable by anything that stumbles across the URL.
 * It is not authentication and will not stop someone who actually wants in. For
 * that, put Vercel Deployment Protection in front of the whole deployment.
 */
export function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const secret = import.meta.env.VITE_APP_SECRET;
  if (secret) headers['x-app-secret'] = secret;
  return headers;
}
