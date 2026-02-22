import { Newspaper } from 'lucide-react';

export default function NewsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[80vh] px-4 py-12">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-rose-100 dark:bg-rose-900/30 mb-4">
            <Newspaper className="w-10 h-10 text-rose-600 dark:text-rose-400" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-3">
            Visual Novel News<sup className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 ml-1">Beta</sup>
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-xl mx-auto">
            Stay updated with the latest Japanese visual novel and eroge news
          </p>
        </div>

        {children}
      </div>
    </div>
  );
}
