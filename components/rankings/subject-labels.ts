/**
 * Nouns for what a board ranks.
 *
 * Used instead of the bare word "ranked", which reads as a promise that the whole list can
 * be browsed. Only the top slice is stored, so the total is a measure of how competitive a
 * board is rather than of how much there is to scroll through, and naming the subject
 * alongside the count carries that without implying otherwise.
 */
const SUBJECT_NOUNS: Record<string, { one: string; many: string }> = {
  user: { one: 'reader', many: 'readers' },
  vn: { one: 'title', many: 'titles' },
  series: { one: 'series', many: 'series' },
  developer: { one: 'studio', many: 'studios' },
  publisher: { one: 'publisher', many: 'publishers' },
  staff: { one: 'creator', many: 'creators' },
  seiyuu: { one: 'voice actor', many: 'voice actors' },
  tag: { one: 'tag', many: 'tags' },
};

export function subjectNoun(subject: string, count: number): string {
  const noun = SUBJECT_NOUNS[subject];
  if (!noun) return count === 1 ? 'entry' : 'entries';
  return count === 1 ? noun.one : noun.many;
}

/** A formatted count followed by the subject noun, for describing a board's field. */
export function describeField(subject: string, total: number): string {
  return `${total.toLocaleString()} ${subjectNoun(subject, total)}`;
}
