'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Pen, ChevronDown, ChevronUp, ArrowUpDown, Info, ExternalLink } from 'lucide-react';
import type { StaffBreakdown } from '@/lib/vndb-stats-api';
import { useTitlePreference, getEntityDisplayName } from '@/lib/title-preference';

interface StaffSectionProps {
  staff: StaffBreakdown[];
}

type SortMode = 'weighted' | 'count' | 'rating';

interface StaffWithNormalizedScores extends StaffBreakdown {
  normalized_score: number;  // weighted_score normalized to 0-100 for display
}

const ROLE_LABELS: Record<string, string> = {
  scenario: 'Scenario',
  art: 'Art',
  music: 'Music',
  songs: 'Songs',
  director: 'Director',
  chardesign: 'Character Design',
  staff: 'Staff',
  editor: 'Editor',
  qa: 'QA',
  translator: 'Translator',
};

// Format combined roles for display (e.g., "art, chardesign" -> "Art, Character Design")
function formatRoles(roleString: string): string {
  return roleString
    .split(', ')
    .map(r => ROLE_LABELS[r] || r)
    .join(', ');
}

export function StaffSection({ staff }: StaffSectionProps) {
  const [sortMode, setSortMode] = useState<SortMode>('weighted');
  const [showAll, setShowAll] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const { preference } = useTitlePreference();

  // Extract unique roles and filter staff
  const { roles, filteredStaff } = useMemo(() => {
    // Extract all unique individual roles (staff can have combined roles like "art, chardesign")
    const roleSet = new Set<string>();
    for (const s of staff) {
      s.role.split(', ').forEach(r => roleSet.add(r));
    }
    const roles = Array.from(roleSet).sort();

    // Filter by selected role
    const filtered = roleFilter === 'all'
      ? staff
      : staff.filter(s => s.role.split(', ').includes(roleFilter));

    return { roles, filteredStaff: filtered };
  }, [staff, roleFilter]);

  // Backend now returns pre-normalized scores (0-100 scale), use directly
  const staffWithScores = useMemo((): StaffWithNormalizedScores[] => {
    return filteredStaff.map(s => ({
      ...s,
      normalized_score: s.weighted_score ?? 0,  // Already normalized by backend
    }));
  }, [filteredStaff]);

  // Calculate taste preferences (staff user rates higher/lower than VNDB average)
  const preferences = useMemo(() => {
    const loved: Array<{id: string; name: string; original?: string | null; user_avg: number; global_avg: number}> = [];
    const avoided: Array<{id: string; name: string; original?: string | null; user_avg: number; global_avg: number}> = [];

    for (const s of staff) {
      if (s.avg_rating > 0 && s.global_avg_rating != null && s.count >= 3) {
        const diff = s.avg_rating - s.global_avg_rating;
        const pref = {
          id: s.id,
          name: s.name,
          original: s.original,
          user_avg: s.avg_rating,
          global_avg: s.global_avg_rating,
        };
        if (diff > 0.5) {
          loved.push(pref);
        } else if (diff < -0.5) {
          avoided.push(pref);
        }
      }
    }

    loved.sort((a, b) => (b.user_avg - b.global_avg) - (a.user_avg - a.global_avg));
    avoided.sort((a, b) => (a.global_avg - a.user_avg) - (b.global_avg - b.user_avg));

    return { loved: loved.slice(0, 10), avoided: avoided.slice(0, 10) };
  }, [staff]);

  // Sort staff based on selected mode
  const sortedStaff = useMemo(() => {
    const staffCopy = [...staffWithScores];
    switch (sortMode) {
      case 'weighted':
        return staffCopy.sort((a, b) => {
          if (b.normalized_score !== a.normalized_score) return b.normalized_score - a.normalized_score;
          return b.count - a.count;
        });
      case 'count':
        return staffCopy.sort((a, b) => b.count - a.count);
      case 'rating':
        return staffCopy.sort((a, b) => {
          if (b.avg_rating !== a.avg_rating) return b.avg_rating - a.avg_rating;
          return b.count - a.count;
        });
      default:
        return staffCopy;
    }
  }, [staffWithScores, sortMode]);

  const displayedStaff = showAll ? sortedStaff : sortedStaff.slice(0, 10);

  // Calculate max value for bar width
  const maxValue = useMemo(() => {
    switch (sortMode) {
      case 'weighted':
        return 100; // Weighted scores are 0-100
      case 'count':
        return Math.max(...staffWithScores.map(s => s.count), 1);
      case 'rating':
        return 10;
      default:
        return 100;
    }
  }, [staffWithScores, sortMode]);

  if (staff.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
        <div className="flex items-center gap-2 mb-4">
          <Pen className="w-5 h-5 text-primary-500" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Staff
          </h3>
        </div>
        <p className="text-gray-500 dark:text-gray-400 text-center py-8">
          No staff credits found for your VNs.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Pen className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Top Staff
          </h3>
        </div>

        {/* Sort toggle */}
        <div className="flex items-center gap-1 text-sm">
          <ArrowUpDown className="w-4 h-4 text-gray-400" />
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-sm px-2 py-1 text-gray-700 dark:text-gray-300 text-sm focus:outline-hidden focus:ring-1 focus:ring-primary-500"
          >
            <option value="weighted">Weighted</option>
            <option value="count">Count</option>
            <option value="rating">Rating</option>
          </select>
          {sortMode === 'weighted' && (
            <div className="relative group" tabIndex={0} role="button" aria-label="Weighted score info">
              <Info className="w-4 h-4 text-gray-400 cursor-help" />
              <div className="absolute right-0 top-6 w-64 p-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-all z-50">
                <p className="font-medium mb-1">Weighted Score</p>
                <p>Ranks by your ratings, with low-count entries pulled toward your personal average to prevent single-VN flukes from dominating.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Role filter - horizontally scrollable on mobile */}
      {roles.length > 1 && (
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2 -mx-2 px-2 scrollbar-none">
          <button
            onClick={() => setRoleFilter('all')}
            className={`px-3 py-1 text-sm rounded-full transition-colors whitespace-nowrap shrink-0 ${
              roleFilter === 'all'
                ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            All
          </button>
          {roles.map(role => (
            <button
              key={role}
              onClick={() => setRoleFilter(role)}
              className={`px-3 py-1 text-sm rounded-full transition-colors whitespace-nowrap shrink-0 ${
                roleFilter === role
                  ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {ROLE_LABELS[role] || role}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3" style={showAll ? { contentVisibility: 'auto', containIntrinsicSize: 'auto 500px' } : undefined}>
        {displayedStaff.map((s, i) => (
          <StaffBar key={`${s.id}-${i}`} staff={s} maxValue={maxValue} sortMode={sortMode} preference={preference} />
        ))}
      </div>

      {sortedStaff.length > 10 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="mt-4 w-full py-2 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 flex items-center justify-center gap-1 transition-colors"
        >
          {showAll ? (
            <>
              Show Less <ChevronUp className="w-4 h-4" />
            </>
          ) : (
            <>
              Show All ({sortedStaff.length}) <ChevronDown className="w-4 h-4" />
            </>
          )}
        </button>
      )}

      {/* Taste Analysis */}
      {(preferences.loved.length > 0 || preferences.avoided.length > 0) && (
        <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-700">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            Taste Analysis
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {preferences.loved.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  You rate higher than average:
                </p>
                <div className="flex flex-wrap gap-2">
                  {preferences.loved.slice(0, 5).map((pref) => (
                    <Link
                      key={pref.id}
                      href={`/stats/staff/${pref.id}`}
                      className="px-2 py-1 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-sm hover:bg-green-200 dark:hover:bg-green-800/40 transition-colors"
                    >
                      {getEntityDisplayName(pref, preference)}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {preferences.avoided.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  You rate lower than average:
                </p>
                <div className="flex flex-wrap gap-2">
                  {preferences.avoided.slice(0, 5).map((pref) => (
                    <Link
                      key={pref.id}
                      href={`/stats/staff/${pref.id}`}
                      className="px-2 py-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-sm hover:bg-red-200 dark:hover:bg-red-800/40 transition-colors"
                    >
                      {getEntityDisplayName(pref, preference)}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StaffBar({ staff, maxValue, sortMode, preference }: { staff: StaffWithNormalizedScores; maxValue: number; sortMode: SortMode; preference: 'romaji' | 'japanese' }) {
  const displayName = getEntityDisplayName(staff, preference);

  // Calculate bar width based on sort mode
  let barValue: number;
  switch (sortMode) {
    case 'weighted':
      barValue = staff.normalized_score;
      break;
    case 'count':
      barValue = staff.count;
      break;
    case 'rating':
      barValue = staff.avg_rating;
      break;
    default:
      barValue = staff.normalized_score;
  }
  const width = (barValue / maxValue) * 100;

  return (
    <div className="group">
      <div className="flex items-center justify-between mb-1 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href={`/stats/staff/${staff.id}`}
            className="text-sm text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors truncate"
          >
            {displayName}
          </Link>
          {/* Hide role badge on mobile */}
          <span className="hidden sm:inline-flex px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 shrink-0">
            {formatRoles(staff.role)}
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 text-sm shrink-0">
          {/* On mobile: only show primary metric. On desktop: show all */}
          <Link
            href={`/browse?staff=${encodeURIComponent(staff.id)}&tag_names=${encodeURIComponent(`staff:${staff.id}:${displayName}`)}`}
            className={`${sortMode === 'count' ? '' : 'hidden sm:inline-flex'} hover:text-primary-600 dark:hover:text-primary-400 transition-colors inline-flex items-center gap-1 ${sortMode === 'count'
              ? 'text-primary-600 dark:text-primary-400 font-medium'
              : 'text-gray-500 dark:text-gray-400'}`}
            title={`Browse all VNs with ${displayName}`}
          >
            {staff.count} VNs
            <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block" />
          </Link>
          {staff.avg_rating > 0 && (
            <span
              className={`${sortMode === 'rating' ? '' : 'hidden sm:inline'} ${sortMode === 'rating'
                ? 'text-primary-600 dark:text-primary-400 font-medium'
                : 'text-gray-500 dark:text-gray-400'}`}
              title="Your average rating"
            >
              {staff.avg_rating.toFixed(1)}
            </span>
          )}
          {sortMode === 'weighted' && (
            <span
              className="text-primary-600 dark:text-primary-400 font-medium"
              title="Weighted score"
            >
              {staff.normalized_score.toFixed(1)}
            </span>
          )}
        </div>
      </div>
      <div className="h-2.5 bg-gray-100 dark:bg-gray-700/60 rounded-full overflow-hidden">
        <div
          className="h-full bg-linear-to-r from-primary-500 to-primary-400 dark:from-primary-600 dark:to-primary-400 rounded-full transition-all duration-300"
          style={{ width: `${Math.min(100, width)}%` }}
        />
      </div>
    </div>
  );
}
