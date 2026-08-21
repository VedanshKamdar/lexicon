import type { Pending } from '../hooks/useLookup';

function Shimmer({ w, h = 'h-[17px]', delay = '' }: { w: string; h?: string; delay?: string }) {
  return <div className={`lxshimmer rounded-[3px] bg-rule ${h} ${w} ${delay}`} />;
}

/**
 * The wait is filled, not blank: headword, IPA and part of speech come back from
 * the dictionary in a few hundred milliseconds and paint straight away, while
 * the ledger shows which upstreams actually answered and the model finishes.
 */
export function GeneratingCard({ pending }: { pending: Pending }) {
  return (
    <div aria-busy="true" aria-label={`Looking up ${pending.word}`}>
      <div className="font-serif text-[40px] leading-[1.05] text-ink">{pending.word}</div>
      {pending.ipa && <div className="mt-2.5 font-mono text-[13px] text-ink-2">{pending.ipa}</div>}

      <div className="mt-3.5 flex items-center gap-1.5">
        {pending.pos && (
          <span className="rounded border border-rule px-[7px] py-[5px] font-mono text-[9.5px] uppercase tracking-[0.09em] text-ink-2">
            {pending.pos}
          </span>
        )}
        <span className="lxshimmer h-[22px] w-[74px] rounded bg-rule" />
      </div>

      <div className="mt-8 flex flex-col gap-[11px]">
        <Shimmer w="w-[92%]" />
        <Shimmer w="w-[70%]" delay="[animation-delay:0.15s]" />
        <Shimmer w="w-[84%]" h="h-[11px]" delay="mt-3 [animation-delay:0.3s]" />
        <Shimmer w="w-[56%]" h="h-[11px]" delay="[animation-delay:0.45s]" />
      </div>

      <div className="mt-9 flex flex-col gap-2 border-t border-rule pt-4">
        {pending.ledger.map((l) => (
          <div key={l.label} className="flex items-baseline gap-2.5 font-mono text-[11px] leading-[1.5]">
            <span className={`w-3 flex-none ${l.ok ? 'text-ink-2' : 'text-ink-3'}`}>
              {l.ok ? '✓' : '·'}
            </span>
            <span className="text-ink-2">{l.label}</span>
            <span className="ml-auto text-ink-3">{l.detail}</span>
          </div>
        ))}
        <div className="flex items-baseline gap-2.5 font-mono text-[11px] leading-[1.5]">
          <span className="w-3 flex-none text-accent">◍</span>
          <span className="text-ink-2">synthesising card</span>
          <span className="ml-auto text-ink-3">writing notes…</span>
        </div>
      </div>

      <p className="mt-6 text-[11.5px] leading-[1.55] text-pretty text-ink-3">
        The written fields fill in as the model returns them. You can leave and come back.
      </p>
    </div>
  );
}

export function ResolvingCard({ word }: { word: string }) {
  return (
    <div aria-busy="true" aria-label={`Looking up ${word}`}>
      <div className="font-serif text-[40px] leading-[1.05] text-ink">{word}</div>
      <div className="mt-2.5 font-mono text-[13px] text-ink-3">checking sources…</div>
      <div className="mt-8 flex flex-col gap-[11px]">
        <Shimmer w="w-[92%]" />
        <Shimmer w="w-[70%]" delay="[animation-delay:0.15s]" />
      </div>
    </div>
  );
}

export function NotFound({
  word,
  suggestions,
  onPick,
}: {
  word: string;
  suggestions: string[];
  onPick: (w: string) => void;
}) {
  return (
    <div>
      <h1 className="font-serif text-[34px] leading-[1.1] text-ink">{word}</h1>
      <p className="mt-2.5 text-[13px] leading-[1.5] text-ink-2">
        {suggestions.length ? 'No entry found. Did you mean:' : 'No entry found, and no close matches.'}
      </p>
      {suggestions.length > 0 && (
        <div className="mt-3.5 flex flex-wrap gap-[7px]">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => onPick(s)}
              className="rounded-md border border-rule bg-surface px-[11px] py-[9px] font-serif text-[15px] text-ink"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Misspelling({
  word,
  correction,
  alternatives,
  onPick,
}: {
  word: string;
  correction: string;
  alternatives: string[];
  onPick: (w: string) => void;
}) {
  return (
    <div>
      <p className="text-[13px] text-ink-2">
        <span className="font-serif text-[17px] text-ink">{word}</span> is a misspelling.
      </p>
      <p className="mt-3.5 font-serif text-[28px] leading-[1.15] text-ink">
        Did you mean {correction}?
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => onPick(correction)}
          className="min-h-[44px] rounded-lg bg-accent px-[18px] font-serif text-[15px] text-on-accent"
        >
          Yes — look up {correction}
        </button>
        {alternatives.map((a) => (
          <button
            key={a}
            onClick={() => onPick(a)}
            className="min-h-[44px] rounded-lg border border-rule bg-surface px-[14px] font-serif text-[15px] text-ink-2"
          >
            {a}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ErrorState({
  word,
  reason,
  onRetry,
}: {
  word: string;
  reason: string;
  onRetry: () => void;
}) {
  return (
    <div>
      <h1 className="font-serif text-[34px] leading-[1.1] text-ink">{word}</h1>
      <p className="mt-2.5 text-[13px] leading-[1.5] text-ink-2">{reason}</p>
      <button
        onClick={onRetry}
        className="mt-4 min-h-[44px] rounded-lg border border-rule bg-surface px-[16px] text-[14px] text-ink"
      >
        Retry
      </button>
    </div>
  );
}

export function OfflineNotice() {
  return (
    <div className="rounded-lg bg-warnsoft px-[17px] py-3 text-[12.5px] leading-[1.5] text-warn">
      You’re offline — saved words still work.
    </div>
  );
}

export function DidYouMean({
  suggestions,
  onPick,
}: {
  suggestions: string[];
  onPick: (w: string) => void;
}) {
  if (!suggestions.length) return null;
  return (
    <div className="mb-5 rounded-lg bg-soft px-[17px] py-3 text-[12.5px] leading-[1.5] text-accent">
      Did you mean{' '}
      {suggestions.map((s, i) => (
        <span key={s}>
          {i > 0 && (i === suggestions.length - 1 ? ' or ' : ', ')}
          <button onClick={() => onPick(s)} className="font-serif underline underline-offset-2">
            {s}
          </button>
        </span>
      ))}
      ?
    </div>
  );
}

export function ConfirmDelete({
  word,
  onCancel,
  onConfirm,
}: {
  word: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="rounded-lg bg-warnsoft px-[17px] py-4">
      <p className="text-[13px] text-warn">
        Delete <span className="font-serif text-[15px]">{word}</span> from your vocabulary book?
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onConfirm}
          className="min-h-[40px] rounded-md bg-warn px-3.5 text-[13px] text-on-accent"
        >
          Delete
        </button>
        <button
          onClick={onCancel}
          className="min-h-[40px] rounded-md border border-rule bg-surface px-3.5 text-[13px] text-ink"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
