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
import { getVNOfTheDay } from '@/lib/vn-of-the-day';

interface PageProps {
  params: Promise<{ tab: string }>;
}

function getToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  const { tab } = await params;

  if (!isValidTab(tab)) {
    return { title: 'Not Found' };
  }

  const label = TAB_LABELS[tab] || 'News';
  const today = getToday();
  const formattedDate = formatDate(today);

  return generatePageMetadata({
    title: `${label} - ${formattedDate} | Visual Novel News`,
    description: `Japanese visual novel news for ${formattedDate}. New releases, announcements, and updates from across the VN community.`,
    path: `/news/${tab}/`,
  });
}

export default async function NewsTabPage({ params }: PageProps) {
  const { tab } = await params;

  if (!isValidTab(tab)) {
    notFound();
  }

  const today = getToday();
  const source = TAB_SLUGS[tab];
  const [data, vnOfTheDay] = await Promise.all([
    fetchNewsForDate({ date: today, source: source || undefined }),
    tab === 'all' ? getVNOfTheDay() : Promise.resolve(null),
  ]);

  const label = TAB_LABELS[tab] || 'News';
  const formattedDate = formatDate(today);

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: `${label} - ${formattedDate}`,
      description: `${label} for ${formattedDate}. Japanese visual novel news on VN Club.`,
      url: `${SITE_URL}/news/${tab}/`,
      isPartOf: {
        '@type': 'WebSite',
        name: 'VN Club',
        url: SITE_URL,
      },
    },
    generateBreadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Visual Novel News', path: '/news/all/' },
      ...(tab !== 'all' ? [{ name: label, path: `/news/${tab}/` }] : []),
    ]),
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <NewsDatePageClient tab={tab} date={today} initialData={data} vnOfTheDay={vnOfTheDay} />
    </>
  );
}
