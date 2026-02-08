import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

interface AnnouncementBannerProps {
  badge?: string;
  title: string;
  description: string;
  href: string;
  icon?: React.ReactNode;
}

export function AnnouncementBanner({
  badge,
  title,
  description,
  href,
  icon,
}: AnnouncementBannerProps) {
  return (
    <section className="py-6 px-4">
      <div className="container mx-auto max-w-6xl">
        <Link
          href={href}
          className="group block relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50 dark:from-primary-900/20 dark:via-blue-900/20 dark:to-indigo-900/20 border border-primary-200 dark:border-primary-700/50 p-6 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300"
        >
          <div className="flex items-center gap-4">
            {icon && (
              <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary-800/50 flex items-center justify-center text-primary-600 dark:text-primary-400">
                {icon}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {badge && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-primary-500 text-white">
                    {badge}
                  </span>
                )}
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                  {title}
                </h3>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-1">
                {description}
              </p>
            </div>
            <div className="flex-shrink-0">
              <ArrowRight className="w-5 h-5 text-primary-600 dark:text-primary-400 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>
        </Link>
      </div>
    </section>
  );
}
