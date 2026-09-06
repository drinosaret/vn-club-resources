'use client';

import { useState } from 'react';
import Link from '@/components/Link';
import type { VNTag } from '@/lib/vndb-stats-api';

interface VNTagsProps {
  tags?: VNTag[];
  maxTags?: number;
}

export function VNTags({ tags, maxTags = 30 }: VNTagsProps) {
  const [showSpoilers, setShowSpoilers] = useState(false);
  const [showSexual, setShowSexual] = useState(false);
  const [showAll, setShowAll] = useState(false);

  if (!tags || tags.length === 0) {
    return null;
  }

  // Filter tags based on spoiler and sexual settings
  const filteredTags = tags.filter(tag =>
    (showSpoilers || tag.spoiler === 0) && (showSexual || tag.category !== 'ero')
  );

  // Limit display
  const displayTags = showAll ? filteredTags : filteredTags.slice(0, maxTags);
  const hasMore = filteredTags.length > maxTags;

  // Counts respect the other toggle's state so they reflect what would actually appear
  const spoilerCount = tags.filter(t => t.spoiler > 0 && (showSexual || t.category !== 'ero')).length;
  const sexualCount = tags.filter(t => t.category === 'ero' && (showSpoilers || t.spoiler === 0)).length;

  return (
    <section className="vn-sec p-4 sm:p-5">
      <div className="vn-sec-head">
        <div className="flex items-baseline gap-2">
          <h2 className="vn-sec-title">Tags</h2>
          <span className="vn-num text-sm text-[color:var(--text-faint)]">
            {filteredTags.length}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {sexualCount > 0 && (
            <button
              onClick={() => setShowSexual(!showSexual)}
              aria-pressed={showSexual}
              className={`tab${showSexual ? ' tab--on' : ''}`}
            >
              <span><span className="hidden sm:inline">{showSexual ? 'Hide' : 'Show'} </span>sexual</span>
              <span className="tab-count">{sexualCount}</span>
            </button>
          )}
          {spoilerCount > 0 && (
            <button
              onClick={() => setShowSpoilers(!showSpoilers)}
              aria-pressed={showSpoilers}
              className={`tab${showSpoilers ? ' tab--on' : ''}`}
            >
              <span><span className="hidden sm:inline">{showSpoilers ? 'Hide' : 'Show'} </span>spoilers</span>
              <span className="tab-count">{spoilerCount}</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {displayTags.map((tag) => {
          const isSpoiler = tag.spoiler > 0;
          const isSexual = tag.category === 'ero';

          return (
            <Link
              key={tag.id}
              href={`/stats/tag/${tag.id}`}
              className={`vn-chip${isSpoiler || isSexual ? ' vn-chip--held' : ''}`}
              title={`Relevance: ${(tag.score * 33).toFixed(0)}%${isSpoiler ? ' (Spoiler)' : ''}${isSexual ? ' (Sexual)' : ''}`}
            >
              {tag.name}
              {isSpoiler && <span className="font-mono text-xs">!</span>}
              {isSexual && <span className="font-mono text-xs">&#9829;</span>}
            </Link>
          );
        })}
      </div>

      {hasMore && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="sec-more mt-3"
        >
          Show all {filteredTags.length} tags
          <span aria-hidden>→</span>
        </button>
      )}
    </section>
  );
}
