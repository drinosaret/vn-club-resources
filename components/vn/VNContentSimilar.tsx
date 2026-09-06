'use client';

import { useState, useEffect, useRef } from 'react';
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
      <section className="vn-sec p-4 sm:p-5">
        <div className="vn-sec-head">
          <h2 className="vn-sec-title">Similar Games</h2>
        </div>
        <div className="vn-shelf">
          {[...Array(5)].map((_, i) => (
            <div key={i}>
              <div className="aspect-3/4 rounded-xs mb-2 image-placeholder" />
              <div className="h-4 rounded-xs w-3/4 image-placeholder" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="vn-sec p-4 sm:p-5">
        <div className="vn-sec-head">
          <h2 className="vn-sec-title">Similar Games</h2>
        </div>
        <p className="text-sm text-[color:var(--nezu)]">
          Similarity data is currently being refreshed. Check back in a few minutes.
        </p>
      </section>
    );
  }

  if (!similar || similar.length === 0) {
    return null; // Don't show empty section
  }

  return (
    <section className="vn-sec p-4 sm:p-5">
      <div className="vn-sec-head">
        <div className="flex items-center gap-2">
          <h2 className="vn-sec-title">Similar Games</h2>
          <div className="relative" ref={tooltipRef}>
            <button
              type="button"
              onClick={() => setShowTooltip(t => !t)}
              aria-expanded={showTooltip}
              aria-label="How this list is built"
              aria-describedby="tooltip-similar-games"
              className="tab"
            >
              ?
            </button>
            {showTooltip && (
              <div
                id="tooltip-similar-games"
                role="tooltip"
                className="on-box absolute left-1/2 -translate-x-1/2 sm:translate-x-0 sm:left-0 top-8 z-50 w-64 p-2.5 rounded-xs bg-[color:var(--box)] text-[color:var(--ink-box)] text-xs"
              >
                Based on tag similarity. Games with similar themes, settings, and content tags are shown here.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="vn-shelf">
        {similar.map((vn) => (
          <SimilarVNCard key={vn.vn_id} vn={vn} />
        ))}
      </div>
    </section>
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
        <span className="vn-mark bottom-1.5 left-1.5">
          {Math.round(vn.similarity * 100)}% match
        </span>
      }
    />
  );
}
