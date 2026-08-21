export interface RawPayload {
  dictionary: {
    phonetic: string | null;
    audio: string | null;
    meanings: Array<{
      partOfSpeech: string;
      definitions: Array<{ definition: string; example?: string }>;
    }>;
  } | null;
  /** Authoritative etymology from Merriam-Webster, when available. */
  etymology: string | null;
  /** Authoritative related forms from Merriam-Webster's "uros" block. */
  family: string[];
  /** Real usage examples from the dictionary entry. */
  usageExamples: string[];
  /** Plain-English senses, when a Learner's Dictionary key is configured. */
  plainDefinitions: string[];
  /** Register labels stated by the dictionary, e.g. "formal". */
  labels: string[];
  synonymCandidates: string[];
  antonymCandidates: string[];
}
