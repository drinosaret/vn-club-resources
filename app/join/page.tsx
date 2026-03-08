import type { Metadata } from 'next';
import Image from 'next/image';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

export const metadata: Metadata = generatePageMetadata({
  title: 'Visual Novel Discord Server for Japanese Learners',
  description:
    'Join the VN Club Resurrection Discord, the visual novel community for Japanese learners. Discuss untranslated VNs, get setup help, and join monthly group reads.',
  path: '/join/',
});

const communityJsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Visual Novel Discord Server for Japanese Learners',
    description:
      'Join the VN Club Resurrection visual novel Discord community. Connect with Japanese learners reading VNs in their original language.',
    url: `${SITE_URL}/join/`,
    mainEntity: {
      '@type': 'Organization',
      name: 'VN Club Resurrection - Visual Novel Discord Community',
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
  'Discuss untranslated VNs and Japanese games',
  'Get help with text hookers, dictionaries, and setup',
  'Monthly group reading events',
  'Share and track your reading progress',
  'Custom Discord bot with community tools',
];

const partners = [
  {
    name: 'Learn Japanese through Anime',
    icon: '/assets/partner-ljta.webp',
    url: 'https://discord.gg/fqX7jgz6bt',
  },
  {
    name: 'Room No.49',
    icon: '/assets/partner-room49.webp',
    url: 'https://discord.gg/4t22SGVT3C',
  },
];

export default function JoinPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(communityJsonLd) }}
      />
      <div className="w-full min-h-[calc(100vh-4rem)] md:min-h-[calc(100vh-72px)] flex items-center justify-center py-12 md:py-16">
        <div className="max-w-md mx-auto px-4 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full overflow-hidden mb-5">
            <Image
              src="/assets/servericon.webp"
              alt="VN Club Resurrection"
              width={80}
              height={80}
              className="w-full h-full object-cover"
              unoptimized
            />
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-1">
            Visual Novel Discord Server
          </h1>

          <p className="text-base text-gray-500 dark:text-gray-400 font-medium mb-3">
            VN Club Resurrection
          </p>

          <p className="text-gray-600 dark:text-gray-400 mb-6">
            A community for reading visual novels in Japanese.
          </p>

          <a
            href="https://discord.gg/Ze7dYKVTHf"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 bg-[#5865F2] hover:bg-[#4752C4] text-white px-6 py-3 rounded-lg font-medium transition-colors duration-200"
          >
            <DiscordIcon className="w-5 h-5" />
            Join Server
          </a>

          <ul className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700 text-left text-sm text-gray-600 dark:text-gray-400 space-y-2">
            {features.map((feature) => (
              <li key={feature} className="flex items-start gap-2">
                <span className="text-gray-400 dark:text-gray-500 mt-0.5 shrink-0">·</span>
                {feature}
              </li>
            ))}
          </ul>

          <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">Partner servers</p>
            <div className="flex items-center justify-center gap-4">
              {partners.map((partner) => (
                <a
                  key={partner.name}
                  href={partner.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors duration-200"
                >
                  <Image
                    src={partner.icon}
                    alt={partner.name}
                    width={24}
                    height={24}
                    className="w-6 h-6 rounded-md shrink-0"
                    unoptimized
                  />
                  {partner.name}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
