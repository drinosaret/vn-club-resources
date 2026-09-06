import { Suspense } from 'react';
import type { Metadata } from 'next';
import TierListContent from '../../TierListContent';
import { VNDBAttribution } from '@/components/VNDBAttribution';
import { generatePageMetadata } from '@/lib/metadata-utils';

export const metadata: Metadata = {
  ...generatePageMetadata({
    title: 'Shared Tier List - Visual Novel Tier List Maker',
    description: 'View a shared visual novel tier list. Create your own VN tier list at VN Club.',
    path: '/tierlist/',
  }),
  robots: { index: false, follow: true },
};

function LoadingFallback() {
  return (
    <div className="flex min-h-[80vh] flex-col items-center px-4 py-12">
      <div className="w-full max-w-5xl">
        <div className="mb-8 text-center">
          <div className="image-placeholder mx-auto mb-3 h-10 w-64 rounded-xs" />
          <div className="image-placeholder mx-auto h-6 w-96 rounded-xs" />
        </div>
        <div className="mx-auto max-w-3xl space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="image-placeholder h-20 rounded-xs" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <Suspense fallback={<LoadingFallback />}>
        <TierListContent shareId={id} />
      </Suspense>
      <VNDBAttribution />
    </>
  );
}
