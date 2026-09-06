/**
 * The stats section's pages, in the order every surface lists them.
 *
 * Three places offer these links: the navigation at the top of each page, the row on the
 * section's landing page, and the cross-links at the foot. Held separately, the copies drift,
 * and the same destination ends up in a different position on each surface.
 *
 * Both spellings of each label live here rather than at the call sites, because the surfaces
 * genuinely want different lengths: a tab in a wrapping row has space for a word, a card has
 * space for a sentence. What none of them get to choose is the order.
 */

export interface StatsPage {
  key: 'mine' | 'global' | 'trends' | 'rankings' | 'compare' | 'recommendations';
  href: string;
  /** One word, for a pill or a chip. */
  label: string;
  /** The page's own name, for a card or a heading. */
  title: string;
  blurb: string;
  /**
   * Set for a destination that sits outside the stats section.
   *
   * It belongs in the navigation, because it answers the question somebody has after reading
   * their own numbers. It does not belong under a heading that says "elsewhere in stats",
   * which would be a claim about where the page lives rather than about what it offers.
   */
  outsideSection?: boolean;
}

export const STATS_PAGES: StatsPage[] = [
  {
    key: 'mine',
    href: '/stats/',
    label: 'Yours',
    title: 'Your stats',
    blurb: 'Your reading, and where it places against everyone else.',
  },
  {
    key: 'global',
    href: '/stats/global/',
    label: 'Global',
    title: 'Global stats',
    blurb: 'The shape of the database: ratings, lengths, releases and how it grew.',
  },
  {
    key: 'trends',
    href: '/stats/trends/',
    label: 'Trends',
    title: 'Trends',
    blurb: "What's popular now, and what was popular every year before.",
  },
  {
    key: 'rankings',
    href: '/stats/rankings/',
    label: 'Rankings',
    title: 'Rankings',
    blurb: 'Leaderboards drawn from the whole vote record, each showing how it was counted.',
  },
  {
    key: 'compare',
    href: '/stats/compare/',
    label: 'Compare',
    title: 'Compare',
    blurb: 'Two readers side by side: overlap, disagreement and blind spots.',
  },
  {
    key: 'recommendations',
    href: '/recommendations/',
    label: 'Recs',
    title: 'Recommendations',
    blurb: 'What to read next, worked out from what you have rated.',
    outsideSection: true,
  },
];
