'use client';

import { useState, useEffect, useRef } from 'react';
import { Sparkles, HelpCircle, RefreshCw } from 'lucide-react';
import type { SimilarVN } from '@/lib/vndb-stats-api';
import { VNCard } from './VNCard';

interface VNContentSimilarProps {
  similar: SimilarVN[];
  isLoading?: boolean;
  error?: boolean;
}

export function VNContentSimilar({ similar, isLoading, error }: VNContentSimilarProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Close tooltip on outside click or Escape
  useEffect(() => {
    if (!showTooltip) return;
    const handleClick = (e: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        setShowTooltip(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowTooltip(false);
    };
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('keydown', handleKey);
    };
  }, [showTooltip]);

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 border border-gray-100 dark:border-gray-700 shadow-xs">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-5 h-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Similar Games
          </h2>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i}>
              <div className="aspect-3/4 rounded-lg mb-2 image-placeholder" />
              <div className="h-4 rounded-sm w-3/4 image-placeholder" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 border border-gray-100 dark:border-gray-700 shadow-xs">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-5 h-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Similar Games
          </h2>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          Similarity data is currently being refreshed. Check back in a few minutes.
        </p>
      </div>
    );
  }

  if (!similar || similar.length === 0) {
    return null; // Don't show empty section
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 border border-gray-100 dark:border-gray-700 shadow-xs">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-5 h-5 text-primary-500" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Similar Games
        </h2>
        <div className="relative" ref={tooltipRef}>
          <button
            type="button"
            onClick={() => setShowTooltip(t => !t)}
            aria-expanded={showTooltip}
            aria-describedby="tooltip-similar-games"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-help"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
          {showTooltip && (
            <div
              id="tooltip-similar-games"
              role="tooltip"
              className="absolute left-1/2 -translate-x-1/2 sm:translate-x-0 sm:left-0 top-6 z-50 w-64 p-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg shadow-lg"
            >
              Based on tag similarity. Games with similar themes, settings, and content tags are shown here.
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 sm:translate-x-0 sm:left-2 w-2 h-2 bg-gray-900 dark:bg-gray-700 rotate-45" />
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
        {similar.map((vn) => (
          <SimilarVNCard key={vn.vn_id} vn={vn} />
        ))}
      </div>
    </div>
  );
}

function SimilarVNCard({ vn }: { vn: SimilarVN }) {
  return (
    <VNCard
      id={vn.vn_id}
      title={vn.title}
      titleJp={vn.title_jp}
      titleRomaji={vn.title_romaji}
      imageUrl={vn.image_url}
      imageSexual={vn.image_sexual}
      rating={vn.rating}
      badge={
        <div className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-primary-600/90 text-white text-xs rounded-sm">
          {Math.round(vn.similarity * 100)}% match
        </div>
      }
    />
  );
}
