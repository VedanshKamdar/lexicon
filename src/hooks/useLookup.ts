import { useCallback, useState } from 'react';
import { GeneratedCardSchema, type StoredCard } from '../schema/card';
import { normalize, getCard, saveCard, toStoredCard, addEncounter, recordView } from '../db/queries';
import { apiHeaders } from '../api/headers';

export interface LedgerEntry {
  label: string;
  detail: string;
  ok: boolean;
}

/** What is known about a word while the model is still writing the card. */
export interface Pending {
  word: string;
  ipa: string | null;
  pos: string | null;
  ledger: LedgerEntry[];
}

export type LookupState =
  | { status: 'idle' }
  | { status: 'resolving'; word: string }
  | { status: 'generating'; pending: Pending }
  | { status: 'success'; card: StoredCard; didYouMean: string[] }
  | { status: 'not_found'; word: string; suggestions: string[] }
  | { status: 'misspelling'; word: string; correction: string; alternatives: string[] }
  | { status: 'error'; word: string; reason: string };

const RESOLVE_TIMEOUT_MS = 10000;
const GENERATE_TIMEOUT_MS = 25000;

async function post(path: string, body: unknown, timeout: number) {
  const res = await fetch(path, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  return { res, payload: await res.json().catch(() => ({}) as any) };
}

export function useLookup() {
  const [state, setState] = useState<LookupState>({ status: 'idle' });

  const lookup = useCallback(async (input: string, encounter?: string) => {
    const lemma = normalize(input);
    if (!lemma) return;

    setState({ status: 'resolving', word: lemma });

    // Cache first: a hit must render with zero network traffic.
    const cached = await getCard(lemma);
    if (cached) {
      const view_count = await recordView(lemma);
      if (encounter) await addEncounter(lemma, encounter, null);
      setState({
        status: 'success',
        card: { ...cached, view_count, last_viewed_at: Date.now() },
        didYouMean: [],
      });
      return;
    }

    if (!navigator.onLine) {
      setState({
        status: 'error',
        word: lemma,
        reason: 'You’re offline — saved words still work, but new ones need a connection.',
      });
      return;
    }

    try {
      const { res, payload } = await post('/api/resolve', { word: lemma }, RESOLVE_TIMEOUT_MS);

      if (!res.ok) {
        setState({
          status: 'error',
          word: lemma,
          reason: payload?.error ?? `Lookup service returned ${res.status}.`,
        });
        return;
      }

      if (payload.status === 'not_found') {
        setState({ status: 'not_found', word: lemma, suggestions: payload.suggestions ?? [] });
        return;
      }

      if (payload.status === 'misspelling') {
        setState({
          status: 'misspelling',
          word: lemma,
          correction: payload.correction,
          alternatives: payload.alternatives ?? [],
        });
        return;
      }

      // Everything cheap has landed — paint it rather than holding a blank screen
      // for the seconds the model takes.
      const pending: Pending = {
        word: lemma,
        ipa: payload.preview?.ipa ?? null,
        pos: payload.preview?.pos ?? null,
        ledger: payload.ledger ?? [],
      };
      setState({ status: 'generating', pending });

      // The dictionary payload never leaves the server, so this only sends the
      // word again; the server reuses what /api/resolve already fetched.
      const generated = await post('/api/generate', { word: lemma, encounter }, GENERATE_TIMEOUT_MS);

      if (!generated.res.ok) {
        setState({
          status: 'error',
          word: lemma,
          reason: generated.payload?.error ?? `Card service returned ${generated.res.status}.`,
        });
        return;
      }

      // Never trust the wire: validate again before anything reaches storage.
      const parsed = GeneratedCardSchema.safeParse(generated.payload?.card);
      if (!parsed.success) {
        setState({
          status: 'error',
          word: lemma,
          reason: 'The generated card failed validation and was not saved.',
        });
        return;
      }

      const card = toStoredCard(
        lemma,
        parsed.data,
        generated.payload.audio ?? payload.audio ?? null,
        Boolean(generated.payload.lowConfidence ?? payload.lowConfidence)
      );
      await saveCard(card);
      if (encounter) await addEncounter(lemma, encounter, null);
      setState({ status: 'success', card, didYouMean: payload.didYouMean ?? [] });
    } catch (e) {
      const err = e as Error;
      setState({
        status: 'error',
        word: lemma,
        reason: err.name === 'TimeoutError' ? 'That took too long. Try again.' : err.message,
      });
    }
  }, []);

  const reset = useCallback(() => setState({ status: 'idle' }), []);

  return { state, lookup, reset };
}
