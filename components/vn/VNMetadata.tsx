'use client';

import Link from 'next/link';
import { Calendar, Clock, Monitor, Globe, Database, Building2 } from 'lucide-react';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';

interface VNMetadataProps {
  title: string;           // Main/English title from VNDB
  titleJp?: string;        // Original Japanese title (kanji/kana)
  titleRomaji?: string;    // Romanized title
  olang?: string;          // Original language (e.g., "ja" for Japanese)
  developers?: Array<{ id: string; name: string; original?: string }>;
  released?: string;
  length?: number;
  platforms?: string[];
  languages?: string[];
  updatedAt?: string;
}

const lengthLabels: Record<number, { label: string; hours: string }> = {
  1: { label: 'Very Short', hours: '< 2 hours' },
  2: { label: 'Short', hours: '2-10 hours' },
  3: { label: 'Medium', hours: '10-30 hours' },
  4: { label: 'Long', hours: '30-50 hours' },
  5: { label: 'Very Long', hours: '> 50 hours' },
};

// Map platform codes to readable names (VNDB platform identifiers)
const platformNames: Record<string, string> = {
  win: 'Windows',
  lin: 'Linux',
  mac: 'macOS',
  web: 'Web',
  dos: 'DOS',
  ios: 'iOS',
  and: 'Android',
  mob: 'Mobile',
  // Sony
  ps1: 'PS1',
  ps2: 'PS2',
  ps3: 'PS3',
  ps4: 'PS4',
  ps5: 'PS5',
  psp: 'PSP',
  psv: 'PS Vita',
  // Nintendo
  nes: 'NES',
  sfc: 'SNES',
  n3d: '3DS',
  nds: 'Nintendo DS',
  gba: 'GBA',
  gbc: 'Game Boy Color',
  wii: 'Wii',
  wiu: 'Wii U',
  swi: 'Switch',
  sw2: 'Switch 2',
  // Microsoft
  xb1: 'Xbox',
  xb3: 'Xbox 360',
  xbo: 'Xbox One',
  xxs: 'Xbox Series X/S',
  // Sega
  drc: 'Dreamcast',
  sat: 'Saturn',
  smd: 'Mega Drive',
  scd: 'Sega CD',
  // NEC
  pce: 'PC Engine',
  pcf: 'PC-FX',
  // Japanese PCs
  p88: 'PC-88',
  p98: 'PC-98',
  x1s: 'Sharp X1',
  x68: 'Sharp X68000',
  fm7: 'FM-7',
  fm8: 'FM-8',
  fmt: 'FM Towns',
  msx: 'MSX',
  // Other
  bdp: 'Blu-ray Player',
  dvd: 'DVD Player',
  tdo: '3DO',
  vnd: 'VNDS',
  oth: 'Other',
};

