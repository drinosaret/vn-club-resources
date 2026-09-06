/**
 * How the results are drawn.
 *
 * Independent of which list is open: the list decides what the order means, the layout decides
 * only how much of each title is on screen at once. The fullest view leads: a reader arriving
 * at a recommendation has not heard of most of what is on it, and a name with a score beside
 * it gives them nothing to decide on. The compact views follow, for reading down a ranking
 * once the titles are familiar.
 */

export type ResultLayout = 'list' | 'grid' | 'cards' | 'detail';

export interface ResultLayoutOption {
  value: ResultLayout;
  /** Names the control for a pointer and for assistive technology alike. */
  label: string;
  /** What this layout trades for what, said once under the group. */
  hint: string;
}

export const DEFAULT_LAYOUT: ResultLayout = 'detail';

/** Where the choice is remembered between visits. */
export const LAYOUT_STORAGE_KEY = 'recommendations-layout';

/** The query parameter carrying the choice, so a link reproduces the view it was copied from. */
export const LAYOUT_PARAM = 'layout';

export const RESULT_LAYOUTS: ResultLayoutOption[] = [
  {
    value: 'detail',
    label: 'Detail',
    hint: 'Cover beside the description, for deciding rather than scanning.',
  },
  {
    value: 'list',
    label: 'List',
    hint: 'One line each, so a screenful is a dozen titles rather than four.',
  },
  {
    value: 'grid',
    label: 'Small covers',
    hint: 'Covers at their densest. The reasons move behind the info button.',
  },
  {
    value: 'cards',
    label: 'Cards',
    hint: 'A large cover with the reasons underneath it.',
  },
];

export function parseLayoutParam(raw: string | null): ResultLayout {
  const match = RESULT_LAYOUTS.find((option) => option.value === raw);
  return match ? match.value : DEFAULT_LAYOUT;
}

/**
 * The remembered choice, or null where there is none.
 *
 * Storage can refuse in a private window or where site data is blocked, and a refusal is not a
 * preference, so it reads as absent rather than as the default.
 */
export function readStoredLayout(): ResultLayout | null {
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    return RESULT_LAYOUTS.some((option) => option.value === raw) ? (raw as ResultLayout) : null;
  } catch {
    return null;
  }
}

export function writeStoredLayout(layout: ResultLayout): void {
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, layout);
  } catch {
    // A browser that will not store the choice still honours it for this visit.
  }
}
