import { useState } from 'react';
import type { StoredCard, Encounter } from '../schema/card';

/** "obduracy (n.)" -> "obduracy" */
const bareWord = (entry: string) => entry.replace(/\s*\(.*\)\s*$/, '').trim();

/**
 * Mono, uppercase, wide-tracked — the design's label voice throughout.
 * Colour is passed as a whole class, never interpolated: Tailwind scans source
 * statically and would not emit a class built from a template string.
 */
function Label({
  children,
  className = 'text-ink-3',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] ${className}`}
    >
      {children}
    </div>
  );
}

function Chip({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className={`rounded border px-[7px] py-[5px] font-mono text-[9.5px] uppercase tracking-[0.09em] ${
        accent ? 'border-accent text-accent' : 'border-rule text-ink-2'
      }`}
    >
      {children}
    </span>
  );
}

/** Every word on a card is itself worth learning, so every word is a lookup. */
function WordLink({
  word,
  onSelect,
  className = '',
}: {
  word: string;
  onSelect?: (w: string) => void;
  className?: string;
}) {
  if (!onSelect) return <span className={className}>{word}</span>;
  return (
    <button
      onClick={() => onSelect(bareWord(word))}
      className={`text-left underline-offset-4 hover:underline ${className}`}
    >
      {word}
    </button>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 border-t border-rule pt-4">
      <div className="mb-4">
        <Label>{label}</Label>
      </div>
      {children}
    </section>
  );
}

export function Card({
  card,
  encounters = [],
  onDelete,
  onWordSelect,
}: {
  card: StoredCard;
  encounters?: Encounter[];
  onDelete?: () => void;
  onWordSelect?: (word: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <article>
      <header className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <h1 className="font-serif text-[2.6rem] leading-[1.03] tracking-[-0.01em] text-ink sm:text-[3.25rem]">
            {card.display}
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            {card.ipa && <span className="font-mono text-[13.5px] text-ink-2">{card.ipa}</span>}
            {card.audio_url && (
              <button
                onClick={() => void new Audio(card.audio_url!).play().catch(() => {})}
                className="flex min-h-[34px] items-center gap-1.5 rounded-md border border-rule bg-bg px-[11px] font-mono text-[10.5px] text-ink-2"
              >
                <span aria-hidden="true">▸</span> play
              </button>
            )}
            {card.user_edited && (
              <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-3">
                edited
              </span>
            )}
          </div>
        </div>

        <div className="relative flex-none">
          <button
            aria-label="Card actions"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded-md px-3 py-2.5 text-[15px] text-ink-3"
          >
            ⋯
          </button>
          {menuOpen && onDelete && (
            <div className="absolute right-0 top-10 z-10 rounded-md border border-rule bg-surface py-1">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
                className="w-full whitespace-nowrap px-4 py-2 text-left text-[13px] text-warn"
              >
                Delete word
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <Chip>{card.pos}</Chip>
        <Chip accent>{card.connotation}</Chip>
        <Chip>{card.register}</Chip>
        {card.low_confidence && <Chip>no dictionary entry</Chip>}
      </div>

      <p className="mt-7 font-serif text-[22px] leading-[1.42] text-pretty text-ink sm:text-[25px]">
        {card.simple}
      </p>
      <p className="mt-4 text-[13.5px] leading-[1.6] text-pretty text-ink-2">{card.formal}</p>

      <Section label="In use">
        <div className="flex flex-col gap-4">
          {card.examples.map((ex, i) => (
            <p
              key={i}
              className="border-l-2 border-soft pl-4 font-serif text-[16px] leading-[1.55] text-pretty text-ink sm:text-[16.5px]"
            >
              {ex}
            </p>
          ))}
        </div>
      </Section>

      <Section label="Near neighbours — and how they differ">
        <ul>
          {card.synonyms.map((s) => (
            <li
              key={s.word}
              className="grid grid-cols-1 items-baseline gap-x-[18px] gap-y-1 border-b border-rule-2 py-[13px] sm:grid-cols-[150px_1fr]"
            >
              <WordLink
                word={s.word}
                onSelect={onWordSelect}
                className="font-serif text-[16px] leading-[1.3] text-ink"
              />
              <span className="text-[13px] leading-[1.55] text-pretty text-ink-2">{s.note}</span>
            </li>
          ))}
        </ul>

        {card.antonyms.length > 0 && (
          <div className="grid grid-cols-1 items-baseline gap-x-[18px] gap-y-2 py-[13px] sm:grid-cols-[150px_1fr]">
            <Label>Opposite</Label>
            <div className="flex flex-wrap gap-[7px]">
              {card.antonyms.map((a) => (
                <WordLink
                  key={a}
                  word={a}
                  onSelect={onWordSelect}
                  className="rounded bg-soft px-[9px] py-1.5 text-[12.5px] text-ink-2"
                />
              ))}
            </div>
          </div>
        )}
      </Section>

      {card.confusables.length > 0 && (
        <div className="mt-8 rounded-lg bg-warnsoft px-[17px] py-[15px]">
          <div className="mb-2.5">
            <Label className="text-warn">Don’t confuse with</Label>
          </div>
          <div className="flex flex-wrap gap-4">
            {card.confusables.map((c) => (
              <WordLink
                key={c}
                word={c}
                onSelect={onWordSelect}
                className="font-serif text-[16px] leading-[1.2] text-warn"
              />
            ))}
          </div>
        </div>
      )}

      <Section label="Built from">
        {card.roots.length > 0 ? (
          <div className="flex flex-wrap gap-2.5">
            {card.roots.map((r) => (
              <div
                key={r.part}
                className="min-w-[150px] rounded-lg border border-rule bg-surface px-[13px] py-[11px]"
              >
                <div className="font-serif text-[19px] leading-[1.1] text-ink">{r.part}</div>
                <div className="mt-1.5 text-[12px] leading-[1.4] text-ink-2">{r.meaning}</div>
                <div className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.07em] text-ink-3">
                  {r.origin}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px] leading-[1.5] text-ink-3">
            No clear etymology — nothing invented here.
          </p>
        )}

        {card.family.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-[7px]">
            <Label>Family</Label>
            {card.family.map((f) => (
              <WordLink
                key={f}
                word={f}
                onSelect={onWordSelect}
                className="font-serif text-[13px] text-ink-2"
              />
            ))}
          </div>
        )}
      </Section>

      <div className="mt-8 rounded-lg bg-soft px-[18px] py-4">
        <div className="mb-2.5">
          <Label className="text-accent">Hook</Label>
        </div>
        <p className="font-serif text-[15.5px] leading-[1.5] text-pretty text-ink">
          {card.mnemonic}
        </p>
      </div>

      {encounters.length > 0 && (
        <Section label="Where you met it">
          <ul className="flex flex-col gap-2">
            {encounters.map((e) => (
              <li key={e.id} className="text-[13px] leading-[1.5] text-ink-2">
                “{e.sentence}”
                {e.source && <span className="text-ink-3"> — {e.source}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </article>
  );
}
