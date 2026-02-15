'use client';

import Link from 'next/link';

import { useTitlePreference } from '@/lib/title-preference';
import { lengthLabels, platformNames, formatReleaseDate, formatUpdatedAt } from './vn-utils';

interface VNSidebarProps {
  rating?: number | null;
  votecount?: number | null;
  developers?: Array<{ id: string; name: string; original?: string }>;
  released?: string;
  length?: number;
  platforms?: string[];
  languages?: string[];
  updatedAt?: string;
}

export function VNSidebar({
  rating,
  votecount,
  developers,
  released,
  length,
  platforms,
  languages,
  updatedAt,
}: VNSidebarProps) {
  const { preference } = useTitlePreference();
  const lengthInfo = length ? lengthLabels[length] : null;
  const formattedDate = released ? formatReleaseDate(released) : null;
  const formattedUpdatedAt = updatedAt ? formatUpdatedAt(updatedAt) : null;

  return (
    <div className="mt-3 space-y-3">
      {/* Rating Arc */}
      {rating != null && votecount != null && votecount > 0 && (
        <RatingArc rating={rating} votecount={votecount} />
      )}

      {/* Metadata items — compact grid */}
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2.5 text-sm items-baseline">
        {developers && developers.length > 0 && (
          <>
            <SidebarLabel>Developer</SidebarLabel>
            <div className="text-gray-800 dark:text-gray-200">
              {developers.map((dev, i) => {
                const displayName = (preference === 'romaji' && dev.original)
                  ? dev.original
                  : dev.name;
                return (
                  <span key={dev.id}>
                    {i > 0 && ', '}
                    <Link
                      href={`/stats/producer/${dev.id}`}
                      className="hover:text-primary-600 dark:hover:text-primary-400 hover:underline transition-colors"
                    >
                      {displayName}
                    </Link>
                  </span>
                );
              })}
            </div>
          </>
        )}

        {formattedDate && (
          <>
            <SidebarLabel>Released</SidebarLabel>
            <div className="text-gray-800 dark:text-gray-200">{formattedDate}</div>
          </>
        )}

        {lengthInfo && (
          <>
            <SidebarLabel>Length</SidebarLabel>
            <div className="text-gray-800 dark:text-gray-200">
              {lengthInfo.label}
              <span className="text-gray-400 dark:text-gray-500 ml-1">({lengthInfo.hours})</span>
            </div>
          </>
        )}

        {platforms && platforms.length > 0 && (
          <div className="col-span-2">
            <SidebarLabel>Platforms</SidebarLabel>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {platforms.slice(0, 5).map(p => (
                <span
                  key={p}
                  className="px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-700/80 text-gray-600 dark:text-gray-300 rounded"
                >
                  {platformNames[p] || p}
                </span>
              ))}
              {platforms.length > 5 && (
                <span className="text-xs text-gray-400">+{platforms.length - 5}</span>
              )}
            </div>
          </div>
        )}

        {languages && languages.length > 0 && (
          <div className="col-span-2">
            <SidebarLabel>Languages</SidebarLabel>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {languages.slice(0, 8).map(lang => (
                <span
                  key={lang}
                  className="px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-700/80 text-gray-600 dark:text-gray-300 rounded uppercase"
                >
                  {lang}
                </span>
              ))}
              {languages.length > 8 && (
                <span className="text-xs text-gray-400">+{languages.length - 8}</span>
              )}
            </div>
          </div>
        )}

      </div>

      {formattedUpdatedAt && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500">
          Updated {formattedUpdatedAt.toLowerCase()}
        </p>
      )}
    </div>
  );
}

function SidebarLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">
      {children}
    </div>
  );
}

// ─── Rating Bar ───

function RatingArc({ rating, votecount }: { rating: number; votecount: number }) {
  const progress = Math.max(0, Math.min((rating - 1) / 9, 1)) * 100;

  let barColor = 'bg-gray-400';
  if (rating >= 8) barColor = 'bg-emerald-500';
  else if (rating >= 7) barColor = 'bg-blue-500';
  else if (rating >= 6) barColor = 'bg-amber-500';
  else if (rating >= 5) barColor = 'bg-orange-500';
  else if (rating > 0) barColor = 'bg-red-500';

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
          {rating.toFixed(2)}
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          / 10
        </span>
        <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">
          {votecount.toLocaleString()} votes
        </span>
      </div>
      <div className="mt-1.5 h-1 rounded-full bg-gray-200 dark:bg-gray-700">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
