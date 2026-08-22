import { useCallback, useEffect, useState } from 'react';
import type { StoredCard } from '../schema/card';
import { nextQuestion, MIN_CARDS, type Question } from '../quiz/generate';

interface Score {
  right: number;
  asked: number;
  streak: number;
  best: number;
}

const EMPTY: Score = { right: 0, asked: 0, streak: 0, best: 0 };

export function Quiz({
  cards,
  onCorrect,
  onOpenWord,
  onExit,
}: {
  cards: StoredCard[];
  onCorrect: (lemma: string) => void;
  onOpenWord: (lemma: string) => void;
  onExit: () => void;
}) {
  const [question, setQuestion] = useState<Question | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [score, setScore] = useState<Score>(EMPTY);

  const advance = useCallback(
    (avoid?: string) => {
      setChosen(null);
      setQuestion(nextQuestion(cards, avoid));
    },
    [cards]
  );

  /*
   * Fills in as soon as a deck is available, and never replaces a question that
   * already exists. Both halves matter: on a direct load of /test this runs
   * before Dexie has resolved, so a mount-only effect would see an empty deck and
   * stay stuck on "couldn't build a question"; but regenerating on every change
   * would swap the question out from under the user the moment a correct answer
   * bumps a view count.
   */
  useEffect(() => {
    if (question) return;
    const next = nextQuestion(cards);
    if (next) setQuestion(next);
  }, [cards, question]);

  function answer(index: number) {
    if (chosen !== null || !question) return;
    setChosen(index);
    const right = index === question.answerIndex;
    setScore((s) => {
      const streak = right ? s.streak + 1 : 0;
      return {
        right: s.right + (right ? 1 : 0),
        asked: s.asked + 1,
        streak,
        best: Math.max(s.best, streak),
      };
    });
    // A word you just recalled is fresh, so it drops down the revisit queue.
    // A word you missed stays where it is.
    if (right) onCorrect(question.lemma);
  }

  if (cards.filter((c) => !c.deleted_at).length < MIN_CARDS) {
    return (
      <div className="py-16 text-center">
        <p className="font-serif text-[20px] leading-[1.35] text-ink">Not enough words yet</p>
        <p className="mt-2 text-[13px] leading-[1.5] text-ink-2">
          Save at least {MIN_CARDS} words and the test can build questions from them.
        </p>
      </div>
    );
  }

  if (!question) {
    return (
      <div className="py-16 text-center">
        <p className="font-serif text-[20px] leading-[1.35] text-ink">
          Couldn’t build a question
        </p>
        <p className="mt-2 text-[13px] leading-[1.5] text-ink-2">
          Your saved words don’t have enough synonyms or examples yet.
        </p>
      </div>
    );
  }

  const answered = chosen !== null;

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between gap-4 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
        <span>{question.hint}</span>
        <span className="flex items-baseline gap-4">
          <span>
            {score.right}/{score.asked}
            {score.streak > 1 && <span className="text-accent"> · {score.streak} in a row</span>}
          </span>
          <button onClick={onExit} className="uppercase tracking-[0.14em] text-accent">
            End test
          </button>
        </span>
      </div>

      <p
        className={
          question.promptIsWord
            ? 'mt-5 font-serif text-[2.4rem] leading-[1.05] text-ink'
            : 'mt-5 font-serif text-[1.35rem] leading-[1.45] text-pretty text-ink'
        }
      >
        {question.prompt}
      </p>

      <div className="mt-7 flex flex-col gap-2">
        {question.options.map((option, i) => {
          const isAnswer = i === question.answerIndex;
          const isChosen = i === chosen;

          // Colour alone did not distinguish "you were right" from "here is what
          // you missed" — both highlighted the same option identically. The mark
          // carries the verdict; colour only reinforces it.
          let tone = 'border-rule bg-surface text-ink';
          let mark = '';
          if (answered && isAnswer) {
            tone = 'border-ok bg-oksoft text-ok';
            mark = '✓';
          } else if (answered && isChosen) {
            tone = 'border-warn bg-warnsoft text-warn';
            mark = '✗';
          } else if (answered) {
            tone = 'border-rule bg-surface text-ink-3';
          }

          const serif =
            question.kind !== 'word-to-meaning' ? 'font-serif text-[1.05rem]' : 'text-[0.9rem]';

          return (
            <button
              key={option + i}
              onClick={() => answer(i)}
              disabled={answered}
              className={`flex items-start gap-3 rounded-lg border px-4 py-3.5 text-left leading-snug transition-colors ${tone}`}
            >
              <span
                aria-hidden="true"
                className="w-3 flex-none pt-0.5 font-mono text-[13px] leading-snug"
              >
                {mark}
              </span>
              <span className={`min-w-0 flex-1 ${serif}`}>{option}</span>
            </button>
          );
        })}
      </div>

      {answered && (
        <p
          className={`mt-5 font-serif text-[1.15rem] leading-snug ${
            chosen === question.answerIndex ? 'text-ok' : 'text-warn'
          }`}
          role="status"
        >
          {chosen === question.answerIndex
            ? 'Correct.'
            : `Not quite — it was ${question.options[question.answerIndex]}`}
        </p>
      )}

      {answered && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={() => advance(question.lemma)}
            className="min-h-[44px] rounded-lg bg-accent px-5 text-[14px] text-on-accent"
          >
            Next
          </button>
          <button
            onClick={() => onOpenWord(question.lemma)}
            className="min-h-[44px] px-2 font-mono text-[11px] tracking-[0.06em] text-ink-3"
          >
            see the card for {question.lemma}
          </button>
        </div>
      )}
    </div>
  );
}
