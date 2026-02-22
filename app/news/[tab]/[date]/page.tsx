import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  isValidTab,
  TAB_LABELS,
  TAB_SLUGS,
  fetchNewsForDate,
} from '@/lib/sample-news-data';
import {
  generatePageMetadata,
  SITE_URL,
  safeJsonLdStringify,
  generateBreadcrumbJsonLd,
} from '@/lib/metadata-utils';
import { NewsDatePageClient } from '@/components/news/NewsDatePageClient';

// Historical dates are stable; today revalidates more often
export const revalidate = 3600;

interface PageProps {
  params: Promise<{ tab: string; date: string }>;
}

function isValidDate(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(Date.parse(dateStr));
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tab, date } = await params;

  if (!isValidTab(tab) || !isValidDate(date)) {
    return { title: 'Not Found' };
  }

  const label = TAB_LABELS[tab] || 'News';
  const formattedDate = formatDate(date);

  return generatePageMetadata({
    title: `${label} - ${formattedDate} | Visual Novel News`,
    description: `${label} for ${formattedDate}. Stay updated with Japanese visual novel news and find your next reading target for immersion-based Japanese learning.`,
    path: `/news/${tab}/${date}/`,
    type: 'article',
  });
}

export default async function NewsTabDatePage({ params }: PageProps) {
  const { tab, date } = await params;

  if (!isValidTab(tab) || !isValidDate(date)) {
    notFound();
  }

  const source = TAB_SLUGS[tab];
  const data = await fetchNewsForDate({
    date,
    source: source || undefined,
  });

  const label = TAB_LABELS[tab] || 'News';
  const formattedDate = formatDate(date);

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: `${label} - ${formattedDate}`,
      description: `${label} for ${formattedDate}. Japanese visual novel news on VN Club.`,
      url: `${SITE_URL}/news/${tab}/${date}/`,
      datePublished: date,
      isPartOf: {
        '@type': 'WebSite',
        name: 'VN Club',
        url: SITE_URL,
      },
      numberOfItems: data?.total || 0,
    },
    generateBreadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Visual Novel News', path: '/news/all/' },
      ...(tab !== 'all' ? [{ name: label, path: `/news/${tab}/` }] : []),
      { name: formattedDate, path: `/news/${tab}/${date}/` },
    ]),
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <NewsDatePageClient tab={tab} date={date} initialData={data} />
    </>
  );
}
