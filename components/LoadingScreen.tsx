import { Loader2 } from 'lucide-react';

interface LoadingScreenProps {
  title?: string;
  subtitle?: string;
}

export function LoadingScreen({ title = 'Loading data…', subtitle = 'Hang tight, fetching stats from VNDB' }: LoadingScreenProps) {
  return (
    // The band holds a page's worth so the footer stays below the fold until there is a page
    // above it. Its middle is past the fold, so the spinner sits near the top of it instead.
    <div className="min-h-[calc(100vh+8rem)] flex flex-col items-center justify-start pt-[12vh] gap-4 text-center text-gray-700 dark:text-gray-200">
      <div className="relative h-16 w-16">
        <div className="absolute inset-0 rounded-full bg-linear-to-br from-primary-400/30 via-primary-500/30 to-primary-600/30 blur-lg animate-pulse" />
        <div className="relative h-16 w-16 rounded-full border border-primary-300/60 dark:border-primary-700/60 flex items-center justify-center bg-white/60 dark:bg-gray-800/60 shadow-xs">
          <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
        </div>
      </div>
      <div className="space-y-1">
        <div className="text-lg font-semibold">{title}</div>
        <div className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</div>
      </div>
    </div>
  );
}
