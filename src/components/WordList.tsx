import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StoredCard } from '../schema/card';
import { normalize } from '../db/queries';

const POS_SHORT: Record<string, string> = {
  adjective: 'adj',
  adverb: 'adv',
  noun: 'n',
  verb: 'v',
  pronoun: 'pron',
  preposition: 'prep',
  conjunction: 'conj',
  interjection: 'interj',
};

const shortPos = (pos: string) => POS_SHORT[pos.toLowerCase()] ?? pos.slice(0, 4);

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

type Sort = 'recent' | 'alpha';

function tabClass(active: boolean) {
  return `rounded-[5px] border px-2.5 py-1.5 font-mono text-[10px] tracking-[0.06em] whitespace-nowrap ${
    active ? 'border-accent bg-soft text-accent' : 'border-rule text-ink-3'
  }`;
}

const DAY_MS = 86_400_000;

/**
 * Weighted sample favouring words you have not looked at in a while.
 *
 * Uniform random treated a word opened a minute ago the same as one untouched
 * for a month, which made the strip decoration rather than the re-exposure
 * mechanism the whole book depends on. Weight rises with time since the word was
 * last seen and falls with how often it has been seen, so well-learned words
 * drift out of rotation without ever being excluded outright.
 *
 * Never-revisited words fall back to their creation date, so one saved last week
 * and ignored outranks one saved an hour ago.
 *
 * Sampling stays deterministic for a given seed, so a re-render does not churn.
 */
function pickForRevisit(cards: StoredCard[], n: number, seed: number): StoredCard[] {
  const now = Date.now();
  const pool = cards.map((card) => {
    const since = card.last_viewed_at ?? card.created_at;
    const days = Math.max(0, (now - since) / DAY_MS);
    // Square-rooted deliberately. The raw ratio between a month-old unseen word
    // and one read a minute ago runs to hundreds to one, which pinned the same
    // five in place and left the shuffle control doing nothing. Compressing it
    // keeps the strong bias while letting the rest of the book surface.
    return { card, weight: Math.sqrt((1 + days) / (1 + card.view_count)) };
  });

  const out: StoredCard[] = [];
  let s = seed;
  while (pool.length && out.length < n) {
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    let r = (s / 0x7fffffff) * total;
    let i = 0;
    while (i < pool.length - 1 && r > pool[i].weight) {
      r -= pool[i].weight;
      i++;
    }
    out.push(pool.splice(i, 1)[0].card);
  }
  return out;
}

