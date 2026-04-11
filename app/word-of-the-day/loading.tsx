import { BookOpen } from 'lucide-react';

export default function WordOfTheDayLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="container mx-auto px-4 max-w-4xl py-8 md:py-12">
        {/* Date nav skeleton */}
        <div className="flex items-center justify-between gap-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
          <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 animate-pulse" />
          <div className="w-40 h-5 rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
          <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 animate-pulse" />
        </div>

        <div className="space-y-6 mt-6">
          {/* Hero skeleton */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 md:p-8">
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                <BookOpen className="w-4 h-4" />
                Word of the Day
              </span>
            </div>
            <div className="flex flex-col md:flex-row gap-6 md:gap-8 items-start">
              <div className="w-full md:w-auto md:min-w-[200px] h-[180px] rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 border border-emerald-200 dark:border-emerald-800/40 animate-pulse" />
              <div className="flex-1 space-y-3 w-full">
                <div className="h-4 w-20 rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
                <div className="h-5 w-48 rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
                <div className="h-4 w-64 rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
                <div className="h-4 w-40 rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
              </div>
            </div>
          </div>

          {/* Sentences skeleton */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <div className="h-5 w-40 rounded bg-gray-100 dark:bg-gray-700 animate-pulse mb-4" />
            <div className="space-y-3">
              <div className="h-12 rounded bg-gray-50 dark:bg-gray-700/50 animate-pulse" />
              <div className="h-12 rounded bg-gray-50 dark:bg-gray-700/50 animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
