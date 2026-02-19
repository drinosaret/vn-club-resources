import { VNDBAttribution } from '@/components/VNDBAttribution';

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
