import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Grid3X3 } from 'lucide-react';
import GridMakerContent from './GridMakerContent';
import { VNDBAttribution } from '@/components/VNDBAttribution';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

export const metadata: Metadata = {
  ...generatePageMetadata({
    title: 'Visual Novel 3x3 Maker - Create Your VN Collage',
    description: 'Create a 3x3, 4x4, or 5x5 visual novel collage. Import your VNDB list or search for VNs and characters, crop covers, and export a shareable image.',
    path: '/3x3-maker/',
  }),
  alternates: {
    canonical: `${SITE_URL}/3x3-maker/`,
    languages: {
      'en': `${SITE_URL}/3x3-maker/`,
      'ja': `${SITE_URL}/ja/3x3-maker/`,
    },
  },
};

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'Visual Novel 3x3 Maker',
    description: 'Create a 3x3, 4x4, or 5x5 visual novel collage from your VNDB list or manual search. Crop covers and export as a shareable image.',
    url: `${SITE_URL}/3x3-maker/`,
    applicationCategory: 'EntertainmentApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires JavaScript',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    featureList: [
      'VNDB list import',
      '3x3, 4x4, and 5x5 grid sizes',
      'Image cropping and repositioning',
      'Custom titles and scores',
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
    { name: 'VN 3x3 Maker', path: '/3x3-maker/' },
  ]),
];

function LoadingFallback() {
  return (
    <div className="min-h-[80vh] flex flex-col items-center px-4 py-12">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/30 mb-3">
            <Grid3X3 className="w-8 h-8 text-purple-600 dark:text-purple-400" />
          </div>
          <div className="h-10 w-48 mx-auto mb-3 rounded image-placeholder" />
          <div className="h-5 w-80 mx-auto rounded image-placeholder" />
        </div>
        <div className="max-w-md mx-auto mb-6">
          <div className="w-full h-10 rounded-lg image-placeholder" />
        </div>
        <div className="max-w-[420px] mx-auto grid grid-cols-3 gap-1">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] rounded-sm image-placeholder" />
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
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <Suspense fallback={<LoadingFallback />}>
        <GridMakerContent />
      </Suspense>

      <section className="max-w-2xl mx-auto px-4 py-12 text-sm text-gray-600 dark:text-gray-400">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">How it works</h2>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">Adding items</h3>
        <p className="mb-3">Search for visual novels or characters by name or VNDB ID (e.g. &ldquo;v17&rdquo; or &ldquo;17&rdquo;). Click a result to add it to the pool, or enable &ldquo;Add directly to grid&rdquo; in the cogwheel to place items into the next empty cell. You can also click an empty cell first, then search within the modal to target that specific slot. Switch between VN and character mode with the toggle buttons. To bulk-import, enter your VNDB username or user ID and your top 500 highest-scored titles fill the grid automatically.</p>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">Grid size and layout</h3>
        <p className="mb-3">Choose between 3&times;3, 4&times;4, or 5&times;5 grids. Switch between square crop and cover (2:3) aspect ratios. Drag and drop items to rearrange them; dragging swaps the positions of two cells. Items that don&apos;t fit on the grid stay in the pool below, ready to be dragged in whenever you want.</p>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">Cropping and editing</h3>
        <p className="mb-3">Hover over any item and click the pencil icon to open the editor. Use the zoom slider (1x-3x) and drag to reposition the crop area. You can also set a custom title, adjust the vote score (10-100), or pick a different cover image. The preview updates in real time.</p>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">Display settings</h3>
        <p className="mb-3">Open the cogwheel to toggle title overlays, score badges, the decorative frame, and title language (EN/JP). Titles appear at the bottom of each cell and scores show as a badge in the corner. These settings apply to both the on-screen view and the exported image.</p>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">Exporting and sharing</h3>
        <p className="mb-3">Export your grid as JPG, PNG, or WebP, copy it to your clipboard, or share it directly via Twitter, Reddit, or your device&apos;s native share menu. You can also generate a shareable link - anyone who opens it gets a copy they can edit, making it a great way to send friends a template to fill out with their own picks.</p>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">Auto-save</h3>
        <p className="mb-3">Your grid is saved to your browser automatically, including items, crop positions, custom titles, scores, and display settings. Come back anytime and your grid will be right where you left it.</p>


      </section>

      <VNDBAttribution />
    </>
  );
}
