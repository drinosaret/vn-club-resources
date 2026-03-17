'use client';

import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { getDisplayTitle, type TitlePreference } from '@/lib/title-preference';
import { getTinySrc } from '@/lib/vndb-image-cache';
import { NSFW_THRESHOLD } from '@/lib/nsfw-reveal';
import { useLocale } from '@/lib/i18n/locale-context';
import { rouletteStrings } from '@/lib/i18n/translations/roulette';
import type { Assignment } from './RoulettePageClient';

interface AssignmentHistoryProps {
  assignments: Assignment[];
  onReset: () => void;
  titlePreference: TitlePreference;
}

export function AssignmentHistory({ assignments, onReset, titlePreference }: AssignmentHistoryProps) {
  const locale = useLocale();
  const s = rouletteStrings[locale];

  return (
    <div className="mt-10 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          {s['assignments.title']}
        </h2>
        <button
          onClick={onReset}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-violet-600 dark:text-gray-400 dark:hover:text-violet-400 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {s['assignments.reset']}
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
              <th className="px-4 py-2.5 text-left font-medium text-gray-500 dark:text-gray-400 w-12">{s['assignments.colRound']}</th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-500 dark:text-gray-400">{s['assignments.colPlayer']}</th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-500 dark:text-gray-400">{s['assignments.colVN']}</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((a, i) => {
              const title = getDisplayTitle(a.vn, titlePreference);
              const isNsfw = a.vn.imageSexual != null && a.vn.imageSexual >= NSFW_THRESHOLD;
              const coverSrc = a.vn.imageUrl
                ? (isNsfw ? getTinySrc(a.vn.imageUrl) : a.vn.imageUrl)
                : null;
              return (
                <tr key={i} className="border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                  <td className="px-4 py-2.5 text-gray-400 dark:text-gray-500">{a.round}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">{a.player}</td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/vn/${a.vn.id}/`}
                      className="flex items-center gap-2 text-gray-700 dark:text-gray-300 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
                    >
                      {coverSrc && (
                        <div className="w-5 h-7 shrink-0 rounded overflow-hidden bg-gray-100 dark:bg-gray-700">
                          <img src={coverSrc} alt="" className="w-full h-full object-cover" style={isNsfw ? { imageRendering: 'pixelated' } : undefined} />
                        </div>
                      )}
                      <span className="truncate">{title}</span>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
