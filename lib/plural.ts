/**
 * Counted nouns, so a reader with one of something is not told they have "1 titles".
 *
 * Kept in one place because the same figures are printed by several cards on the same
 * screen: when each wrote its own the summary card said "1 votes" beside a card that said
 * "1 title rated", which reads as two different numbers rather than one.
 */

/** The right form of a word for a count, without the count itself. */
export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * A count and its noun, grouped for reading.
 *
 * Thousands separators throughout: these sit next to figures that already carry them, and
 * a bare four-digit number beside a grouped one looks like a different kind of quantity.
 */
export function counted(count: number, one: string, many: string): string {
  return `${count.toLocaleString()} ${plural(count, one, many)}`;
}
