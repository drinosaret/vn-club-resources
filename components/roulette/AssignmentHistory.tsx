'use client';

import Link from '@/components/Link';
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
        <h2 className="toy-label">{s['assignments.title']}</h2>
        <button
          onClick={onReset}
          className="toy-btn"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {s['assignments.reset']}
        </button>
      </div>

      <div className="toy-panel overflow-hidden">
        <table className="toy-table">
          <thead>
            <tr>
              <th className="w-12">{s['assignments.colRound']}</th>
              <th>{s['assignments.colPlayer']}</th>
              <th>{s['assignments.colVN']}</th>
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
                <tr key={i}>
                  <td className="toy-num">{a.round}</td>
                  <td className="font-medium">{a.player}</td>
                  <td>
                    <Link
                      href={`/vn/${a.vn.id}/`}
                      className="flex items-center gap-2 text-[color:var(--ink)] hover:text-[color:var(--ai)] transition-colors"
                    >
                      {coverSrc && (
                        <div className="toy-thumb w-5 h-7">
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
