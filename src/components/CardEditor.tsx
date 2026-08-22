import { useState } from 'react';
import type { StoredCard } from '../schema/card';

export interface CardEdits {
  simple: string;
  mnemonic: string;
  examples: string[];
  synonyms: Array<{ word: string; note: string }>;
  encounter: string;
}

function Field({
  label,
  children,
  aside,
}: {
  label: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="border-t border-rule pt-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-ink-3">
          {label}
        </div>
        {aside}
      </div>
      {children}
    </div>
  );
}

const textareaClass =
  'w-full resize-y rounded-lg border border-rule bg-bg px-3 py-2.5 text-[0.95rem] leading-snug text-ink outline-none focus:border-accent';

/**
 * A focused editor rather than a form over all fourteen fields. These are the
 * ones you actually correct when the model is wrong: the plain definition, the
 * discriminating notes, the examples and the hook. The dictionary sense is shown
 * but not editable — it is the one field the model was told to preserve rather
 * than invent.
 */
export function CardEditor({
  card,
  onCancel,
  onSave,
  onDelete,
}: {
  card: StoredCard;
  onCancel: () => void;
  onSave: (edits: CardEdits) => void;
  onDelete: () => void;
}) {
  const [simple, setSimple] = useState(card.simple);
  const [mnemonic, setMnemonic] = useState(card.mnemonic);
  const [examples, setExamples] = useState(card.examples);
  const [synonyms, setSynonyms] = useState(card.synonyms);
  const [encounter, setEncounter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const wordCount = simple.trim() ? simple.trim().split(/\s+/).length : 0;

  function save() {
    // The stored schema requires these, so an empty one would fail validation
    // after the fact — catch it here where it can be explained.
    if (!simple.trim()) return setError('The plain definition can’t be empty.');
    if (!mnemonic.trim()) return setError('The hook can’t be empty.');
    if (examples.some((e) => !e.trim())) return setError('Examples can’t be empty.');
    if (synonyms.some((s) => !s.note.trim())) return setError('Every synonym needs a note.');

    setError(null);
    onSave({
      simple: simple.trim(),
      mnemonic: mnemonic.trim(),
      examples: examples.map((e) => e.trim()),
      synonyms: synonyms.map((s) => ({ word: s.word, note: s.note.trim() })),
      encounter: encounter.trim(),
    });
  }

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-[22px] flex items-center justify-between border-b border-rule bg-surface px-[22px] pb-3 pt-1">
        <button onClick={onCancel} className="py-2 text-[14px] text-ink-2">
          Cancel
        </button>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-3">
          Editing
        </span>
        <button onClick={save} className="py-2 text-[14px] font-medium text-accent">
          Save
        </button>
      </div>

      <h1 className="mt-5 font-serif text-[2.2rem] leading-[1.05] text-ink">{card.display}</h1>
      <p className="mt-2 text-[12.5px] leading-[1.5] text-ink-2">
        Saving marks the card edited and keeps your version. It syncs to your other devices.
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-warnsoft px-3.5 py-2.5 text-[13px] text-warn">{error}</p>
      )}

      <div className="mt-6 flex flex-col gap-6">
        <Field
          label="Plain definition"
          aside={
            <span
              className={`font-mono text-[9.5px] ${
                wordCount > 20 || wordCount < 6 ? 'text-warn' : 'text-ink-3'
              }`}
            >
              {wordCount} words
            </span>
          }
        >
          <textarea
            value={simple}
            onChange={(e) => setSimple(e.target.value)}
            rows={3}
            className={`${textareaClass} font-serif`}
          />
        </Field>

        <Field label="Dictionary sense">
          <p className="text-[13px] leading-[1.6] text-ink-2">{card.formal}</p>
        </Field>

        {synonyms.length > 0 && (
          <Field label="Near neighbours — and how they differ">
            <div className="flex flex-col gap-3">
              {synonyms.map((s, i) => (
                <div key={s.word}>
                  <div className="mb-1 font-serif text-[15px] text-ink">{s.word}</div>
                  <textarea
                    value={s.note}
                    onChange={(e) =>
                      setSynonyms((prev) =>
                        prev.map((p, j) => (j === i ? { ...p, note: e.target.value } : p))
                      )
                    }
                    rows={2}
                    className={textareaClass}
                  />
                </div>
              ))}
            </div>
          </Field>
        )}

        <Field label="In use">
          <div className="flex flex-col gap-3">
            {examples.map((ex, i) => (
              <textarea
                key={i}
                value={ex}
                onChange={(e) =>
                  setExamples((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))
                }
                rows={3}
                className={`${textareaClass} font-serif`}
              />
            ))}
          </div>
        </Field>

        <Field label="Hook">
          <textarea
            value={mnemonic}
            onChange={(e) => setMnemonic(e.target.value)}
            rows={3}
            className={`${textareaClass} font-serif`}
          />
        </Field>

        <Field label="Where you met it">
          <textarea
            value={encounter}
            onChange={(e) => setEncounter(e.target.value)}
            rows={3}
            placeholder="Paste a sentence you found it in"
            className={textareaClass}
          />
        </Field>

        <div className="border-t border-rule pt-4">
          <button onClick={onDelete} className="text-[13px] text-warn">
            Delete this word
          </button>
        </div>
      </div>
    </div>
  );
}