export function VNMetadata({
  title,
  titleJp,
  titleRomaji,
  olang,
  developers,
  released,
  length,
  platforms,
  languages,
  updatedAt,
}: VNMetadataProps) {
  const { preference } = useTitlePreference();
  const lengthInfo = length ? lengthLabels[length] : null;
  const formattedDate = released ? formatReleaseDate(released) : null;
  const displayPlatforms = platforms?.slice(0, 5).map(p => platformNames[p] || p);
  const formattedUpdatedAt = updatedAt ? formatUpdatedAt(updatedAt) : null;

  // Get the primary display title based on user preference
  const primaryTitle = getDisplayTitle({ title, title_jp: titleJp, title_romaji: titleRomaji }, preference);

  // Build list of alternative titles to show below the main title
  const altTitles: string[] = [];

  if (olang === 'ja') {
    // For Japanese VNs: show JP title and romaji (from 'title' field), skip titleRomaji (may be Chinese pinyin)
    if (titleJp && titleJp !== primaryTitle) altTitles.push(titleJp);
    if (title && title !== primaryTitle && title !== titleJp) altTitles.push(title);
  } else {
    // For non-Japanese VNs: show all unique titles
    if (titleJp && titleJp !== primaryTitle) altTitles.push(titleJp);
    if (titleRomaji && titleRomaji !== primaryTitle && titleRomaji !== titleJp) {
      altTitles.push(titleRomaji);
    }
    if (title && title !== primaryTitle && title !== titleJp && title !== titleRomaji) {
      altTitles.push(title);
    }
  }

  return (
    <div className="space-y-4">
      {/* Title */}
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white">
          {primaryTitle}
        </h1>
        {altTitles.length > 0 && (
          <div className="mt-1 text-base italic text-gray-400 dark:text-gray-500">
            {altTitles.map((altTitle, index) => (
              <p key={index}>{altTitle}</p>
            ))}
          </div>
        )}
      </div>

      {/* Developer */}
      {developers && developers.length > 0 && (
        <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
          <Building2 className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <p>
            {developers.map((dev, index) => {
              // name = native script (Japanese for JP producers)
              // original = romanized/latin name
              const displayName = (preference === 'romaji' && dev.original)
                ? dev.original
                : dev.name;

              return (
                <span key={dev.id}>
                  {index > 0 && ', '}
                  <Link
                    href={`/stats/producer/${dev.id}`}
                    className="hover:text-primary-600 dark:hover:text-primary-400 hover:underline transition-colors"
                  >
                    {displayName}
                  </Link>
                </span>
              );
            })}
          </p>
        </div>
      )}

      {/* Meta info row */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-500 dark:text-gray-400">
        {formattedDate && (
          <div className="flex items-center gap-1.5">
            <Calendar className="w-4 h-4" />
            <span>{formattedDate}</span>
          </div>
        )}

        {lengthInfo && (
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4" />
            <span>{lengthInfo.label}</span>
            <span className="text-gray-400 dark:text-gray-500">({lengthInfo.hours})</span>
          </div>
        )}

        {formattedUpdatedAt && (
          <div className="flex items-center gap-1.5" title="Last updated in database">
            <Database className="w-4 h-4" />
            <span>{formattedUpdatedAt}</span>
          </div>
        )}
      </div>

      {/* Platforms */}
      {displayPlatforms && displayPlatforms.length > 0 && (
        <div className="flex items-start gap-2">
          <Monitor className="w-4 h-4 mt-1 text-gray-400 flex-shrink-0" />
          <div className="flex flex-wrap gap-1.5">
            {displayPlatforms.map((platform) => (
              <span
                key={platform}
                className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded"
              >
                {platform}
              </span>
            ))}
            {platforms && platforms.length > 5 && (
              <span className="px-2 py-0.5 text-xs text-gray-400">
                +{platforms.length - 5} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Languages */}
      {languages && languages.length > 0 && (
        <div className="flex items-start gap-2">
          <Globe className="w-4 h-4 mt-1 text-gray-400 flex-shrink-0" />
          <div className="flex flex-wrap gap-1.5">
            {languages.slice(0, 8).map((lang) => (
              <span
                key={lang}
                className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded uppercase"
              >
                {lang}
              </span>
            ))}
            {languages.length > 8 && (
              <span className="px-2 py-0.5 text-xs text-gray-400">
                +{languages.length - 8} more
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatReleaseDate(dateStr: string): string {
  // Handle various date formats from VNDB (YYYY-MM-DD, YYYY-MM, YYYY, or partial dates)
  if (!dateStr) return '';

  // Check for TBA or unknown
  if (dateStr === 'tba' || dateStr.includes('9999')) return 'TBA';

  const parts = dateStr.split('-');
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];

  if (!year || year === '0000') return 'Unknown';

  // If only year
  if (!month || month === '99' || month === '00') return year;

  // If year and month
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthNum = parseInt(month, 10);
  const monthName = monthNames[monthNum - 1] || month;

  if (!day || day === '99' || day === '00') return `${monthName} ${year}`;

  // Full date
  return `${monthName} ${parseInt(day, 10)}, ${year}`;
}

function formatUpdatedAt(dateStr: string): string {
  if (!dateStr) return '';

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Handle future dates (timezone issues) or same day
  if (diffDays <= 0) return 'Updated today';
  if (diffDays === 1) return 'Updated yesterday';
  if (diffDays < 7) return `Updated ${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `Updated ${weeks} week${weeks > 1 ? 's' : ''} ago`;
  }
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `Updated ${months} month${months > 1 ? 's' : ''} ago`;
  }

  const years = Math.floor(diffDays / 365);
  return `Updated ${years} year${years > 1 ? 's' : ''} ago`;
}
