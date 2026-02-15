import { Metadata } from 'next';
import UserStatsContent from './UserStatsContent';
import { generatePageMetadata, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

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
    path: `/stats/${uid}${username ? `?username=${encodeURIComponent(username)}` : ''}`,
  });
}

export default async function Page({ params, searchParams }: PageProps) {
  const { uid } = await params;
  const { username, tab } = await searchParams;
  const displayName = username || `User ${uid}`;

  const breadcrumbJsonLd = generateBreadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Stats', path: '/stats/' },
    { name: `${displayName}'s Stats`, path: `/stats/${uid}/` },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(breadcrumbJsonLd) }}
      />
      <UserStatsContent uid={uid} initialUsername={username} initialTab={tab} />
    </>
  );
}
