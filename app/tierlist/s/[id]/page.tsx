import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LayoutGrid } from 'lucide-react';
import TierListContent from '../../TierListContent';
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
    <div className="min-h-[80vh] flex flex-col items-center px-4 py-12">
      <div className="max-w-5xl w-full">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-blue-100 dark:bg-blue-900/30 mb-4">
            <LayoutGrid className="w-10 h-10 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="h-10 w-64 mx-auto mb-3 rounded image-placeholder" />
          <div className="h-6 w-96 mx-auto rounded image-placeholder" />
        </div>
        <div className="space-y-2 max-w-3xl mx-auto">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 rounded-lg image-placeholder" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<LoadingFallback />}>
      <TierListContent shareId={id} />
    </Suspense>
  );
}
