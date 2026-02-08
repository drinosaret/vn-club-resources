'use client';

import Link from 'next/link';
import {
  BarChart3,
  Sparkles,
  Newspaper,
  Languages,
  ArrowRight,
} from 'lucide-react';
import { FadeIn } from '@/components/FadeIn';

interface QuickLinkCardProps {
  href: string;
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description: string;
  badge?: string;
  badgeColor?: string;
}

function QuickLinkCard({
  href,
  icon,
  iconBg,
  title,
  description,
  badge,
  badgeColor = 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300',
}: QuickLinkCardProps) {
  return (
    <Link
      href={href}
      className="group flex flex-col p-5 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`p-3 rounded-xl ${iconBg}`}>
          {icon}
        </div>
        {badge && (
          <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full ${badgeColor}`}>
            {badge}
          </span>
        )}
      </div>

      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
        {title}
      </h3>
      <p className="text-sm text-gray-600 dark:text-gray-400 flex-1">
        {description}
      </p>

      <div className="flex items-center gap-1 mt-4 text-sm font-medium text-primary-600 dark:text-primary-400">
        Learn more
        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
      </div>
    </Link>
  );
}

export function BentoGrid() {
  return (
    <section className="py-10 md:py-16 bg-gray-50 dark:bg-gray-900/50">
      <div className="container mx-auto px-4 max-w-4xl">
        {/* Section Header */}
        <FadeIn>
          <div className="text-center mb-8">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-2">
              Quick Links
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Tools and resources for your journey
            </p>
          </div>
        </FadeIn>

        {/* Uniform 2x2 Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FadeIn delay={50}>
            <QuickLinkCard
              href="/stats"
              icon={<BarChart3 className="w-6 h-6 text-primary-600 dark:text-primary-400" />}
              iconBg="bg-primary-100 dark:bg-primary-900/50"
              title="VNDB Stats"
              description="Analyze your reading history with detailed charts and insights."
              badge="Beta"
            />
          </FadeIn>

          <FadeIn delay={100}>
            <QuickLinkCard
              href="/recommendations"
              icon={<Sparkles className="w-6 h-6 text-violet-600 dark:text-violet-400" />}
              iconBg="bg-violet-100 dark:bg-violet-900/50"
              title="VN Recommendations"
              description="Get personalized suggestions based on your reading preferences."
              badge="Beta"
              badgeColor="bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300"
            />
          </FadeIn>

          <FadeIn delay={150}>
            <QuickLinkCard
              href="/quiz"
              icon={<Languages className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />}
              iconBg="bg-emerald-100 dark:bg-emerald-900/50"
              title="Kana Quiz"
              description="Practice hiragana and katakana with our interactive quiz."
            />
          </FadeIn>

          <FadeIn delay={200}>
            <QuickLinkCard
              href="/news"
              icon={<Newspaper className="w-6 h-6 text-rose-600 dark:text-rose-400" />}
              iconBg="bg-rose-100 dark:bg-rose-900/50"
              title="VN News"
              description="Stay updated with the latest visual novel releases and announcements."
              badge="Beta"
              badgeColor="bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300"
            />
          </FadeIn>
        </div>
      </div>
    </section>
  );
}
