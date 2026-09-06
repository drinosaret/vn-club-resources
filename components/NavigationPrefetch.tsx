'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getPrevNextPages } from '@/lib/navigation';

/**
 * Warms the two pages either side of the current one in the guide sequence.
 *
 * Links on this site do not prefetch on their own, so the one onward step a reader is likely
 * to take is warmed here instead. It goes through the router rather than a document prefetch
 * because a client-side navigation never reads a prefetched document: it fetches the page's
 * payload, which is what the router keeps. A document fetch would also carry the target page's
 * own preload headers, and the browser acts on those, so every page would download the next
 * page's above-the-fold images for nothing.
 */
export function NavigationPrefetch() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const slug = pathname.replace(/^\//, '').replace(/\/$/, '') || '';
    const { prev, next } = getPrevNextPages(slug);

    for (const page of [prev, next]) {
      if (!page) continue;
      router.prefetch(page.slug === '' ? '/' : `/${page.slug}/`);
    }
  }, [pathname, router]);

  return null;
}
