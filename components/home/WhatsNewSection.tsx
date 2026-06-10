import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { changelogEntries, formatChangelogDay } from '@/lib/changelog-data';

// Server component: renders the latest site changelog entries statically.
// Site-only, so entries need no badge (they are always vnclub.org).
export function WhatsNewSection() {
  const latest = [...changelogEntries]
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((entry) => entry.product === 'site')
    .slice(0, 3);

  return (
    <section className="pt-4 pb-10 md:pb-14 bg-gray-50 dark:bg-gray-900/50">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">
              What&apos;s new
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              The latest site updates.
            </p>
          </div>
          <Link
            href="/changelog/"
            className="shrink-0 inline-flex items-center gap-1 text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
          >
            View all updates
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700/50 bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700/50">
          {latest.map((entry) => (
            <div key={`${entry.date}-${entry.title}`} className="p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">{entry.title}</h3>
                <time dateTime={entry.date} className="ml-auto text-sm text-gray-500 dark:text-gray-400">
                  {formatChangelogDay(entry.date)}
                </time>
              </div>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{entry.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
