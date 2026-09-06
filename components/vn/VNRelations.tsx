'use client';

import type { VNRelation } from '@/lib/vndb-stats-api';
import { VNCard } from './VNCard';

interface VNRelationsProps {
  relations?: VNRelation[];
}

const relationLabels: Record<string, string> = {
  seq: 'Sequel',
  preq: 'Prequel',
  set: 'Same Setting',
  alt: 'Alternative Version',
  char: 'Shares Characters',
  side: 'Side Story',
  par: 'Parent Story',
  ser: 'Same Series',
  fan: 'Fandisc',
  orig: 'Original Game',
};

export function VNRelations({ relations }: VNRelationsProps) {
  if (!relations || relations.length === 0) {
    return null;
  }

  return (
    <section className="vn-sec p-4 sm:p-5">
      <div className="vn-sec-head">
        <h2 className="vn-sec-title">
          Related Visual Novels
        </h2>
      </div>

      <div className="vn-shelf">
        {relations.map((rel) => (
          <RelationCard key={rel.id} rel={rel} />
        ))}
      </div>
    </section>
  );
}

function RelationCard({ rel }: { rel: VNRelation }) {
  return (
    <VNCard
      id={rel.id}
      title={rel.title}
      titleJp={rel.title_jp}
      titleRomaji={rel.title_romaji}
      imageUrl={rel.image_url}
      imageSexual={rel.image_sexual}
      rating={rel.rating}
      badge={
        // The badge cannot wrap and the cover it sits on clips what overflows, and three
        // covers to a row leaves about a hundred pixels at phone width. Bounded to the
        // cover so a longer label ends in an ellipsis rather than mid-word.
        <span className="vn-mark bottom-1.5 left-1.5 max-w-[calc(100%-0.75rem)] overflow-hidden text-ellipsis">
          {relationLabels[rel.relation] || rel.relation}
        </span>
      }
    />
  );
}
