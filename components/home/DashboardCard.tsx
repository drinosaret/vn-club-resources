'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';

type GradientTheme = 'stats' | 'news' | 'quiz' | 'recommendations';

interface DashboardCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
  preview?: React.ReactNode;
  gradient?: GradientTheme;
  ctaText?: string;
  badge?: string;
}

const gradientClasses: Record<GradientTheme, { bg: string; border: string; icon: string }> = {
  stats: {
    bg: 'from-primary-50 to-primary-100/50 dark:from-primary-900/20 dark:to-primary-800/10',
    border: 'hover:border-primary-300 dark:hover:border-primary-700',
    icon: 'bg-primary-100 dark:bg-primary-900/50 text-primary-600 dark:text-primary-400',
  },
  recommendations: {
    bg: 'from-violet-50 to-violet-100/50 dark:from-violet-900/20 dark:to-violet-800/10',
    border: 'hover:border-violet-300 dark:hover:border-violet-700',
    icon: 'bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400',
  },
  news: {
    bg: 'from-rose-50 to-rose-100/50 dark:from-rose-900/20 dark:to-rose-800/10',
    border: 'hover:border-rose-300 dark:hover:border-rose-700',
    icon: 'bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400',
  },
  quiz: {
    bg: 'from-emerald-50 to-emerald-100/50 dark:from-emerald-900/20 dark:to-emerald-800/10',
    border: 'hover:border-emerald-300 dark:hover:border-emerald-700',
    icon: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400',
  },
};

export function DashboardCard({
  icon,
  title,
  description,
  href,
  preview,
  gradient = 'stats',
  ctaText = 'Explore',
  badge,
}: DashboardCardProps) {
  const router = useRouter();
  const theme = gradientClasses[gradient];

  const handleClick = () => {
    router.push(href);
  };

  return (
    <div
      onClick={handleClick}
      className={`
        group block bg-linear-to-br ${theme.bg}
        rounded-2xl border border-gray-200 dark:border-gray-700 ${theme.border}
        p-4 md:p-6 min-h-[280px] md:min-h-[320px] flex flex-col cursor-pointer
        hover:shadow-xl transition-all duration-300
      `}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3 md:mb-4">
        <div className={`w-10 h-10 rounded-xl ${theme.icon} flex items-center justify-center shrink-0`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-0.5 flex items-center gap-2 flex-wrap">
            <span className="truncate">{title}</span>
            {badge && (
              <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded-sm bg-white/60 dark:bg-white/10 text-gray-500 dark:text-gray-400 shrink-0">
                {badge}
              </span>
            )}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
            {description}
          </p>
        </div>
      </div>

      {/* Preview Area */}
      <div className="flex-1 mb-3 md:mb-4">
        {preview}
      </div>

      {/* CTA */}
      <div className="flex items-center justify-between pt-3 md:pt-4 border-t border-gray-200 dark:border-gray-700/50">
        <span className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
          {ctaText}
        </span>
        <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-primary-600 dark:group-hover:text-primary-400 group-hover:translate-x-1 transition-all" />
      </div>
    </div>
  );
}
