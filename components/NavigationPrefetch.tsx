'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { getPrevNextPages } from '@/lib/navigation';

export function NavigationPrefetch() {
  const pathname = usePathname();

  useEffect(() => {
    const slug = pathname.replace(/^\//, '').replace(/\/$/, '') || '';
    const { prev, next } = getPrevNextPages(slug);
    const addedLinks: HTMLLinkElement[] = [];

    [prev, next].filter(Boolean).forEach((page) => {
      const url = page!.slug === '' ? '/' : `/${page!.slug}/`;

      // Avoid duplicate prefetch links
      if (document.querySelector(`link[rel="prefetch"][href="${url}"]`)) {
        return;
      }

      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = url;
      document.head.appendChild(link);
      addedLinks.push(link);
    });

    return () => {
      addedLinks.forEach((link) => link.remove());
    };
  }, [pathname]);

  return null;
}
