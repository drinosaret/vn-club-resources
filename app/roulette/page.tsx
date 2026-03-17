import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Dices } from 'lucide-react';
import { VNDBAttribution } from '@/components/VNDBAttribution';
import { DiscordCTA } from '@/components/shared/DiscordCTA';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';
import RoulettePageClient from '@/components/roulette/RoulettePageClient';

export const metadata: Metadata = {
  ...generatePageMetadata({
    title: 'VN Roulette - Spin the Wheel to Pick a Visual Novel',
    description: 'Add visual novels to a roulette wheel and spin to pick your next VN to read. Use group mode to assign VNs to friends for reading challenges and club picks.',
    path: '/roulette/',
  }),
  alternates: {
    canonical: `${SITE_URL}/roulette/`,
    languages: {
      'en': `${SITE_URL}/roulette/`,
      'ja': `${SITE_URL}/ja/roulette/`,
    },
  },
};

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'VN Roulette',
    description: 'Spin a roulette wheel to pick your next visual novel. Add VNs, spin, and let fate decide. Group mode assigns VNs to players for reading challenges.',
    url: `${SITE_URL}/roulette/`,
    applicationCategory: 'EntertainmentApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires JavaScript',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    featureList: [
      'Search and add visual novels to a spinning wheel',
      'Animated roulette wheel with smooth deceleration',
      'Solo mode for personal picks',
      'Group mode to assign VNs to multiple players',
      'Auto-save wheel setup to browser storage',
    ],
    author: {
      '@type': 'Organization',
      name: 'VN Club',
      url: SITE_URL,
    },
    isPartOf: {
      '@type': 'WebSite',
      name: 'VN Club',
      url: SITE_URL,
    },
  },
  generateBreadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'VN Roulette', path: '/roulette/' },
  ]),
];

function LoadingFallback() {
  return (
    <div className="min-h-[80vh] flex flex-col items-center px-4 py-12">
      <div className="max-w-5xl w-full">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-violet-100 dark:bg-violet-900/30 mb-4">
            <Dices className="w-10 h-10 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="h-10 w-56 mx-auto mb-3 rounded image-placeholder" />
          <div className="h-6 w-80 mx-auto rounded image-placeholder" />
        </div>
        <div className="flex justify-center">
          <div className="w-80 h-80 rounded-full image-placeholder" />
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <Suspense fallback={<LoadingFallback />}>
        <RoulettePageClient />
      </Suspense>

      <section className="max-w-2xl mx-auto px-4 py-12 text-sm text-gray-600 dark:text-gray-400">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">How it works</h2>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">Adding visual novels</h3>
        <p className="mb-3">Search for any visual novel by title or VNDB ID and click to add it to the wheel. You can add between 2 and 15 VNs. Each entry gets its own colored segment on the wheel. Remove entries with the trash icon, or clear the entire wheel to start over.</p>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">Spinning the wheel</h3>
        <p className="mb-3">Hit the Spin button and the wheel animates with a satisfying deceleration, landing on a random visual novel. The result card shows the selected VN with a link to its detail page. Spin as many times as you like. Your wheel setup is saved to your browser automatically.</p>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">Group mode</h3>
        <p className="mb-3">Switch to Group mode for reading challenges and VN club picks. Add player names to the queue, then spin. Each round randomly selects a player and assigns them a VN from the wheel. Players are removed from the queue after assignment while VNs stay on the wheel, so everyone gets a pick. The assignment history table tracks all results.</p>
      </section>

      <DiscordCTA
        title="Join our Discord"
        description="Pick your next VN with friends."
        className="mt-6"
      />

      <VNDBAttribution />
    </>
  );
}
