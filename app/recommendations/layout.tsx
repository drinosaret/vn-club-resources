import { StatsSectionNav } from '@/components/stats/StatsSectionNav';
import { VNDBAttribution } from '@/components/VNDBAttribution';

export default function RecommendationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* The same navigation the stats pages carry. This page is not one of them, but it is
          reached from every one of them and is where somebody lands after reading their own
          numbers, so arriving here should not be a dead end. */}
      <StatsSectionNav />
      {children}
      <VNDBAttribution />
    </>
  );
}
