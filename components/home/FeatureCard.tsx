import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
}

export function FeatureCard({ icon, title, description, href }: FeatureCardProps) {
  return (
    <Link href={href} className="group block h-full">
      <div className="h-full bg-white dark:bg-gray-800 rounded-2xl p-4 md:p-6 border border-gray-100 dark:border-gray-700 shadow-xs hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
        <div className="w-12 h-12 md:w-14 md:h-14 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center mb-3 md:mb-5 group-hover:scale-110 transition-transform duration-300">
          <div className="text-primary-600 dark:text-primary-400">
            {icon}
          </div>
        </div>
        <h3 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white mb-1.5 md:mb-2 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
          {title}
        </h3>
        <p className="text-sm md:text-base text-gray-600 dark:text-gray-400 mb-3 md:mb-4 leading-relaxed">
          {description}
        </p>
        <div className="flex items-center text-primary-600 dark:text-primary-400 font-medium text-sm">
          <span>Learn more</span>
          <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </Link>
  );
}
