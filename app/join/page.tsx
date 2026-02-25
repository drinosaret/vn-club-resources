import type { Metadata } from 'next';
import Image from 'next/image';
import {
  BookOpen,
  MessageCircle,
  Wrench,
  TrendingUp,
  Bot,
  CalendarDays,
} from 'lucide-react';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

export const metadata: Metadata = generatePageMetadata({
  title: 'Join the VN Club Resurrection Discord',
  description:
    'Join the VN Club Resurrection Discord. Connect with Japanese learners reading VNs, get setup help, share progress, and discover new visual novels.',
  path: '/join/',
});

const communityJsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Join VN Club Resurrection Discord',
    description:
      'Join the Visual Novel Club Resurrection Discord community. Connect with other Japanese learners reading VNs.',
    url: `${SITE_URL}/join/`,
    mainEntity: {
      '@type': 'Organization',
      name: 'VN Club Resurrection',
      url: 'https://discord.gg/Ze7dYKVTHf',
      sameAs: ['https://discord.gg/Ze7dYKVTHf'],
    },
  },
  generateBreadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Join Discord', path: '/join/' },
  ]),
];

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

const features = [
  {
    icon: BookOpen,
    title: 'Discuss VNs & Games',
    description:
      'Talk about untranslated VNs and games you\'re reading, or get recommendations for your next read.',
  },
  {
    icon: MessageCircle,
    title: 'Ask Questions',
    description:
      'Get answers about Japanese learning, reading strategies, and anything VN-related.',
  },
  {
    icon: Wrench,
    title: 'Get Technical Help',
    description:
      'Troubleshoot text hookers, dictionary tools, and other setup issues with experienced readers.',
  },
  {
    icon: TrendingUp,
    title: 'Share Your Progress',
    description:
      'Celebrate milestones and track your reading journey with our progress logging bot.',
  },
  {
    icon: Bot,
    title: 'Custom Bot Features',
    description:
      'Use our custom Discord bot for various community features and tools.',
  },
  {
    icon: CalendarDays,
    title: 'Monthly Group Reads',
    description:
      'Join VN of the month group reading events for shared reading experiences.',
  },
];

export default function JoinPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(communityJsonLd) }}
      />
      <div className="w-full">
        {/* Hero Section */}
        <section className="relative overflow-hidden bg-linear-to-br from-primary-600 via-primary-700 to-primary-800 text-white">
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute -top-1/2 -right-1/4 w-96 h-96 bg-primary-500/20 rounded-full blur-3xl" />
            <div className="absolute -bottom-1/2 -left-1/4 w-96 h-96 bg-primary-400/10 rounded-full blur-3xl" />
          </div>

          <div className="relative container mx-auto px-4 py-16 md:py-24 max-w-4xl text-center">
            <div className="inline-flex items-center justify-center w-24 h-24 md:w-32 md:h-32 rounded-full bg-white/15 backdrop-blur-xs mb-6 overflow-hidden">
              <Image
                src="/assets/servericon.webp"
                alt="VN Club Resurrection"
                width={128}
                height={128}
                className="w-full h-full object-cover"
                unoptimized
              />
            </div>

            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4 tracking-tight">
              VN Club Resurrection
            </h1>

            <p className="text-lg md:text-xl mb-8 text-primary-100 max-w-2xl mx-auto leading-relaxed">
              A server for Japanese learners passionate about reading visual novels in their original, untranslated form.
            </p>

            <a
              href="https://discord.gg/Ze7dYKVTHf"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 bg-white text-primary-700 px-8 py-4 rounded-xl font-semibold text-lg hover:bg-primary-50 hover:shadow-lg transition-all duration-200"
            >
              <DiscordIcon className="w-5 h-5" />
              Join Discord Server
            </a>
          </div>
        </section>

        {/* Feature Cards */}
        <section className="py-12 md:py-20 bg-gray-50 dark:bg-gray-900/50">
          <div className="container mx-auto px-4 max-w-6xl">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white text-center mb-10">
              What we do
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-100 dark:border-gray-700 shadow-xs hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
                >
                  <div className="w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center mb-4">
                    <feature.icon className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="bg-linear-to-br from-primary-600 to-primary-700 text-white py-12 md:py-16">
          <div className="container mx-auto px-4 max-w-3xl text-center">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">
              All levels welcome
            </h2>
            <p className="text-lg text-primary-100 mb-8 max-w-xl mx-auto">
              Whether you&apos;re just starting out or already reading untranslated VNs on your own.
            </p>
            <a
              href="https://discord.gg/Ze7dYKVTHf"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 bg-white text-primary-700 px-8 py-4 rounded-xl font-semibold text-lg hover:bg-primary-50 hover:shadow-lg transition-all duration-200"
            >
              <DiscordIcon className="w-5 h-5" />
              Join Discord Server
            </a>
          </div>
        </section>

        {/* Partner Servers */}
        <section className="py-12 md:py-16">
          <div className="container mx-auto px-4 max-w-4xl text-center">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-8">
              Partner Servers
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6 max-w-2xl mx-auto">
              <a
                href="https://discord.gg/fqX7jgz6bt"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-100 dark:border-gray-700 shadow-xs hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
              >
                <Image
                  src="/assets/partner-ljta.webp"
                  alt="Learn Japanese through Anime"
                  width={48}
                  height={48}
                  className="w-12 h-12 rounded-xl shrink-0"
                  unoptimized
                />
                <div className="text-left">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Learn Japanese through Anime</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Anime partner server</p>
                </div>
              </a>
              <a
                href="https://discord.gg/4t22SGVT3C"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-100 dark:border-gray-700 shadow-xs hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
              >
                <Image
                  src="/assets/partner-room49.webp"
                  alt="Room No.49"
                  width={48}
                  height={48}
                  className="w-12 h-12 rounded-xl shrink-0"
                  unoptimized
                />
                <div className="text-left">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Room No.49</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Dark VN partner server</p>
                </div>
              </a>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
