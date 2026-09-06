/**
 * How a title's measured Japanese is described in words.
 *
 * The same title is labelled in two places, a server-rendered summary and the client-side
 * charts, so the thresholds and the wording live here rather than beside either renderer.
 * Absent measurements mean "not measured", never "easy": callers render the gap.
 */

/** The measurements a summary needs, a structural subset of the upstream deck object. */
export interface LanguageDeckStats {
  characterCount: number;
  uniqueWordCount: number;
  difficultyRaw: number;
  averageSentenceLength: number;
  dialoguePercentage: number;
  hideDialoguePercentage?: boolean;
}

export interface ReadingStyle {
  label: string;
  description: string;
  criteria: string;
  color: string;
  bgClass: string;
}

/** Dialogue share above this reads as driven by conversation rather than narration. */
const CONVERSATIONAL_DIALOGUE_PCT = 50;
const DENSE_DIFFICULTY = 3;
const DENSE_SENTENCE_WORDS = 20;

export function classifyReadingStyle(deck: LanguageDeckStats): ReadingStyle {
  const hasDialogue = !deck.hideDialoguePercentage && deck.dialoguePercentage > 0;
  const isConversational = hasDialogue && deck.dialoguePercentage > CONVERSATIONAL_DIALOGUE_PCT;
  const isDense = deck.difficultyRaw > DENSE_DIFFICULTY || deck.averageSentenceLength > DENSE_SENTENCE_WORDS;

  // Dialogue share is withheld for some titles, so those classify on difficulty and sentence
  // length alone rather than being treated as narration-driven.
  if (!hasDialogue) {
    if (!isDense) return {
      label: 'Approachable',
      description: 'Short sentences with accessible vocabulary',
      criteria: 'Difficulty ≤ 3.0 · Sentence length ≤ 20',
      color: '#3b82f6',
      bgClass: 'from-blue-50 to-sky-50 dark:from-blue-950/30 dark:to-sky-950/20 border-blue-200/50 dark:border-blue-800/40',
    };
    return {
      label: 'Demanding',
      description: 'Long sentences with complex vocabulary',
      criteria: 'Difficulty > 3.0 or Sentence length > 20',
      color: '#a855f7',
      bgClass: 'from-purple-50 to-violet-50 dark:from-purple-950/30 dark:to-violet-950/20 border-purple-200/50 dark:border-purple-800/40',
    };
  }

  if (isConversational && !isDense) return {
    label: 'Conversational',
    description: 'Dialogue-driven with everyday language',
    criteria: 'Dialogue > 50% · Difficulty ≤ 3.0 · Sentence length ≤ 20',
    color: '#22c55e',
    bgClass: 'from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/20 border-green-200/50 dark:border-green-800/40',
  };
  if (isConversational && isDense) return {
    label: 'Elaborate',
    description: 'Dialogue-driven with complex vocabulary and long sentences',
    criteria: 'Dialogue > 50% · Difficulty > 3.0 or Sentence length > 20',
    color: '#f59e0b',
    bgClass: 'from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/20 border-amber-200/50 dark:border-amber-800/40',
  };
  if (!isConversational && !isDense) return {
    label: 'Flowing',
    description: 'Narration-driven with approachable language',
    criteria: 'Dialogue ≤ 50% · Difficulty ≤ 3.0 · Sentence length ≤ 20',
    color: '#3b82f6',
    bgClass: 'from-blue-50 to-sky-50 dark:from-blue-950/30 dark:to-sky-950/20 border-blue-200/50 dark:border-blue-800/40',
  };
  return {
    label: 'Literary',
    description: 'Narration-driven with complex vocabulary or lengthy prose',
    criteria: 'Dialogue ≤ 50% · Difficulty > 3.0 or Sentence length > 20',
    color: '#a855f7',
    bgClass: 'from-purple-50 to-violet-50 dark:from-purple-950/30 dark:to-violet-950/20 border-purple-200/50 dark:border-purple-800/40',
  };
}

export function formatCount(n: number): string {
  // The thousands branch rounds, so a value just short of a million reads as a million once
  // rounded. The guard sits where that carry begins rather than at the round number.
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

/**
 * One sentence naming what the measurements say, for the surfaces that carry prose rather
 * than a chart. Dialogue share is omitted where the upstream withholds it, so the sentence
 * never asserts a figure that is not published.
 */
export function readingStyleSentence(deck: LanguageDeckStats): string {
  const parts = [
    `${formatCount(deck.characterCount)} characters`,
    `${formatCount(deck.uniqueWordCount)} unique words`,
    `${deck.averageSentenceLength.toFixed(1)} words per sentence`,
  ];
  if (!deck.hideDialoguePercentage && deck.dialoguePercentage > 0) {
    parts.push(`${Math.round(deck.dialoguePercentage)}% dialogue`);
  }
  const style = classifyReadingStyle(deck);
  return `${style.description}, measured at ${deck.difficultyRaw.toFixed(1)} out of 5 for reading difficulty across ${parts.join(', ')}.`;
}
