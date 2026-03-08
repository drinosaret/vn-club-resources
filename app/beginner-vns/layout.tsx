import { VNDBAttribution } from '@/components/VNDBAttribution';

export default function BeginnerVNsLayout({
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
