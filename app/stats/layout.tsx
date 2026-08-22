import type { Metadata } from 'next';
import { generatePageMetadata } from '@/lib/metadata-utils';
import { StatsCrossLinks } from '@/components/stats/StatsCrossLinks';
import { StatsSectionNav } from '@/components/stats/StatsSectionNav';
import { VNDBAttribution } from '@/components/VNDBAttribution';

const baseMetadata = generatePageMetadata({
  title: 'VNDB Stats',
  description: 'Visual novel reading statistics and analytics. Track your VN reading habits, view score distributions, explore global trends, and compare your taste with other VNDB users.',
  path: '/stats/',
});

export const metadata: Metadata = {
  ...baseMetadata,
  title: {
    template: '%s | VNDB Stats',
    default: 'VNDB Stats',
  },
};

export default function StatsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Above the page rather than inside it, so every page in the section carries the same
          navigation without each one remembering to render it. */}
      <StatsSectionNav />
      {children}
      <VNDBAttribution />
    </>
  );
}
