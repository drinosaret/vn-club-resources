import { Suspense } from 'react';
import { generatePageMetadata } from '@/lib/metadata-utils';
import CompareContent from './CompareContent';
import { ArrowLeft, Users } from 'lucide-react';

export const metadata = generatePageMetadata({
  title: 'Compare Lists',
  description: 'Compare your visual novel reading list with another VNDB user. Find readers with similar taste, see shared VNs, and discover score differences across your libraries.',
  path: '/stats/compare/',
});

function LoadingFallback() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="p-2 rounded-lg">
          <ArrowLeft className="w-5 h-5 text-gray-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            Compare Lists
            <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded-sm bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700">
              BETA
            </span>
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            See how your VN taste matches with another user
          </p>
        </div>
      </div>

      {/* Mode Tabs */}
      <div className="flex gap-2 mb-6">
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white font-medium">
          <Users className="w-4 h-4" />
          Compare Two Users
        </div>
        <div className="w-40 h-10 rounded-lg image-placeholder" />
      </div>

      {/* Form skeleton */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="w-24 h-5 rounded-sm mb-2 image-placeholder" />
            <div className="w-full h-10 rounded-lg image-placeholder" />
          </div>
          <div>
            <div className="w-24 h-5 rounded-sm mb-2 image-placeholder" />
            <div className="w-full h-10 rounded-lg image-placeholder" />
          </div>
        </div>
        <div className="mt-4 flex justify-center">
          <div className="w-32 h-10 rounded-lg image-placeholder" />
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <CompareContent />
    </Suspense>
  );
}
