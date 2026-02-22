'use client';

import Link from 'next/link';
import { BookOpen, ChevronRight } from 'lucide-react';
import { FadeIn } from '@/components/FadeIn';
import { FeatureStrip } from './FeatureStrip';
import { GuidesGrid, type GuideWithImage } from './GuidesCarousel';
import { FeatureShowcase } from './FeatureShowcase';

interface ExploreSectionProps {
  guides: GuideWithImage[];
}

export function ExploreSection({ guides }: ExploreSectionProps) {
  return (
    <div>
      {/* Strip 1: Learning Hub */}
      <FadeIn>
        <FeatureStrip background="gray">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                  <BookOpen className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                </div>
                <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">
                  Master Your Setup
                </h2>
              </div>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed max-w-2xl">
                Step-by-step tutorials for text hookers, dictionaries, OCR, and everything
                you need to start reading visual novels in Japanese.
              </p>
            </div>
            <Link
              href="/guide/"
              className="inline-flex items-center text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium shrink-0"
            >
              View all guides
              <ChevronRight className="w-4 h-4 ml-1" />
            </Link>
          </div>

          {/* Guides Grid */}
          <GuidesGrid guides={guides} />
        </FeatureStrip>
      </FadeIn>

      {/* Feature Showcase - Bento Grid */}
      <FeatureShowcase />
    </div>
  );
}
