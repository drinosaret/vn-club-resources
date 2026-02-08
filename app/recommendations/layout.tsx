import type { Metadata } from 'next';

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
      <div className="text-center text-xs sm:text-sm text-gray-500 dark:text-gray-400 py-6 px-6 border-t border-gray-200 dark:border-gray-700 mt-6">
        <p className="max-w-md mx-auto">
          Data provided by <a href="https://vndb.org" target="_blank" rel="noopener noreferrer" className="text-primary-600 dark:text-primary-400 hover:underline">VNDB</a>. Statistics are based on daily data dumps and may not reflect real-time changes.
        </p>
      </div>
    </>
  );
}
