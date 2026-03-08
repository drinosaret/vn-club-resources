'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import { BookOpen, RefreshCw, ExternalLink } from 'lucide-react';
import type { FeaturedVNData } from '@/lib/featured-vns';
import { FEATURED_VN_IDS } from '@/lib/featured-vns';
import { VNCard } from '@/components/vn/VNCard';

interface EasyVN {
  vnId: string;
  title: string;
  titleJp: string;
  difficulty: number;
  characterCount: number;
  coverUrl: string | null;
  imageSexual: number;
}

const fetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  if (!Array.isArray(data) || data.length === 0) throw new Error('No results');
  return data as EasyVN[];
};

export default function BeginnerVNsContent({
  featuredVNs,
}: {
  featuredVNs: FeaturedVNData[];
}) {
  const [shuffleSeed, setShuffleSeed] = useState(0);

  const excludeIds = FEATURED_VN_IDS.join(',');
  const {
    data: easyVNs,
    isLoading,
    isValidating,
  } = useSWR<EasyVN[]>(
    `/api/jiten/easy-vns/?exclude=${excludeIds}&seed=${shuffleSeed}`,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      errorRetryCount: 2,
      keepPreviousData: true,
    },
  );

  const handleShuffle = useCallback(() => {
    setShuffleSeed((s) => s + 1);
  }, []);

  return (
    <div className="min-h-[80vh] px-4 py-10 md:py-14">
      <div className="max-w-5xl mx-auto">
        {/* Page header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 mb-4">
            <BookOpen className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-3">
            Beginner Visual Novels for Learning Japanese
          </h1>
          <p className="text-base md:text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Start reading Japanese with visual novels picked for approachable
            language and engaging stories. Whether it&apos;s your first VN or
            you&apos;re looking for something easy to build confidence, these
            are great choices for immersion-based Japanese learning.
          </p>
        </div>

        {/* Section 1: Handpicked */}
        <section className="mb-14">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
            Our Picks
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Community-recommended visual novels for your first Japanese read
          </p>
          <div className="flex flex-wrap justify-center gap-3 md:gap-4">
            {featuredVNs.map((vn) => (
              <div key={vn.id} className="w-[calc(33.333%-8px)] md:w-[calc(25%-12px)] lg:w-[calc(20%-12.8px)]">
                <VNCard
                  id={vn.id}
                  title={vn.title ?? ''}
                  titleJp={vn.title_jp}
                  titleRomaji={vn.title_romaji}
                  imageUrl={vn.imageUrl}
                  imageSexual={vn.image_sexual}
                />
              </div>
            ))}
          </div>
        </section>

        {/* Section 2: Discover More */}
        <section>
          <div className="flex flex-col items-center sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
            <div className="text-center sm:text-left">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
                Discover More
              </h2>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Random easy-difficulty VNs from{' '}
                <a
                  href="https://jiten.moe"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-600 dark:text-primary-400 hover:underline inline-flex items-center gap-0.5"
                >
                  jiten.moe difficulty ratings
                  <ExternalLink className="w-3 h-3" />
                </a>
              </p>
            </div>
            <button
              onClick={handleShuffle}
              disabled={isLoading || isValidating}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-60 transition-colors"
            >
              <RefreshCw
                className={`w-4 h-4 ${isValidating ? 'animate-spin' : ''}`}
              />
              Shuffle
            </button>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
            {isLoading && !easyVNs
              ? Array.from({ length: 10 }).map((_, i) => (
                  <div
                    key={i}
                    className="rounded-lg overflow-hidden bg-gray-50 dark:bg-gray-700/50"
                  >
                    <div className="aspect-3/4 image-placeholder" />
                    <div className="p-2">
                      <div className="h-3 w-3/4 rounded image-placeholder" />
                    </div>
                  </div>
                ))
              : easyVNs?.map((vn) => (
                  <VNCard
                    key={vn.vnId}
                    id={vn.vnId}
                    title={vn.title}
                    titleJp={vn.titleJp}
                    imageUrl={vn.coverUrl}
                    imageSexual={vn.imageSexual}
                    badge={<DifficultyBadge difficulty={vn.difficulty} />}
                  />
                ))}
          </div>

          {!isLoading && !isValidating && !easyVNs?.length && (
            <p className="text-center text-gray-500 dark:text-gray-400 py-8">
              Could not load suggestions right now. Try shuffling again.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function DifficultyBadge({ difficulty }: { difficulty: number }) {
  const color =
    difficulty <= 1.2
      ? 'bg-emerald-600/90'
      : difficulty <= 1.8
        ? 'bg-sky-600/90'
        : 'bg-amber-600/90';
  return (
    <div className={`absolute top-2 left-2 px-1.5 py-0.5 ${color} text-white text-[10px] font-medium rounded-sm`}>
      {difficulty.toFixed(1)}
    </div>
  );
}
