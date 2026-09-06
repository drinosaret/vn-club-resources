import type { Metadata } from 'next';
import Image from 'next/image';
import Link from '@/components/Link';
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
  'Get setup help in minutes, not hours of googling',
  'Join monthly group reads',
  'Share progress and celebrate milestones together',
  'Custom immersion tracking bot, leaderboards, and monthly events',
];

// The banner artwork is an image of text, so each alt repeats the wording the image shows.
// The same string is the alt attribute of the embed snippet other sites paste.
const banners = [
  { src: '/assets/vnclub-banner-200x40.png', alt: 'VN Club: Learn Japanese with VNs' },
  { src: '/assets/vnclub-resurrection-banner-200x40.png', alt: 'VN Club Resurrection' },
];

function bannerSnippet(banner: { src: string; alt: string }) {
  return `<a href="https://vnclub.org/"><img src="https://vnclub.org${banner.src}" alt="${banner.alt}" width="200" height="40"></a>`;
}

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
      <div className="flex w-full min-h-[calc(100vh-4rem)] items-center justify-center py-12 md:min-h-[calc(100vh-72px)] md:py-16">
        <div className="mx-auto max-w-md px-4 text-center">
          <div className="mb-5 inline-flex h-20 w-20 items-center justify-center overflow-hidden rounded-xs border border-[color:var(--rule)]">
            <Image
              src="/assets/servericon.webp"
              alt="VN Club Resurrection"
              width={80}
              height={80}
              className="h-full w-full object-cover"
              unoptimized
            />
          </div>

          <h1 className="sec-title">
            Visual Novel Discord Server
          </h1>

          <p className="nameplate nameplate--plain mt-3 mb-3">
            VN Club Resurrection
          </p>

          <p className="sec-sub">
            A community for reading visual novels in Japanese.
          </p>

          <p className="op-label mt-3">
            1,500+ members reading together
          </p>

          <a
            href="https://discord.gg/Ze7dYKVTHf"
            target="_blank"
            rel="noopener noreferrer"
            className="toy-btn toy-btn--go mt-6"
          >
            <DiscordIcon className="h-4 w-4" />
            Join Server
          </a>

          <div className="mt-4 flex justify-center">
            <Link href="/events/" className="sec-more">
              See upcoming events &amp; group reads
              <span aria-hidden>&rarr;</span>
            </Link>
          </div>

          <ul className="mt-8 space-y-2 border-t border-[color:var(--rule)] pt-8 text-left text-sm text-[color:var(--nezu)]">
            {features.map((feature) => (
              <li key={feature} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-[color:var(--text-faint)]">·</span>
                {feature}
              </li>
            ))}
          </ul>

          <div className="mt-8 border-t border-[color:var(--rule)] pt-6">
            <p className="op-label mb-3">Partner servers</p>
            <div className="flex items-center justify-center gap-4">
              {partners.map((partner) => (
                <a
                  key={partner.name}
                  href={partner.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="op-out"
                >
                  <Image
                    src={partner.icon}
                    alt={partner.name}
                    width={24}
                    height={24}
                    className="h-6 w-6 shrink-0 rounded-xs"
                    unoptimized
                  />
                  {partner.name}
                </a>
              ))}
            </div>
          </div>

          <div className="mt-8 border-t border-[color:var(--rule)] pt-6">
            <p className="mb-3 text-xs text-[color:var(--nezu)]">
              Link to us: add one of these banners to your site
            </p>
            <div className="space-y-5">
              {banners.map((banner) => (
                <div key={banner.src}>
                  <Image
                    src={banner.src}
                    alt={banner.alt}
                    width={200}
                    height={40}
                    className="mx-auto mb-3"
                    unoptimized
                  />
                  <code className="block select-all rounded-xs border border-[color:var(--rule)] bg-[color:var(--surface-inset)] px-3 py-2 text-left font-mono text-[0.6875rem] leading-relaxed break-all text-[color:var(--nezu)]">
                    {bannerSnippet(banner)}
                  </code>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
