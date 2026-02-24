'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import type { FeaturedVNData } from '@/lib/featured-vns';
import { useImageFade } from '@/hooks/useImageFade';

interface FeaturedVNsProps {
  vns: FeaturedVNData[];
}

// Fisher-Yates shuffle
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const DISPLAY_COUNT = 6;

export function FeaturedVNs({ vns }: FeaturedVNsProps) {
  const [shuffledVNs, setShuffledVNs] = useState<FeaturedVNData[]>([]);
  const [isReady, setIsReady] = useState(false);
  const { preference } = useTitlePreference();

  useEffect(() => {
    // Shuffle on client mount
    setShuffledVNs(shuffleArray(vns).slice(0, DISPLAY_COUNT));
    // Skip fade-in animation during back-nav scroll restoration
    if (sessionStorage.getItem('is-popstate-navigation') === 'true') {
      setIsReady(true);
    } else {
      // Small delay for smooth fade-in
      requestAnimationFrame(() => {
        setIsReady(true);
      });
    }
  }, [vns]);

  if (vns.length === 0) {
    return null;
  }

  // Show skeleton placeholders until shuffled content is ready
  const displayedVNs = shuffledVNs.length > 0 ? shuffledVNs : vns.slice(0, DISPLAY_COUNT);

  return (
    <section className="pt-8 md:pt-12 pb-6 md:pb-8 bg-gray-50 dark:bg-gray-900/50">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="text-center mb-6">
          <h2 className="text-xl md:text-3xl font-bold text-gray-900 dark:text-white">
            Popular with Learners
          </h2>
          <p className="text-sm md:text-base text-gray-600 dark:text-gray-400 mt-1">
            Great visual novels to start your journey
          </p>
        </div>

        {/* 3x2 grid on mobile, 6 columns on desktop - fades in after shuffle */}
        <div className={`grid grid-cols-3 md:grid-cols-6 gap-3 md:gap-4 transition-opacity duration-300 ${isReady ? 'opacity-100' : 'opacity-0'}`}>
          {displayedVNs.map((vn) => (
            <FeaturedVNCard key={vn.id} vn={vn} preference={preference} />
          ))}
        </div>

        <div className="text-center mt-5">
          <Link
            href="/browse/"
            className="inline-flex items-center text-base font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
          >
            Browse all visual novels
            <ChevronRight className="w-4 h-4 ml-0.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function FeaturedVNCard({ vn, preference }: { vn: FeaturedVNData; preference: 'japanese' | 'romaji' }) {
  const { onLoad, fadeClass } = useImageFade();
  const displayTitle = getDisplayTitle(vn, preference);

  return (
    <Link
      href={`/vn/${vn.id.replace('v', '')}`}
      className="group"
    >
      <div className="relative overflow-hidden rounded-lg shadow-lg transition-transform duration-150 group-hover:-translate-y-1">
        <div className="aspect-2/3 relative bg-linear-to-br from-primary-100 to-primary-200 dark:from-gray-700 dark:to-gray-600">
          {vn.imageUrl && (
            <Image
              src={vn.imageUrl}
              alt={displayTitle}
              fill
              loading="lazy"
              className={`object-cover transition-transform duration-300 group-hover:scale-105 ${fadeClass}`}
              sizes="(max-width: 768px) 33vw, 16vw"
              unoptimized
              onLoad={onLoad}
            />
          )}
        </div>
      </div>
      <div className="mt-2">
        <p className="text-xs md:text-sm font-medium text-gray-900 dark:text-white line-clamp-2 leading-tight">
          {displayTitle}
        </p>
      </div>
    </Link>
  );
}
