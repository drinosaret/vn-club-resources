import type { Metadata } from 'next';
import { generatePageMetadata } from '@/lib/metadata-utils';
import { VNDBAttribution } from '@/components/VNDBAttribution';

const baseMetadata = generatePageMetadata({
  title: 'VNDB Stats',
  description: 'Analyze your visual novel reading habits. Get personalized statistics, recommendations, and compare your taste with other readers.',
  path: '/stats',
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
      {children}
      <VNDBAttribution />
    </>
  );
}
