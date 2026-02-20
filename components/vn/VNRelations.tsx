'use client';

import { GitBranch } from 'lucide-react';
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
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-100 dark:border-gray-700 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <GitBranch className="w-5 h-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Related Visual Novels</h2>
        </div>
        <p className="text-gray-500 dark:text-gray-400 text-center py-4">
          No related visual novels.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 border border-gray-100 dark:border-gray-700 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <GitBranch className="w-5 h-5 text-primary-500" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Related Visual Novels
        </h2>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
        {relations.map((rel) => (
          <RelationCard key={rel.id} rel={rel} />
        ))}
      </div>
    </div>
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
        <div className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-gray-900/80 text-white text-xs rounded">
          {relationLabels[rel.relation] || rel.relation}
        </div>
      }
    />
  );
}
