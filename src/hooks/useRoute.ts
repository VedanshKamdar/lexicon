import { useCallback, useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'list' }
  | { name: 'quiz' }
  | { name: 'word'; lemma: string };

export function parseRoute(pathname: string): Route {
  if (pathname === '/words') return { name: 'list' };
  if (pathname === '/test') return { name: 'quiz' };
  const match = /^\/w\/(.+)$/.exec(pathname);
  if (match) return { name: 'word', lemma: decodeURIComponent(match[1]) };
  return { name: 'home' };
}

export function routePath(route: Route): string {
  if (route.name === 'list') return '/words';
  if (route.name === 'quiz') return '/test';
  if (route.name === 'word') return `/w/${encodeURIComponent(route.lemma)}`;
  return '/';
}

/**
 * Routing through the History API rather than React state, so the platform's own
 * back affordances work: the iOS edge-swipe gesture and the desktop back button
 * both map to history.back(), which does nothing at all in a state-only SPA.
 *
 * Scroll position is stored on each history entry and restored on pop, so going
 * back to a long card returns you to where you were rather than to the top.
 */
/** What the back control should say when this entry is on screen. */
function labelFor(route: Route): string {
  if (route.name === 'word') return route.lemma;
  if (route.name === 'quiz') return 'the test';
  // Home is the word list, so that is what "back" returns you to.
  return 'All words';
}

interface HistoryEntry {
  scrollY?: number;
  from?: string;
}

/**
 * Restoring scroll on back is a race against three renders: the outgoing card is
 * still mounted when popstate fires, then the loading skeleton shrinks the
 * document (which clamps scroll to 0), then the real card grows it again.
 * Re-apply the target every frame until it sticks, and abandon it the moment the
 * user scrolls, so we never fight their thumb.
 */
function restoreScroll(target: number): void {
  if (target <= 0) {
    window.scrollTo(0, 0);
    return;
  }

  const deadline = performance.now() + 800;
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };

  window.addEventListener('wheel', cancel, { passive: true });
  window.addEventListener('touchstart', cancel, { passive: true });

  const stop = () => {
    window.removeEventListener('wheel', cancel);
    window.removeEventListener('touchstart', cancel);
  };

  const tick = () => {
    if (cancelled) return stop();
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const goal = Math.min(target, max);
    if (Math.round(window.scrollY) !== goal) window.scrollTo(0, goal);
    // Deliberately runs the full window rather than stopping once the offset
    // matches: hitting the target early is meaningless while the outgoing card
    // is still mounted, because the skeleton then shrinks the page under us.
    if (performance.now() < deadline) requestAnimationFrame(tick);
    else stop();
  };

  requestAnimationFrame(tick);
}

export function useRoute() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const [backLabel, setBackLabel] = useState<string | null>(
    () => (history.state as HistoryEntry | null)?.from ?? null
  );

  useEffect(() => {
    // We manage scroll ourselves; the browser's guess is wrong for a virtual DOM.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

    const onPop = (e: PopStateEvent) => {
      const entry = e.state as HistoryEntry | null;
      setRoute(parseRoute(window.location.pathname));
      setBackLabel(entry?.from ?? null);
      restoreScroll(entry?.scrollY ?? 0);
    };

    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((next: Route, options: { replace?: boolean } = {}) => {
    const path = routePath(next);

    if (path === window.location.pathname && !options.replace) {
      setRoute(next);
      return;
    }

    if (options.replace) {
      history.replaceState({ scrollY: 0, from: (history.state as HistoryEntry)?.from }, '', path);
    } else {
      // location.pathname is still the old route here, so this names where the
      // user is coming from — that becomes the back control's label.
      const from = labelFor(parseRoute(window.location.pathname));
      history.replaceState({ ...history.state, scrollY: window.scrollY }, '');
      history.pushState({ scrollY: 0, from }, '', path);
      setBackLabel(from);
    }

    setRoute(next);
    window.scrollTo(0, 0);
  }, []);

  const back = useCallback(() => {
    // Only step back if this session actually has somewhere to go; otherwise a
    // direct load of /w/obdurate would send the user out of the app.
    if (window.history.length > 1) history.back();
    else navigate({ name: 'home' }, { replace: true });
  }, [navigate]);

  return { route, navigate, back, backLabel };
}
