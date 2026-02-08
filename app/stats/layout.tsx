import type { Metadata } from 'next';
import { generatePageMetadata } from '@/lib/metadata-utils';

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
      <div className="text-center text-xs sm:text-sm text-gray-500 dark:text-gray-400 py-6 px-6 border-t border-gray-200 dark:border-gray-700 mt-6">
        <p className="max-w-md mx-auto">
          Data provided by <a href="https://vndb.org" target="_blank" rel="noopener noreferrer" className="text-primary-600 dark:text-primary-400 hover:underline">VNDB</a>. Statistics are based on daily data dumps and may not reflect real-time changes.
        </p>
      </div>
    </>
  );
}
