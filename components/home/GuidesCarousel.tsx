'use client';

import Image from 'next/image';
import Link from 'next/link';

interface GuideWithImage {
  title: string;
  slug: string;
  description?: string;
  image: string | null;
}

interface GuideCardProps {
  guide: GuideWithImage;
}

function GuideCard({ guide }: GuideCardProps) {
  return (
    <Link
      href={`/${guide.slug}`}
      className="group relative overflow-hidden rounded-xl"
    >
      <div className="relative aspect-4/3">
        {guide.image ? (
          <Image
            src={guide.image}
            alt={guide.title}
            fill
            loading="lazy"
            className="object-cover transition-transform duration-500 group-hover:scale-110"
            sizes="(max-width: 640px) 33vw, (max-width: 768px) 25vw, 20vw"
          />
        ) : (
          <div className="absolute inset-0 bg-linear-to-br from-gray-400 to-gray-600" />
        )}

        <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/20 to-transparent" />

        <div className="absolute bottom-0 left-0 right-0 p-2.5">
          <h4 className="text-xs sm:text-sm font-semibold text-white line-clamp-1">
            {guide.title}
          </h4>
          {guide.description && (
            <p className="hidden sm:block text-xs text-white/70 line-clamp-1 mt-0.5">
              {guide.description}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

interface GuidesGridProps {
  guides: GuideWithImage[];
}

export function GuidesGrid({ guides }: GuidesGridProps) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
      {guides.map((guide) => (
        <GuideCard key={guide.slug} guide={guide} />
      ))}
    </div>
  );
}

// Keep old name as alias for backwards compat during transition
export const GuidesCarousel = GuidesGrid;

export type { GuideWithImage };