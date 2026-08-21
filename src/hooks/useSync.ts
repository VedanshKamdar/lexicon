import { useCallback, useEffect, useRef, useState } from 'react';
import { sync, lastSyncAt, SyncDisabled, type SyncResult } from '../db/sync';

export type SyncState =
  | { status: 'idle'; at: number }
  | { status: 'syncing' }
  | { status: 'disabled' }
  | { status: 'error'; message: string };

/**
 * Syncs on mount and whenever the tab becomes visible again — which covers the
 * realistic case of looking a word up on the phone, then opening the laptop.
 * Never runs while offline, and never runs two at once.
 */
export function useSync(enabled = true) {
  const [state, setState] = useState<SyncState>({ status: 'idle', at: lastSyncAt() });
  const running = useRef(false);
  const stateRef = useRef<SyncState['status']>('idle');
  stateRef.current = state.status;

  const run = useCallback(async (): Promise<SyncResult | null> => {
    if (running.current || !navigator.onLine) return null;
    if (stateRef.current === 'disabled') return null;
    running.current = true;
    setState({ status: 'syncing' });
    try {
      const result = await sync();
      setState({ status: 'idle', at: result.at });
      return result;
    } catch (e) {
      // A deployment without Turso credentials is local-only by choice, not
      // broken — say nothing rather than showing a standing error.
      setState(
        e instanceof SyncDisabled
          ? { status: 'disabled' }
          : { status: 'error', message: (e as Error).message }
      );
      return null;
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void run();

    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [enabled, run]);

  return { state, syncNow: run };
}
