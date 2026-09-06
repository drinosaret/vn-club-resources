import { Suspense } from 'react';
import type { Metadata } from 'next';
import GridMakerContent from '../../GridMakerContent';
import { VNDBAttribution } from '@/components/VNDBAttribution';
import { generatePageMetadata } from '@/lib/metadata-utils';

export const metadata: Metadata = {
  ...generatePageMetadata({
    title: 'Shared VN Grid - Visual Novel 3x3 Maker',
    description: 'View a shared visual novel grid collage. Create your own 3x3, 4x4, or 5x5 grid at VN Club.',
    path: '/3x3-maker/',
  }),
  robots: { index: false, follow: true },
};

function LoadingFallback() {
  return (
    <div className="flex min-h-[80vh] flex-col items-center px-4 py-12">
      <div className="w-full max-w-4xl">
        <div className="mb-8 text-center">
          <div className="image-placeholder mx-auto mb-3 h-10 w-48 rounded-xs" />
          <div className="image-placeholder mx-auto h-5 w-80 rounded-xs" />
        </div>
        <div className="mx-auto grid max-w-[420px] grid-cols-3 gap-1">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="image-placeholder aspect-[2/3] rounded-xs" />
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
        <GridMakerContent shareId={id} />
      </Suspense>
      <VNDBAttribution />
    </>
  );
}
