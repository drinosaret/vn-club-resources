'use client';

import Link from 'next/link';
import {
  BookOpen,
  FolderOpen,
  Wrench,
  Users,
  GraduationCap,
  Search,
  ShoppingBag,
  Package,
  BookMarked,
  Languages,
  Type,
  Cpu,
  ScanText,
  Maximize,
  Palette,
  Timer,
  Download,
  Monitor,
  Smartphone,
  ArrowRight,
  ExternalLink,
  LucideIcon,
} from 'lucide-react';
import { getSiteDirectorySections, NavItem } from '@/lib/navigation';

// Icon mappings by slug - presentational only
const iconMap: Record<string, LucideIcon> = {
  'guide': BookOpen,
  'find': Search,
  'sources': ShoppingBag,
  'tools': Package,
  'join': Users,
  'anki-guide': BookMarked,
  'jl-guide': Languages,
  'textractor-guide': Type,
  'agent-guide': Cpu,
  'owocr-guide': ScanText,
  'meikipop-guide': ScanText,
  'magpie-guide': Maximize,
  'shaderglass-guide': Palette,
  'timetracker-guide': Timer,
  'jdownloader-guide': Download,
  'bottles-guide': Monitor,
  'np2-guide': Monitor,
  'kirikiriroid-guide': Smartphone,
  'gamehub-lite-guide': Smartphone,
};

const sectionConfig: Record<string, { icon: LucideIcon; gradient: string }> = {
  'Start Here': { icon: GraduationCap, gradient: 'from-emerald-500 to-teal-600' },
  'Resources': { icon: FolderOpen, gradient: 'from-blue-500 to-indigo-600' },
  'Community': { icon: Users, gradient: 'from-pink-500 to-rose-600' },
  'Setup Guides': { icon: Wrench, gradient: 'from-violet-500 to-purple-600' },
};

// Get navigation data from single source of truth
const { mainSections: mainSectionsData, guides: guidesData } = getSiteDirectorySections();

function ItemCard({ item, compact = false }: { item: NavItem; compact?: boolean }) {
  const Icon = iconMap[item.slug] ?? Package;
  const href = item.href ?? `/${item.slug}`;
  const isExternal = item.external;
  const EndIcon = isExternal ? ExternalLink : ArrowRight;

  const content = compact ? (
    <div className="flex flex-col items-center justify-center text-center w-full">
      <div className="w-10 h-10 rounded-lg bg-linear-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-md group-hover:scale-110 transition-transform duration-200 mb-2">
        <Icon className="w-5 h-5 text-white" />
      </div>
      <h4 className="font-medium text-sm text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
        {item.title}
      </h4>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
        {item.description}
      </p>
    </div>
  ) : (
    <>
      <div className="shrink-0 w-10 h-10 rounded-lg bg-linear-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-md group-hover:scale-110 transition-transform duration-200">
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
          {item.title}
        </h4>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          {item.description}
        </p>
      </div>
      <EndIcon className="w-5 h-5 text-gray-300 dark:text-gray-600 group-hover:text-primary-500 group-hover:translate-x-1 transition-[color,transform] duration-200 shrink-0 mt-2" />
    </>
  );

  const className = compact
    ? "group relative flex items-center justify-center p-4 h-full rounded-xl bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-lg hover:shadow-primary-500/10 transition-[border-color,box-shadow] duration-200"
    : "group relative flex items-start gap-4 p-4 rounded-xl bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-lg hover:shadow-primary-500/10 transition-[border-color,box-shadow] duration-200";

  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {content}
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}

function SectionHeader({ title, gradient }: { title: string; gradient: string }) {
  const config = sectionConfig[title];
  const Icon = config?.icon ?? Wrench;
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className={`w-8 h-8 rounded-lg bg-linear-to-br ${gradient} flex items-center justify-center shadow-md`}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <h3 className="font-bold text-lg text-gray-900 dark:text-white">
        {title}
      </h3>
    </div>
  );
}

export function SiteDirectory() {
  return (
    <section className="py-12 md:py-20 bg-linear-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-950">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="text-center mb-8 md:mb-12">
          <h2 className="text-2xl md:text-4xl font-bold text-gray-900 dark:text-white mb-3 md:mb-4">
            Explore the Site
          </h2>
          <p className="text-base md:text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Everything you need to start reading visual novels in Japanese
          </p>
        </div>

        <div className="grid lg:grid-cols-5 gap-6 md:gap-8 items-stretch">
          {/* Left column - 2/5 width */}
          <div className="lg:col-span-2 flex flex-col space-y-6 md:space-y-8">
            {mainSectionsData.map((section) => (
              <div key={section.key}>
                <SectionHeader title={section.title} gradient={sectionConfig[section.title]?.gradient ?? 'from-gray-500 to-gray-600'} />
                <div className="space-y-3">
                  {section.items.map((item) => (
                    <ItemCard key={item.slug} item={item} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Right column - Guides - 3/5 width */}
          <div className="lg:col-span-3 flex flex-col">
            <SectionHeader title="Setup Guides" gradient={sectionConfig['Setup Guides']?.gradient ?? 'from-violet-500 to-purple-600'} />
            <div className="flex-1 grid sm:grid-cols-2 lg:grid-cols-3 gap-3 auto-rows-fr">
              {guidesData.map((item) => (
                <ItemCard key={item.slug} item={item} compact />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
