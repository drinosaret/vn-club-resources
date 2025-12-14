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
  ArrowRight,
} from 'lucide-react';

interface NavItem {
  title: string;
  slug: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavSection {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  gradient: string;
  items: NavItem[];
}

const mainSections: NavSection[] = [
  {
    title: 'Start Here',
    icon: GraduationCap,
    gradient: 'from-emerald-500 to-teal-600',
    items: [
      { title: 'The Guide', slug: 'guide', description: 'Complete roadmap for learning Japanese with VNs', icon: BookOpen },
    ],
  },
  {
    title: 'Resources',
    icon: FolderOpen,
    gradient: 'from-blue-500 to-indigo-600',
    items: [
      { title: 'Recommendations', slug: 'find', description: 'Databases, trackers, and where to discover VNs', icon: Search },
      { title: 'Where to Get VNs', slug: 'sources', description: 'Digital storefronts and download sources', icon: ShoppingBag },
      { title: 'Tools', slug: 'tools', description: 'Essential software for VN reading', icon: Package },
    ],
  },
  {
    title: 'Community',
    icon: Users,
    gradient: 'from-pink-500 to-rose-600',
    items: [
      { title: 'Join Discord', slug: 'join', description: 'Connect with fellow learners', icon: Users },
    ],
  },
];

const guidesSection: NavSection = {
  title: 'Setup Guides',
  icon: Wrench,
  gradient: 'from-violet-500 to-purple-600',
  items: [
    { title: 'Anki', slug: 'anki-guide', description: 'Spaced repetition for vocabulary', icon: BookMarked },
    { title: 'JL', slug: 'jl-guide', description: 'Popup dictionary for VN readers', icon: Languages },
    { title: 'Textractor', slug: 'textractor-guide', description: 'Text hooking for Windows VNs', icon: Type },
    { title: 'Agent', slug: 'agent-guide', description: 'Script-based hooker for emulators', icon: Cpu },
    { title: 'OwOCR', slug: 'owocr-guide', description: 'OCR for untexthookable games', icon: ScanText },
    { title: 'Meikipop', slug: 'meikipop-guide', description: 'OCR popup dictionary', icon: ScanText },
    { title: 'Magpie', slug: 'magpie-guide', description: 'Window upscaling for older games', icon: Maximize },
    { title: 'ShaderGlass', slug: 'shaderglass-guide', description: 'Real-time shader effects overlay', icon: Palette },
    { title: 'VNTimeTracker', slug: 'timetracker-guide', description: 'Track your reading progress', icon: Timer },
    { title: 'JDownloader', slug: 'jdownloader-guide', description: 'Download manager for file hosts', icon: Download },
    { title: 'Neko Project II', slug: 'np2-guide', description: 'PC-98 emulator for classic VNs', icon: Monitor },
  ],
};

function ItemCard({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Link
      href={`/${item.slug}`}
      className="group relative flex items-start gap-4 p-4 rounded-xl bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-lg hover:shadow-primary-500/10 transition-all duration-200"
    >
      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-md group-hover:scale-110 transition-transform duration-200">
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
      <ArrowRight className="w-5 h-5 text-gray-300 dark:text-gray-600 group-hover:text-primary-500 group-hover:translate-x-1 transition-all duration-200 flex-shrink-0 mt-2" />
    </Link>
  );
}

function SectionHeader({ section }: { section: NavSection }) {
  const Icon = section.icon;
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${section.gradient} flex items-center justify-center shadow-md`}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <h3 className="font-bold text-lg text-gray-900 dark:text-white">
        {section.title}
      </h3>
    </div>
  );
}

export function SiteDirectory() {
  return (
    <section className="py-20 bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-950">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-4">
            Explore the Site
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Everything you need to start reading visual novels in Japanese
          </p>
        </div>

        <div className="grid lg:grid-cols-5 gap-8">
          {/* Left column - 2/5 width */}
          <div className="lg:col-span-2 space-y-8">
            {mainSections.map((section) => (
              <div key={section.title}>
                <SectionHeader section={section} />
                <div className="space-y-3">
                  {section.items.map((item) => (
                    <ItemCard key={item.slug} item={item} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Right column - Guides - 3/5 width */}
          <div className="lg:col-span-3">
            <SectionHeader section={guidesSection} />
            <div className="grid sm:grid-cols-2 gap-3">
              {guidesSection.items.map((item) => (
                <ItemCard key={item.slug} item={item} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
