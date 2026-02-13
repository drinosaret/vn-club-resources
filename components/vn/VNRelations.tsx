'use client';

import Link from 'next/link';
import { BookOpen, Star, GitBranch } from 'lucide-react';
import type { VNRelation } from '@/lib/vndb-stats-api';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { CARD_IMAGE_WIDTH, CARD_IMAGE_SIZES, buildCardSrcSet } from './card-image-utils';
import { useDisplayTitle } from '@/lib/title-preference';
import { NSFWImage } from '@/components/NSFWImage';
import { useImageFade } from '@/hooks/useImageFade';

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
  const getDisplayTitle = useDisplayTitle();

  if (!relations || relations.length === 0) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-100 dark:border-gray-700 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <GitBranch className="w-5 h-5 text-primary-500" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Related Visual Novels
        </h2>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {relations.map((rel) => (
          <RelationCard key={rel.id} rel={rel} />
        ))}
      </div>
    </div>
  );
}

function RelationCard({ rel }: { rel: VNRelation }) {
  const getDisplayTitle = useDisplayTitle();
  const { onLoad, shimmerClass, fadeClass } = useImageFade();
  const displayTitle = getDisplayTitle({ title: rel.title, title_jp: rel.title_jp, title_romaji: rel.title_romaji });

  const imageUrl = getProxiedImageUrl(rel.image_url, { width: CARD_IMAGE_WIDTH, vnId: rel.id });
  const srcSet = rel.image_url ? buildCardSrcSet(rel.image_url, rel.id) : undefined;

  return (
    <Link
      href={`/vn/${rel.id}`}
      className="group block bg-gray-50 dark:bg-gray-700/50 rounded-lg overflow-hidden hover:ring-2 hover:ring-primary-500 transition-all"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '0 280px' }}
    >
      <div className="relative aspect-[3/4] bg-gray-200 dark:bg-gray-700">
        {rel.image_url ? (
          <>
            <div className={shimmerClass} />
            <NSFWImage
              src={imageUrl}
              alt={displayTitle}
              vnId={rel.id}
              imageSexual={rel.image_sexual}
              className={`w-full h-full object-cover object-top ${fadeClass}`}
              loading="lazy"
              srcSet={srcSet}
              sizes={CARD_IMAGE_SIZES}
              onLoad={onLoad}
            />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <BookOpen className="w-8 h-8" />
          </div>
        )}
        {rel.rating && (
          <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/70 text-white text-xs rounded">
            <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
            {rel.rating.toFixed(1)}
          </div>
        )}
        <div className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-gray-900/80 text-white text-xs rounded">
          {relationLabels[rel.relation] || rel.relation}
        </div>
      </div>
      <div className="p-2">
        <h4 className="font-medium text-xs text-gray-900 dark:text-white line-clamp-2 group-hover:text-primary-600 dark:group-hover:text-primary-400">
          {displayTitle}
        </h4>
      </div>
    </Link>
  );
}
