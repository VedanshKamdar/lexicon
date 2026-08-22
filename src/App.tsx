import { useEffect, useRef, useState } from 'react';
import { Card } from './components/Card';
import { WordList } from './components/WordList';
import { Quiz } from './components/Quiz';
import {
  GeneratingCard,
  ResolvingCard,
  NotFound,
  ErrorState,
  OfflineNotice,
  DidYouMean,
  ConfirmDelete,
  Misspelling,
} from './components/states';
import { BackupControls } from './components/BackupControls';
import { InstallHint } from './components/InstallHint';
import { useLookup } from './hooks/useLookup';
import { useCards, useEncounters } from './hooks/useCards';
import { useRoute } from './hooks/useRoute';
import { useSync } from './hooks/useSync';
import { useIsDesktop } from './hooks/useIsDesktop';
import { storageBroken } from './db/schema';
import { deleteCard, normalize, recordView } from './db/queries';

export default function App() {
  const { route, navigate, back, backLabel } = useRoute();
  const isDesktop = useIsDesktop();
  const [offline, setOffline] = useState(!navigator.onLine);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const { state, lookup, reset } = useLookup();
  const { state: syncState, syncNow } = useSync();

  // The encounter sentence belongs to a submission, not to the URL, so it rides
  // alongside the navigation and is consumed once by the lookup it triggered.
  const pendingEncounter = useRef<{ lemma: string; sentence: string } | null>(null);
  // Guards against React StrictMode running the effect twice and firing two
  // generations for the same word.
  const lastRun = useRef<string | null>(null);
  const lastCount = useRef<number | null>(null);

  const cards = useCards();
  const activeLemma = state.status === 'success' ? state.card.lemma : null;
  const encounters = useEncounters(activeLemma);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // The list is home now, so /words from an older session is the same page.
  useEffect(() => {
    if (route.name === 'list') navigate({ name: 'home' }, { replace: true });
  }, [route, navigate]);

  // The route is the source of truth: landing on /w/<word> — by submitting, by
  // tapping a synonym, or by swiping back — is what runs the lookup.
  useEffect(() => {
    if (route.name !== 'word') {
      reset();
      lastRun.current = null;
      return;
    }
    const key = `${route.lemma}:${retryToken}`;
    if (lastRun.current === key) return;
    lastRun.current = key;

    const pending = pendingEncounter.current;
    const sentence = pending?.lemma === route.lemma ? pending.sentence : undefined;
    pendingEncounter.current = null;

    void lookup(route.lemma, sentence);
  }, [route, retryToken, lookup, reset]);

  useEffect(() => {
    if (cards === undefined) return;
    if (lastCount.current !== null && cards.length !== lastCount.current) void syncNow();
    lastCount.current = cards.length;
  }, [cards, syncNow]);

  function openWord(word: string, encounter?: string) {
    const lemma = normalize(word);
    if (!lemma) return;
    if (encounter) pendingEncounter.current = { lemma, sentence: encounter };
    setPendingDelete(null);
    navigate({ name: 'word', lemma });
  }

  async function confirmDelete(lemma: string) {
    await deleteCard(lemma);
    setPendingDelete(null);
    navigate({ name: 'home' }, { replace: true });
  }

  const banners = (
    <>
      {offline && (
        <div className="mb-4">
          <OfflineNotice />
        </div>
      )}
      {storageBroken && (
        <div className="mb-4 rounded-lg bg-warnsoft px-[17px] py-3 text-[12.5px] text-warn">
          Storage is unavailable ({storageBroken}). Cards will not be saved.
        </div>
      )}
    </>
  );

  const cardPane = (
    <>
      {state.status === 'resolving' && <ResolvingCard word={state.word} />}
      {state.status === 'generating' && <GeneratingCard pending={state.pending} />}

      {state.status === 'success' && (
        <>
          <DidYouMean suggestions={state.didYouMean} onPick={openWord} />
          {pendingDelete === state.card.lemma && (
            <div className="mb-5">
              <ConfirmDelete
                word={state.card.display}
                onCancel={() => setPendingDelete(null)}
                onConfirm={() => void confirmDelete(state.card.lemma)}
              />
            </div>
          )}
          <Card
            key={state.card.lemma}
            card={state.card}
            encounters={encounters}
            onDelete={() => setPendingDelete(state.card.lemma)}
            onWordSelect={openWord}
          />
        </>
      )}

      {state.status === 'misspelling' && (
        <Misspelling
          word={state.word}
          correction={state.correction}
          alternatives={state.alternatives}
          onPick={openWord}
        />
      )}

      {state.status === 'not_found' && (
        <NotFound word={state.word} suggestions={state.suggestions} onPick={openWord} />
      )}

      {state.status === 'error' && (
        <ErrorState
          word={state.word}
          reason={state.reason}
          onRetry={() => setRetryToken((n) => n + 1)}
        />
      )}
    </>
  );

  const quizPane = (
    <Quiz
      cards={cards ?? []}
      onCorrect={(lemma) => void recordView(lemma)}
      onOpenWord={openWord}
    />
  );

  const listFooter = (
    <div className="px-[18px]">
      <InstallHint />
      <BackupControls sync={syncState} onSyncNow={() => void syncNow()} />
    </div>
  );

  if (isDesktop) {
    // grid-rows is as load-bearing as grid-cols here. Left implicit, the single
    // row is auto-sized and grows to the tallest content, so both panes inherit a
    // height larger than the viewport, conclude their content fits, and never
    // scroll — while overflow-hidden clips the excess out of sight.
    return (
      <div className="grid h-[100dvh] grid-cols-[344px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden bg-bg">
        <div className="flex min-w-0 flex-col border-r border-rule bg-surface">
          <WordList
            cards={cards ?? []}
            onOpen={openWord}
            onLookup={openWord}
            selected={route.name === 'word' ? route.lemma : null}
            footer={listFooter}
            onStartTest={() => navigate({ name: 'quiz' })}
          />
        </div>
        <div className="lxsc min-h-0 overflow-y-auto bg-bg">
          <div className="mx-auto max-w-[660px] px-10 pb-20 pt-11">
            {banners}
            {route.name === 'quiz' ? (
              quizPane
            ) : route.name === 'word' ? (
              cardPane
            ) : (
              <div className="pt-24 text-center">
                <p className="font-serif text-[22px] leading-[1.35] text-ink-2">
                  Pick a word, or look one up.
                </p>
                <p className="mt-2 font-mono text-[11px] text-ink-3">press / to search</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-bg">
      {route.name === 'quiz' ? (
        <>
          <div
            className="flex flex-none items-center justify-between border-b border-rule-2 bg-surface px-3 pb-2"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.25rem)' }}
          >
            <button
              onClick={back}
              className="flex items-center gap-1.5 px-2.5 py-2.5 text-[15px] text-ink-2"
            >
              <span aria-hidden="true">‹</span>
              <span className="text-[13px]">{backLabel ?? 'All words'}</span>
            </button>
          </div>
          <div className="lxsc min-h-0 flex-1 overflow-y-auto bg-surface px-[22px] pb-11 pt-5">
            {quizPane}
          </div>
        </>
      ) : route.name === 'word' ? (
        <>
          <div
            className="flex flex-none items-center justify-between border-b border-rule-2 bg-surface px-3 pb-2"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.25rem)' }}
          >
            <button
              onClick={back}
              className="flex items-center gap-1.5 px-2.5 py-2.5 text-[15px] text-ink-2"
            >
              <span aria-hidden="true">‹</span>
              <span className="text-[13px]">{backLabel ?? 'All words'}</span>
            </button>
          </div>
          <div className="lxsc min-h-0 flex-1 overflow-y-auto bg-surface px-[22px] pb-11 pt-5">
            {banners}
            {cardPane}
          </div>
        </>
      ) : (
        <div
          className="flex min-h-0 flex-1 flex-col"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          {(offline || storageBroken) && <div className="px-[18px] pt-3">{banners}</div>}
          <WordList
            cards={cards ?? []}
            onOpen={openWord}
            onLookup={openWord}
            footer={listFooter}
            onStartTest={() => navigate({ name: 'quiz' })}
          />
        </div>
      )}
    </div>
  );
}
