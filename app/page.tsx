import Link from 'next/link';
import { BookOpen, Users, Newspaper, Wrench } from 'lucide-react';
import { SiteDirectory } from '@/components/SiteDirectory';

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  );
}
import type { Metadata } from 'next';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  alternates: {
    canonical: 'https://vnclub.org',
  },
};

// WebSite JSON-LD schema with SearchAction
const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Visual Novel Club Resources',
  url: 'https://vnclub.org',
  description: 'Learn Japanese with visual novels using our comprehensive guides, tools, and resources.',
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: 'https://vnclub.org/guides?search={search_term_string}',
    },
    'query-input': 'required name=search_term_string',
  },
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
      />
      <div className="w-full">
        {/* Hero Section */}
      <section className="bg-gradient-to-br from-primary-600 to-primary-800 text-white py-20">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="text-center">
            <h1 className="text-3xl md:text-4xl font-bold mb-6">
              Welcome to the Club
            </h1>
            <div className="mb-8 select-none">
              <span
                className="text-7xl md:text-8xl lg:text-9xl font-black tracking-wider
                  bg-gradient-to-br from-white via-primary-200 to-white bg-clip-text text-transparent"
              >
                魑魅魍魎
              </span>
            </div>
            <p className="text-lg mb-10 max-w-3xl mx-auto text-primary-50">
              This site is a curated hub for learning Japanese through visual novels, eroge, and other video games. 
              Whether you’re new to the medium or already deep into immersion, you’ll find everything you need to get started.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link 
                href="/guide" 
                className="bg-white text-primary-700 px-8 py-3 rounded-lg font-semibold hover:bg-primary-50 transition-colors"
              >
                Get Started
              </Link>
              <Link 
                href="/join" 
                className="bg-primary-500 text-white px-8 py-3 rounded-lg font-semibold hover:bg-primary-400 transition-colors border-2 border-white"
              >
                Join Community
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 bg-gray-50 dark:bg-gray-900">
        <div className="container mx-auto px-4 max-w-6xl">
          <h2 className="text-3xl font-bold text-center mb-12 text-gray-900 dark:text-white">
            Everything You Need
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            <FeatureCard
              icon={<BookOpen className="w-12 h-12 text-primary-600" />}
              title="Comprehensive Guides"
              description="Step-by-step tutorials for setting up tools and getting started with Japanese VNs"
              href="/guide"
            />
            <FeatureCard
              icon={<Wrench className="w-12 h-12 text-primary-600" />}
              title="Essential Tools"
              description="Curated collection of tools for text hooking, OCR, dictionaries, and more"
              href="/tools"
            />
            <FeatureCard
              icon={<Newspaper className="w-12 h-12 text-primary-600" />}
              title="Resources"
              description="Discover new VNs, find recommendations, and learn where to get them"
              href="/find"
            />
            <FeatureCard
              icon={<Users className="w-12 h-12 text-primary-600" />}
              title="Active Community"
              description="Connect with fellow learners, get help, and share your progress"
              href="/join"
            />
          </div>
        </div>
      </section>

      {/* Site Directory */}
      <SiteDirectory />

      {/* Community CTA */}
      <section className="bg-primary-600 text-white py-16">
        <div className="container mx-auto px-4 max-w-4xl text-center">
          <h2 className="text-3xl font-bold mb-4">
            Get Involved
          </h2>
          <p className="text-xl mb-8 text-primary-100">
            This is an open wiki maintained by the community. Join us on Discord or help improve the site on GitHub.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/join"
              className="inline-flex items-center justify-center gap-2 bg-white text-primary-700 px-8 py-3 rounded-lg font-semibold hover:bg-primary-50 transition-colors"
            >
              <Users className="w-5 h-5" />
              Join Discord
            </Link>
            <a
              href="https://github.com/drinosaret/vn-club-resources"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 bg-primary-500 text-white px-8 py-3 rounded-lg font-semibold hover:bg-primary-400 transition-colors border-2 border-white"
            >
              <GitHubIcon className="w-5 h-5" />
              Contribute on GitHub
            </a>
          </div>
          <blockquote className="mt-12 text-lg italic text-primary-200">
            &quot;Read more.&quot; – Everyone who made it
          </blockquote>
        </div>
      </section>
      </div>
    </>
  );
}

function FeatureCard({ icon, title, description, href }: { 
  icon: React.ReactNode; 
  title: string; 
  description: string;
  href: string;
}) {
  return (
    <Link href={href} className="block group">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md hover:shadow-xl transition-shadow h-full">
        <div className="mb-4">{icon}</div>
        <h3 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white group-hover:text-primary-600 transition-colors">
          {title}
        </h3>
        <p className="text-gray-600 dark:text-gray-400">
          {description}
        </p>
      </div>
    </Link>
  );
}
