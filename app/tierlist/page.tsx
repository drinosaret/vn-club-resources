import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Rows3 } from 'lucide-react';
import TierListContent from './TierListContent';
import { VNDBAttribution } from '@/components/VNDBAttribution';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

export const metadata: Metadata = {
  ...generatePageMetadata({
    title: 'Visual Novel Tier List Maker - Rank Your VNs',
    description: 'Create a visual novel tier list from your VNDB ratings. Drag and drop to rank your VNs, customize tier labels and colors, and export as a shareable image.',
    path: '/tierlist/',
  }),
  alternates: {
    canonical: `${SITE_URL}/tierlist/`,
    languages: {
      'en': `${SITE_URL}/tierlist/`,
      'ja': `${SITE_URL}/ja/tierlist/`,
    },
  },
};

const tierListJsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'Visual Novel Tier List Maker',
    description: 'Create a visual novel tier list from your VNDB ratings. Drag and drop to rank, customize tiers, and export as a shareable image.',
    url: `${SITE_URL}/tierlist/`,
    applicationCategory: 'EntertainmentApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires JavaScript',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    featureList: [
      'VNDB list import with auto-sort into tiers',
      'Customizable tier labels and colors',
      'Drag and drop ranking',
      'Cover images and text-only display modes',
      'Small, medium, and large thumbnail sizes',
      'Multiple presets (S-F, 1-5, 1-10, 10-100)',
      'JPG, PNG, and WebP export',
      'Shareable links',
      'Dark and light themes',
      'VN and character modes',
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
    { name: 'VN Tier List Maker', path: '/tierlist/' },
  ]),
];

function LoadingFallback() {
  return (
    <div className="min-h-[80vh] flex flex-col items-center px-4 py-12">
      <div className="max-w-5xl w-full">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-amber-100 dark:bg-amber-900/30 mb-4">
            <Rows3 className="w-10 h-10 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="h-10 w-64 mx-auto mb-3 rounded image-placeholder" />
          <div className="h-6 w-96 mx-auto rounded image-placeholder" />
        </div>
        <div className="relative max-w-lg mx-auto mb-8">
          <div className="w-full h-14 rounded-xl image-placeholder" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-2xl mx-auto">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-5 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700">
              <div className="w-10 h-10 rounded-lg mb-3 image-placeholder" />
              <div className="w-24 h-5 rounded-sm mb-2 image-placeholder" />
              <div className="w-full h-4 rounded-sm mb-1 image-placeholder" />
              <div className="w-3/4 h-4 rounded-sm image-placeholder" />
            </div>
          ))}
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
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(tierListJsonLd) }}
      />
      <Suspense fallback={<LoadingFallback />}>
        <TierListContent />
      </Suspense>

      <section className="max-w-2xl mx-auto px-4 py-12 text-sm text-gray-600 dark:text-gray-400">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">How it works</h2>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">Adding items</h3>
        <p className="mb-3">Search for visual novels or characters by name or VNDB ID (e.g. &ldquo;v17&rdquo; or &ldquo;17&rdquo;). Click a result to add it to the unranked pool (or enable &ldquo;Add directly to last tier&rdquo; in the cogwheel to skip the pool). Switch between VN and character mode with the toggle buttons. To bulk-import, enter your VNDB username or user ID and your rated VNs are automatically distributed across tiers based on their scores. The tier list supports up to 500 items.</p>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">Organizing your tiers</h3>
        <p className="mb-3">Drag an item onto a tier to place it there, or drop it on a specific item to insert before it. Dropping on empty space puts it at the end. Click a tier label to rename it (up to 40 characters), change its color, delete the tier, or add new tiers above or below. Four presets are available (S-F, 1-5, 1-10, and 10-100), and switching presets redistributes your items automatically.</p>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">Editing scores and titles</h3>
        <p className="mb-3">Hover over any item and click the pencil icon to open the edit modal. Set a custom title to override the default, or adjust the vote score (10-100). Use the cogwheel to toggle score badges and title overlays on cover images. The EN/JP toggle switches between English/romaji and Japanese titles across the entire list.</p>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">Display modes</h3>
        <p className="mb-3">Switch between cover image mode and title-only text mode using the toolbar buttons. In cover mode, choose between small, medium, and large thumbnail sizes, and optionally overlay titles and scores. Text mode shows compact labels for a denser view when you have many items.</p>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">Exporting and sharing</h3>
        <p className="mb-3">Export your tier list as JPG, PNG, or WebP, copy it to your clipboard, or share directly via Twitter, Reddit, or your device&apos;s native share menu. You can also generate a shareable link - anyone who opens it gets a copy they can rearrange, making it perfect for sending friends a template to rank the same set of VNs. Set a title using the text field above the tiers and it appears as a header in the export.</p>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">Auto-save</h3>
        <p className="mb-3">Everything is saved to your browser automatically: tier layouts, item assignments, custom titles, scores, and display settings. If you imported from VNDB, the URL updates so you can bookmark or share it directly.</p>

      </section>

      <VNDBAttribution />
    </>
  );
}
