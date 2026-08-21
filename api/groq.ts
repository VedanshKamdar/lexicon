import { z } from 'zod';
import { GeneratedCardSchema, type GeneratedCard } from '../src/schema/card';
import type { RawPayload } from '../src/schema/raw';
import { SYSTEM_PROMPT, buildUserMessage } from './prompt';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Groq's strict mode uses constrained decoding, which supports a subset of JSON
 * Schema: no minItems/maxItems/minLength/maxLength, every property must be in
 * `required`, and every object needs additionalProperties:false. We therefore
 * send a relaxed schema and rely on Zod for the count and length constraints —
 * which is why validation can still fail and the repair retry below exists.
 */
function toStrictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStrictSchema);
  if (!node || typeof node !== 'object') return node;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (['minItems', 'maxItems', 'minLength', 'maxLength', '$schema', 'additionalProperties'].includes(k)) continue;
    out[k] = toStrictSchema(v);
  }
  if (out.type === 'object' && out.properties) {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as Record<string, unknown>);
  }
  return out;
}

const CARD_JSON_SCHEMA = toStrictSchema(z.toJSONSchema(GeneratedCardSchema));

interface GroqOptions {
  apiKey: string;
  model: string;
  fallbackModel?: string;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Groq bills TPM on reserved tokens, so this is what the budget actually sees. */
  remainingTokens: number | null;
  resetTokens: string | null;
}

let lastUsage: Usage | null = null;

/** Last request's token accounting — used by the bulk seeder to pace itself. */
export function getLastUsage(): Usage | null {
  return lastUsage;
}

async function callGroq(
  messages: Array<{ role: string; content: string }>,
  model: string,
  apiKey: string
): Promise<{ ok: true; content: string } | { ok: false; status: number; error: string }> {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.6,
      /*
       * Groq bills TPM on prompt + max_completion_tokens RESERVED, not actual
       * usage. At 3000 the richer Merriam-Webster prompt reserved ~4.8K of the
       * 8K/min free-tier ceiling, allowing barely one lookup a minute. Real
       * completions run ~1.3K, so 2000 leaves headroom and doubles throughput.
       */
      max_completion_tokens: 2000,
      // The first bare-prompt run spent 1034 of 1312 tokens on internal reasoning.
      // "low" leaves the budget for the card itself and roughly halves latency.
      reasoning_effort: 'low',
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'vocab_card', strict: true, schema: CARD_JSON_SCHEMA },
      },
    }),
  });

  if (!res.ok) {
    return { ok: false, status: res.status, error: (await res.text()).slice(0, 300) };
  }
  const json = await res.json();
  lastUsage = {
    promptTokens: json?.usage?.prompt_tokens ?? 0,
    completionTokens: json?.usage?.completion_tokens ?? 0,
    totalTokens: json?.usage?.total_tokens ?? 0,
    remainingTokens: Number(res.headers.get('x-ratelimit-remaining-tokens')) || null,
    resetTokens: res.headers.get('x-ratelimit-reset-tokens'),
  };
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    return { ok: false, status: 502, error: 'No content in Groq response' };
  }
  return { ok: true, content };
}

/** Groq puts the wait time in the error text; surface it instead of a raw 429 dump. */
function retryAfterSeconds(error: string): number | null {
  const match = /try again in ([\d.]+)s/.exec(error);
  return match ? Math.ceil(Number(match[1])) : null;
}

function describeIssues(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

export interface GenerateResult {
  card: GeneratedCard;
  model: string;
  repaired: boolean;
}

export async function generateCard(
  word: string,
  raw: RawPayload,
  encounter: string | undefined,
  opts: GroqOptions
): Promise<GenerateResult> {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserMessage(word, raw, encounter) },
  ];

  const models = [opts.model, ...(opts.fallbackModel ? [opts.fallbackModel] : [])];
  let lastError = 'Generation failed';

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await callGroq(messages, model, opts.apiKey);

      if (!res.ok) {
        lastError =
          res.status === 429
            ? `Rate limited${retryAfterSeconds(res.error) ? ` — try again in about ${retryAfterSeconds(res.error)}s` : ''}.`
            : `Groq ${res.status}: ${res.error}`;
        // Rate limited or upstream fault — try the fallback model rather than retrying here.
        if (res.status === 429 || res.status >= 500) break;
        continue;
      }

      // Strict mode guarantees parseable JSON, but never assume it.
      let parsed: unknown;
      try {
        parsed = JSON.parse(res.content);
      } catch {
        lastError = 'Model returned unparseable JSON';
        continue;
      }

      const check = GeneratedCardSchema.safeParse(parsed);
      if (check.success) {
        return { card: check.data, model, repaired: attempt > 0 };
      }

      lastError = describeIssues(check.error);
      if (attempt === 0) {
        messages.push({ role: 'assistant', content: res.content });
        messages.push({
          role: 'user',
          content: `That response broke these rules: ${lastError}. Fix only those problems and return the corrected JSON object.`,
        });
      }
    }
  }

  throw new Error(lastError);
}
