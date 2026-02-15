import Link from 'next/link';
import { Users } from 'lucide-react';
import { HeroSection } from '@/components/home/HeroSection';
import { FeaturedVNs } from '@/components/home/FeaturedVNs';
import { ExploreSection } from '@/components/home/ExploreSection';
import { getGuidesWithImages } from '@/lib/navigation-server';
import { getFeaturedVNsData } from '@/lib/featured-vns';
import type { Metadata } from 'next';
import { safeJsonLdStringify } from '@/lib/metadata-utils';

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  );
}

export const revalidate = 60;

export const metadata: Metadata = {
  alternates: {
    canonical: 'https://vnclub.org',
  },
};

// WebSite JSON-LD schema with SearchAction
const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'VN Club',
  alternateName: ['Visual Novel Club Resources', 'VNClub'],
  url: 'https://vnclub.org',
  description: 'Learn Japanese with visual novels. The definitive resource for immersion-based Japanese learning through VNs. Guides, tools, and VNDB integration to find your next read.',
  inLanguage: 'en',
  about: {
    '@type': 'Thing',
    name: 'Learning Japanese through Visual Novels',
  },
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: 'https://vnclub.org/guides?search={search_term_string}',
    },
    'query-input': 'required name=search_term_string',
  },
};

export default async function Home() {
  // Get guides with images for the visual showcase
  const guides = getGuidesWithImages();
  // Fetch featured VNs server-side with ISR caching
  const featuredVNs = await getFeaturedVNsData();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(websiteSchema) }}
      />
      <div className="w-full">
        {/* 1. Hero Section with Stats Banner */}
        <HeroSection />

        {/* 2. Featured VNs Section */}
        <FeaturedVNs vns={featuredVNs} />

        {/* 3. Explore Section - Site Directory */}
        <ExploreSection guides={guides} />

        {/* 5. Community CTA */}
        <section className="bg-gradient-to-br from-primary-600 to-primary-700 text-white py-12 md:py-20">
          <div className="container mx-auto px-4 max-w-4xl text-center">
            <h2 className="text-2xl md:text-4xl font-bold mb-3 md:mb-4">
              Get Involved
            </h2>
            <p className="text-lg md:text-xl mb-8 md:mb-10 text-primary-100 max-w-2xl mx-auto">
              This is an open wiki maintained by the community. Join us on Discord or help improve the site on GitHub.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/join"
                className="inline-flex items-center justify-center gap-2 bg-white text-primary-700 px-8 py-4 rounded-xl font-semibold hover:bg-primary-50 hover:shadow-lg transition-[background-color,box-shadow] duration-200"
              >
                <Users className="w-5 h-5" />
                Join Discord
              </Link>
              <a
                href="https://github.com/drinosaret/vn-club-resources"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 bg-primary-500/30 text-white px-8 py-4 rounded-xl font-semibold hover:bg-primary-500/50 transition-[background-color,border-color] duration-200 border-2 border-white/30 hover:border-white/50"
              >
                <GitHubIcon className="w-5 h-5" />
                Contribute on GitHub
              </a>
            </div>
            <blockquote className="mt-8 md:mt-12 text-base md:text-lg italic text-primary-200">
              &quot;Read more.&quot; – Everyone who made it
            </blockquote>
          </div>
        </section>
      </div>
    </>
  );
}
