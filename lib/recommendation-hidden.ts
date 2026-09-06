/**
 * Titles a reader has taken off their own page, kept in the browser and nowhere else.
 *
 * Two reasons are recorded because they mean different things to the reader looking at
 * the count, and nothing else about them is stored: no time, no title, no rating. The key
 * is per reader, so two people sharing a browser do not hide each other's picks.
 */

export type HiddenReason = 'skip' | 'read';

export type HiddenTitles = Record<string, HiddenReason>;

const PREFIX = 'recommendations-hidden:';

export function hiddenKey(uid: string): string {
  return `${PREFIX}${uid}`;
}

export function readHidden(uid: string): HiddenTitles {
  try {
    const raw = window.localStorage.getItem(hiddenKey(uid));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: HiddenTitles = {};
    for (const [id, reason] of Object.entries(parsed)) {
      if (reason === 'skip' || reason === 'read') out[id] = reason;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeHidden(uid: string, hidden: HiddenTitles): void {
  try {
    if (Object.keys(hidden).length === 0) window.localStorage.removeItem(hiddenKey(uid));
    else window.localStorage.setItem(hiddenKey(uid), JSON.stringify(hidden));
  } catch {
    // A browser that will not store the choice still honours it for this visit.
  }
}
