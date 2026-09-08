'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(min-width: 64rem)';

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/**
 * Whether the page is at the column layout. The server has no viewport and answers as
 * the wide case, which is the layout the markup is served in.
 */
export function useWide(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => true);
}
