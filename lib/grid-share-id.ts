const SHARE_ID_KEY = 'vn-grid-maker-share-id';

export function getLoadedShareId(): string | null {
  try { return localStorage.getItem(SHARE_ID_KEY); } catch { return null; }
}