export function WordList({
  cards,
  onOpen,
  onLookup,
  selected = null,
  footer,
  pinnedFooter,
  onStartTest,
}: {
  cards: StoredCard[];
  onOpen: (lemma: string) => void;
  onLookup: (word: string, encounter?: string) => void;
  selected?: string | null;
  footer?: React.ReactNode;
  /** Stays put below the list instead of scrolling away as the deck grows. */
  pinnedFooter?: React.ReactNode;
  onStartTest?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [seed, setSeed] = useState(1);
  const [railLetter, setRailLetter] = useState<string | null>(null);
  const [railActive, setRailActive] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const [encounter, setEncounter] = useState('');
  const [showEncounter, setShowEncounter] = useState(false);

  const scrollBox = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? cards.filter((c) => c.lemma.includes(q) || c.simple.toLowerCase().includes(q))
      : cards;
    return [...matched].sort((a, b) =>
      sort === 'recent' ? b.created_at - a.created_at : a.lemma.localeCompare(b.lemma)
    );
  }, [cards, query, sort]);

  const groups = useMemo(() => {
    if (sort !== 'alpha') return [{ key: 'ALL', showKey: false, rows }];
    const out: Array<{ key: string; showKey: boolean; rows: StoredCard[] }> = [];
    for (const r of rows) {
      const key = (r.display[0] ?? '?').toUpperCase();
      const last = out[out.length - 1];
      if (last?.key === key) last.rows.push(r);
      else out.push({ key, showKey: true, rows: [r] });
    }
    return out;
  }, [rows, sort]);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of cards) {
      const k = (c.display[0] ?? '?').toUpperCase();
      map[k] = (map[k] ?? 0) + 1;
    }
    return map;
  }, [cards]);

  const revisit = useMemo(() => pickForRevisit(cards, 5, seed), [cards, seed]);

  const showRail = sort === 'alpha' && !query && rows.length > 0;
  const countLabel =
    rows.length === cards.length
      ? `${cards.length} ${cards.length === 1 ? 'word' : 'words'}`
      : `${rows.length} of ${cards.length}`;

  const scrollToLetter = useCallback((letter: string) => {
    const box = scrollBox.current;
    const el = document.getElementById(`lx-group-${letter}`);
    if (!box || !el) return;
    box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top;
  }, []);

  const railPick = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const i = Math.max(
        0,
        Math.min(ALPHA.length - 1, Math.floor(((e.clientY - rect.top) / rect.height) * ALPHA.length))
      );
      const letter = ALPHA[i];
      setRailLetter(letter);
      if (counts[letter]) scrollToLetter(letter);
    },
    [counts, scrollToLetter]
  );

  /*
   * Keyboard navigation for the split view: "/" jumps to search, j and k walk the
   * list, Enter opens. Bound at the document so it works without the list having
   * focus, and ignored whenever a text field is active so typing still types.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el as HTMLElement | null)?.isContentEditable;

      if (e.key === 'Escape' && typing) {
        (el as HTMLElement).blur();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '/') {
        e.preventDefault();
        searchInput.current?.focus();
        return;
      }
      if (e.key === 'j' || e.key === 'k') {
        if (!rows.length) return;
        e.preventDefault();
        setCursor((c) => {
          const next = e.key === 'j' ? Math.min(rows.length - 1, c + 1) : Math.max(0, c - 1);
          document
            .getElementById(`lx-row-${rows[next].lemma}`)
            ?.scrollIntoView({ block: 'nearest' });
          return next;
        });
        return;
      }
      if (e.key === 'Enter' && cursor >= 0 && rows[cursor]) {
        e.preventDefault();
        onOpen(rows[cursor].lemma);
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [rows, cursor, onOpen]);

  // A changed result set makes the old index meaningless.
  useEffect(() => setCursor(-1), [query, sort]);

  /**
   * Offered only when the typed word is not already saved — that is the moment
   * an encounter sentence is worth recording, and it keeps the default list
   * header as tight as the design intends.
   */
  const isNewWord = Boolean(query.trim()) && !cards.some((c) => c.lemma === normalize(query));

  function lookUp(word: string) {
    if (!word) return;
    const sentence = encounter.trim();
    setEncounter('');
    setShowEncounter(false);
    onLookup(word, sentence || undefined);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    lookUp(query.trim());
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-none border-b border-rule bg-surface px-[18px] pb-3 pt-1.5">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-ink">
            Lexicon
          </span>
          <div className="flex items-baseline gap-3">
            <span className="whitespace-nowrap font-mono text-[11px] text-ink-3">
              {countLabel}
            </span>
            {onStartTest && (
              <button
                onClick={onStartTest}
                className="whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.1em] text-accent"
              >
                Test
              </button>
            )}
          </div>
        </div>

        <form
          onSubmit={submit}
          className="flex h-11 items-center gap-2.5 rounded-[9px] border border-rule bg-bg px-3"
        >
          <span className="font-mono text-[13px] text-ink-3" aria-hidden="true">
            ›
          </span>
          <input
            ref={searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Look up a word"
            aria-label="Look up or filter words"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            className="min-w-0 flex-1 border-none bg-transparent text-ink outline-none placeholder:text-ink-3"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear"
              className="px-1 text-[15px] text-ink-3"
            >
              ×
            </button>
          )}
        </form>

        <div className="mt-[11px] flex items-center justify-between">
          <div className="flex gap-[3px]">
            <button onClick={() => setSort('recent')} className={tabClass(sort === 'recent')}>
              Recent
            </button>
            <button onClick={() => setSort('alpha')} className={tabClass(sort === 'alpha')}>
              A–Z
            </button>
          </div>
          <span className="font-mono text-[10px] tracking-[0.06em] text-ink-3">
            {query ? 'filtering saved' : 'all saved'}
          </span>
        </div>

        {isNewWord &&
          (showEncounter ? (
            <textarea
              value={encounter}
              onChange={(e) => setEncounter(e.target.value)}
              rows={2}
              autoFocus
              placeholder="Paste the sentence you met it in"
              className="mt-2.5 w-full resize-none rounded-[9px] border border-rule bg-bg px-3 py-2.5 text-[13px] leading-snug text-ink outline-none placeholder:text-ink-3"
            />
          ) : (
            <button
              onClick={() => setShowEncounter(true)}
              className="mt-2.5 font-mono text-[10px] tracking-[0.06em] text-accent"
            >
              + add the sentence you met it in
            </button>
          ))}
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div ref={scrollBox} className="lxsc min-w-0 flex-1 overflow-y-auto">
          {!query && revisit.length > 0 && (
            <div className="border-b border-rule bg-surface px-[18px] pb-4 pt-[15px]">
              <div className="mb-[11px] flex items-baseline justify-between">
                <span className="whitespace-nowrap font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-accent">
                  Revisit · {revisit.length} least recent
                </span>
                <button
                  onClick={() => setSeed((s) => s + 1)}
                  className="font-mono text-[9.5px] text-ink-3"
                >
                  shuffle
                </button>
              </div>
              <div className="flex flex-wrap gap-[7px]">
                {revisit.map((v) => (
                  <button
                    key={v.lemma}
                    onClick={() => onOpen(v.lemma)}
                    className="rounded-md border border-rule bg-bg px-[11px] py-[9px] font-serif text-[15px] text-ink"
                  >
                    {v.display}
                  </button>
                ))}
              </div>
            </div>
          )}

          {groups.map((g) => (
            <div key={g.key} id={`lx-group-${g.key}`}>
              {g.showKey && (
                <div className="sticky top-0 z-[2] whitespace-nowrap border-b border-rule bg-bg px-[18px] py-[7px] font-mono text-[9.5px] font-medium uppercase tracking-[0.16em] text-ink-3">
                  {g.key}
                </div>
              )}
              {g.rows.map((r) => (
                <button
                  key={r.lemma}
                  id={`lx-row-${r.lemma}`}
                  onClick={() => onOpen(r.lemma)}
                  className={`block w-full border-b border-rule-2 px-[18px] py-3.5 text-left ${
                    r.lemma === selected || rows[cursor]?.lemma === r.lemma
                      ? 'bg-soft'
                      : 'bg-surface'
                  }`}
                >
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="font-serif text-[18px] leading-[1.15] text-ink">
                      {r.display}
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3">
                      {shortPos(r.pos)}
                    </span>
                    {r.view_count === 0 && (
                      <span
                        className="h-[5px] w-[5px] flex-none rounded-full bg-accent"
                        aria-label="not yet revisited"
                      />
                    )}
                  </div>
                  <div className="mt-1 truncate text-[13px] leading-[1.35] text-ink-2">
                    {r.simple}
                  </div>
                </button>
              ))}
            </div>
          ))}

          {rows.length === 0 && (
            <div className="bg-surface px-[26px] py-11 text-center">
              <p className="mb-2 font-serif text-[20px] leading-[1.35] text-ink">
                {cards.length === 0 ? 'Nothing saved yet' : `No saved word matches “${query}”`}
              </p>
              <p className="mb-[18px] text-[13px] leading-[1.5] text-ink-2">
                {cards.length === 0
                  ? 'Look up your first word to start the book.'
                  : 'It may still be a real word — look it up.'}
              </p>
              {query && (
                <button
                  onClick={() => lookUp(query.trim())}
                  className="min-h-[44px] rounded-lg bg-accent px-[18px] py-3.5 text-[14px] text-on-accent"
                >
                  Look up “{query.trim()}”
                </button>
              )}
            </div>
          )}

          {footer}
          {/* Clears the iOS home indicator, which otherwise covers the last rows. */}
          <div
            className="h-10"
            style={{ height: 'calc(2.5rem + env(safe-area-inset-bottom))' }}
          />
        </div>

        {showRail && (
          <div
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setRailActive(true);
              railPick(e);
            }}
            onPointerMove={(e) => railActive && railPick(e)}
            onPointerUp={() => setRailActive(false)}
            onPointerLeave={() => setRailActive(false)}
            className="absolute bottom-0 right-0 top-0 z-[3] flex w-[26px] touch-none flex-col items-center justify-center bg-gradient-to-l from-surface to-transparent"
          >
            {ALPHA.map((l) => (
              <span
                key={l}
                className={`flex min-h-0 flex-1 select-none items-center justify-center font-mono text-[9px] font-medium tracking-[0.04em] ${
                  l === railLetter && counts[l]
                    ? 'text-accent'
                    : counts[l]
                      ? 'text-ink-2'
                      : 'text-ink-3 opacity-40'
                }`}
              >
                {l}
              </span>
            ))}
          </div>
        )}

        {railActive && railLetter && (
          <div className="pointer-events-none absolute right-[34px] top-1/2 z-[4] min-w-16 -translate-y-1/2 rounded-xl bg-accent px-4 py-3.5 text-center text-on-accent shadow-lg">
            <div className="font-serif text-[30px] leading-none">{railLetter}</div>
            <div className="mt-1.5 whitespace-nowrap font-mono text-[9px] tracking-[0.1em] opacity-75">
              {counts[railLetter]
                ? `${counts[railLetter]} ${counts[railLetter] === 1 ? 'word' : 'words'}`
                : 'no words'}
            </div>
          </div>
        )}
      </div>

      {pinnedFooter}
    </div>
  );
}
