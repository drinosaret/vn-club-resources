import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Grid3X3 } from 'lucide-react';
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
    <div className="min-h-[80vh] flex flex-col items-center px-4 py-12">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/30 mb-3">
            <Grid3X3 className="w-8 h-8 text-purple-600 dark:text-purple-400" />
          </div>
          <div className="h-10 w-48 mx-auto mb-3 rounded image-placeholder" />
          <div className="h-5 w-80 mx-auto rounded image-placeholder" />
        </div>
        <div className="max-w-[420px] mx-auto grid grid-cols-3 gap-1">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] rounded-sm image-placeholder" />
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
