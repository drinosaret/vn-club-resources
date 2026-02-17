import { Metadata } from 'next';
import UserStatsContent from './UserStatsContent';
import { generatePageMetadata, safeJsonLdStringify, generateBreadcrumbJsonLd, SITE_URL } from '@/lib/metadata-utils';

interface PageProps {
  params: Promise<{ uid: string }>;
  searchParams: Promise<{ username?: string; tab?: string }>;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { uid } = await params;
  const { username } = await searchParams;

  const safeUid = /^u?\d+$/.test(uid) ? uid : 'unknown';
  const displayName = username || `User ${safeUid}`;

  return generatePageMetadata({
    title: `${displayName}'s Stats`,
    description: `Visual novel reading statistics for ${displayName}. View score distributions, favorite tags, developers, and personalized recommendations.`,
    path: `/stats/${uid}/${username ? `?username=${encodeURIComponent(username)}` : ''}`,
  });
}

export default async function Page({ params, searchParams }: PageProps) {
  const { uid } = await params;
  const { username, tab } = await searchParams;
  const displayName = username || `User ${uid}`;

  const pageUrl = `${SITE_URL}/stats/${uid}/`;
  const description = `Visual novel reading statistics for ${displayName}. View score distributions, favorite tags, developers, and personalized recommendations.`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      name: `${displayName}'s Stats`,
      description,
      url: pageUrl,
      mainEntity: {
        '@type': 'Person',
        name: displayName,
      },
      isPartOf: { '@type': 'WebSite', name: 'VN Club', url: SITE_URL },
    },
    generateBreadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Stats', path: '/stats/' },
      { name: `${displayName}'s Stats`, path: `/stats/${uid}/` },
    ]),
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <UserStatsContent uid={uid} initialUsername={username} initialTab={tab} />
    </>
  );
}
