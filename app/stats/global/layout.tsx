import type { Metadata } from 'next';
import { generatePageMetadata } from '@/lib/metadata-utils';

export const metadata: Metadata = generatePageMetadata({
  title: 'Global VN Stats',
  description: 'Explore global visual novel statistics and trends. See the most popular VNs, reading trends, and community data from VNDB.',
  path: '/stats/global',
});

export default function GlobalStatsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
