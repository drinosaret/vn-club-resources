'use client';

import Link from 'next/link';
import {
  GitCompareArrows,
  Languages,
  Dices,
  Wrench,
  Rss,
  Newspaper,
  ChevronRight,
  LayoutGrid,
} from 'lucide-react';
import { FadeIn } from '@/components/FadeIn';

const FEATURES = [
  { href: '/tools', icon: Wrench, title: 'Tools', description: 'Text hookers, dictionaries & utilities', color: 'amber' },
  { href: '/news', icon: Newspaper, title: 'News', description: 'VN industry news & weekly digests', color: 'sky' },
  { href: '/sources', icon: Rss, title: 'Sources', description: 'Where to find VNs to read', color: 'rose' },
  { href: '/random', icon: Dices, title: 'Random', description: 'Filtered random VN picker', color: 'violet' },
  { href: '/stats/compare', icon: GitCompareArrows, title: 'Compare', description: 'Side-by-side VNDB list comparison', color: 'primary' },
  { href: '/quiz', icon: Languages, title: 'Kana Quiz', description: 'Test your hiragana & katakana', color: 'emerald' },
] as const;

const COLOR_CLASSES: Record<string, { bg: string; text: string; hoverText: string }> = {
  amber:   { bg: 'bg-amber-100 dark:bg-amber-900/30',     text: 'text-amber-600 dark:text-amber-400',     hoverText: 'group-hover:text-amber-600 dark:group-hover:text-amber-400' },
  sky:     { bg: 'bg-sky-100 dark:bg-sky-900/30',         text: 'text-sky-600 dark:text-sky-400',         hoverText: 'group-hover:text-sky-600 dark:group-hover:text-sky-400' },
  rose:    { bg: 'bg-rose-100 dark:bg-rose-900/30',       text: 'text-rose-600 dark:text-rose-400',       hoverText: 'group-hover:text-rose-600 dark:group-hover:text-rose-400' },
  violet:  { bg: 'bg-violet-100 dark:bg-violet-900/30',   text: 'text-violet-600 dark:text-violet-400',   hoverText: 'group-hover:text-violet-600 dark:group-hover:text-violet-400' },
  primary: { bg: 'bg-primary-100 dark:bg-primary-900/30', text: 'text-primary-600 dark:text-primary-400', hoverText: 'group-hover:text-primary-600 dark:group-hover:text-primary-400' },
  emerald: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400', hoverText: 'group-hover:text-emerald-600 dark:group-hover:text-emerald-400' },
};

export function FeatureShowcase() {
  return (
    <FadeIn delay={100}>
      <div className="pt-6 md:pt-8 pb-10 md:pb-14 bg-gray-50 dark:bg-gray-900/50">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
              <LayoutGrid className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            </div>
            <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">
              More to Explore
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {FEATURES.map(({ href, icon: Icon, title, description, color }) => {
              const c = COLOR_CLASSES[color];
              return (
                <Link
                  key={href}
                  href={href}
                  className="group flex items-center gap-3.5 px-4 py-3.5 rounded-xl border border-gray-200 dark:border-gray-700/50 hover:bg-white dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                >
                  <div className={`w-9 h-9 min-w-9 min-h-9 shrink-0 rounded-lg ${c.bg} flex items-center justify-center group-hover:scale-110 transition-transform duration-200`}>
                    <Icon className={`w-[18px] h-[18px] ${c.text}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-semibold text-gray-900 dark:text-white ${c.hoverText} transition-colors`}>
                      {title}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {description}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-gray-400 dark:group-hover:text-gray-500 shrink-0 transition-colors" />
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </FadeIn>
  );
}
