import { Metadata } from 'next';
import UserStatsContent from './UserStatsContent';
import { generatePageMetadata } from '@/lib/metadata-utils';

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
  return (
    <UserStatsContent uid={uid} initialUsername={username} initialTab={tab} />
  );
}
