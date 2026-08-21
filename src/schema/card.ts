import { z } from 'zod';

export const CONNOTATIONS = ['positive', 'negative', 'neutral', 'ironic'] as const;
export const REGISTERS = ['formal', 'literary', 'neutral', 'informal', 'technical', 'archaic'] as const;

/**
 * The LLM output contract. Only fields the model actually produces live here —
 * timestamps and bookkeeping are added by the client on write. Keeping them out
 * means this converts cleanly to a strict JSON Schema for Groq's constrained
 * decoding, where every property must be required.
 */
export const GeneratedCardSchema = z.object({
  display: z.string().min(1),
  ipa: z.string().nullable(),
  pos: z.string().min(1),
  simple: z.string().min(1),
  formal: z.string().min(1),
  connotation: z.enum(CONNOTATIONS),
  register: z.enum(REGISTERS),
  roots: z.array(
    z.object({
      part: z.string().min(1),
      meaning: z.string().min(1),
      origin: z.string().min(1),
    })
  ),
  family: z.array(z.string()),
  synonyms: z
    .array(
      z.object({
        word: z.string().min(1),
        note: z.string().min(1),
      })
    )
    .min(3)
    .max(5),
  antonyms: z.array(z.string()),
  examples: z.array(z.string()).length(2),
  mnemonic: z.string().min(1),
  confusables: z.array(z.string()).max(3),
});

export type GeneratedCard = z.infer<typeof GeneratedCardSchema>;

/** What actually lands in IndexedDB. */
export const StoredCardSchema = GeneratedCardSchema.extend({
  lemma: z.string().min(1),
  audio_url: z.string().nullable(),
  /** True when no dictionary entry backed the generation — model knowledge only. */
  low_confidence: z.boolean(),
  created_at: z.number(),
  updated_at: z.number(),
  user_edited: z.boolean(),
  /** Feeds the "cards revisited" metric and, later, FSRS seeding. */
  view_count: z.number(),
  last_viewed_at: z.number().nullable(),
  /**
   * Soft delete. A hard delete cannot sync: the device that still holds the card
   * would simply push it back on the next merge. Null means live.
   */
  deleted_at: z.number().nullable(),
  /** Derived from roots[].part on write — backs the multi-entry Dexie index. */
  rootParts: z.array(z.string()),
});

export type StoredCard = z.infer<typeof StoredCardSchema>;

export interface Encounter {
  id?: number;
  lemma: string;
  sentence: string;
  source: string | null;
  captured_at: number;
}
