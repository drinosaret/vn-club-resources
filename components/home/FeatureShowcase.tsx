'use client';

import Link from 'next/link';
import {
  BarChart3,
  Wrench,
  Languages,
  Sparkles,
  Newspaper,
  BookOpen,
  ScanText,
  ArrowRight,
} from 'lucide-react';
import { FadeIn } from '@/components/FadeIn';

interface BentoCardProps {
  href: string;
  children: React.ReactNode;
  className?: string;
}

function BentoCard({ href, children, className = '' }: BentoCardProps) {
  return (
    <Link
      href={href}
      className={`group relative block overflow-hidden rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-xs hover:shadow-md hover:-translate-y-1 transition-[box-shadow,transform] duration-300 ${className}`}
    >
      {children}
    </Link>
  );
}

function Badge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`absolute bottom-3 right-3 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 ${className}`}>
      {children}
    </span>
  );
}

function MiniStatsPreview() {
  // Sample bar heights for visual effect
  const bars = [65, 85, 45, 90, 70, 55];

  return (
    <div className="h-full p-6 pb-10 flex flex-col">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
          <BarChart3 className="w-6 h-6 text-primary-600 dark:text-primary-400" />
        </div>
        <div>
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
            VNDB Stats
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Analyze your reading list
          </p>
        </div>
      </div>

      {/* Mini bar chart visualization */}
      <div className="flex-1 flex items-end justify-center gap-2 pt-4 pb-2">
        {bars.map((height, i) => (
          <div
            key={i}
            className="w-8 md:w-10 rounded-t-md bg-linear-to-t from-primary-500 to-primary-400 dark:from-primary-600 dark:to-primary-500 opacity-80 group-hover:opacity-100 transition-opacity duration-500"
            style={{
              height: `${height}%`,
              transitionDelay: `${i * 50}ms`,
            }}
          />
        ))}
      </div>

      <div className="flex items-center text-primary-600 dark:text-primary-400 font-medium text-sm mt-4 opacity-0 group-hover:opacity-100 transition-opacity">
        <span>View stats</span>
        <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
      </div>
      <Badge>Beta</Badge>
    </div>
  );
}

function ToolsPreview() {
  return (
    <div className="h-full p-5 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-10 h-10 shrink-0 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
          <Wrench className="w-5 h-5 text-amber-600 dark:text-amber-400" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
          Tools
        </h3>
      </div>

      {/* Tool icons grid */}
      <div className="flex-1 flex items-center justify-center">
        <div className="grid grid-cols-2 gap-2">
          <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </div>
          <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
            <ScanText className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </div>
          <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
            <Languages className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </div>
          <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm font-medium">
            +12
          </div>
        </div>
      </div>
    </div>
  );
}

function QuizPreview() {
  return (
    <div className="h-full p-5 flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-10 h-10 shrink-0 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
          <Languages className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
          Kana Quiz
        </h3>
      </div>

      {/* Large kana character */}
      <div className="flex-1 flex items-center justify-center">
        <span className="text-5xl md:text-6xl font-bold text-emerald-500/30 dark:text-emerald-400/20 group-hover:text-emerald-500/50 dark:group-hover:text-emerald-400/40 transition-colors select-none">
          あ
        </span>
      </div>
    </div>
  );
}

function RecommendationsPreview() {
  return (
    <div className="h-full p-5 pb-10 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-10 h-10 shrink-0 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
          <Sparkles className="w-5 h-5 text-violet-600 dark:text-violet-400" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
          Recs
        </h3>
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400">
        Personalized VN suggestions based on your preferences
      </p>
      <Badge>Beta</Badge>
    </div>
  );
}

function NewsPreview() {
  return (
    <div className="h-full p-5 pb-10 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-10 h-10 shrink-0 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
          <Newspaper className="w-5 h-5 text-rose-600 dark:text-rose-400" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">
          News
        </h3>
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400">
        Latest VN announcements and releases
      </p>
      <Badge>Beta</Badge>
    </div>
  );
}

export function FeatureShowcase() {
  return (
    <FadeIn delay={100}>
      <div className="py-8 md:py-12">
        <div className="container mx-auto px-4 max-w-6xl">
          <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white mb-6">
            More to Explore
          </h2>

          {/* Bento Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 md:grid-rows-2 gap-3 md:gap-4 md:auto-rows-[160px]">
            {/* Stats - Large card spanning 2 cols and 2 rows on desktop */}
            <BentoCard
              href="/stats"
              className="col-span-2 md:row-span-2 min-h-[280px] md:min-h-0"
            >
              <MiniStatsPreview />
            </BentoCard>

            {/* Tools */}
            <BentoCard href="/tools">
              <ToolsPreview />
            </BentoCard>

            {/* Quiz */}
            <BentoCard href="/quiz">
              <QuizPreview />
            </BentoCard>

            {/* Recommendations */}
            <BentoCard href="/recommendations">
              <RecommendationsPreview />
            </BentoCard>

            {/* News */}
            <BentoCard href="/news">
              <NewsPreview />
            </BentoCard>
          </div>
        </div>
      </div>
    </FadeIn>
  );
}
