import type { Metadata } from 'next';
import { VNDBAttribution } from '@/components/VNDBAttribution';

export const metadata: Metadata = {
  title: 'VN Recommendations',
  description: 'Get personalized visual novel recommendations based on your VNDB list and preferences.',
};

export default function RecommendationsLayout({
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
