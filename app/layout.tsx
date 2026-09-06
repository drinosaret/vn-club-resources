import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import localFont from "next/font/local";
import { Suspense } from "react";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { NavigationPrefetch } from "@/components/NavigationPrefetch";
import { NavigationProgress } from "@/components/NavigationProgress";
import { Providers } from "@/components/Providers";
import { ScrollToTop } from "@/components/ScrollToTop";
import { ScrollToTopButton } from "@/components/ScrollToTopButton";
import { SITE_URL, safeJsonLdStringify } from "@/lib/metadata-utils";

/**
 * Three faces, all Latin subsets only.
 *
 * Japanese runs on whatever the reader's system provides. A web font covering the script is
 * several megabytes to render the few dozen glyphs a page actually shows, and this site is
 * served from one small machine.
 *
 * Zen Kaku Gothic New is a Japanese family, so its Latin is drawn to sit beside kana rather
 * than to lead a page on its own. That is exactly what a display face on this site should do.
 *
 * Its two Latin slices are checked in rather than requested from Google. The hosted stylesheet
 * for a Japanese family lists its Japanese slices without a subset label, so a subset request
 * still pulls every face into the build and marks most of them for preload; a local face is
 * exactly the files it names. The range is the one Google publishes for the Latin slice, so
 * kana and kanji never look here before the system stack.
 */
const zen = localFont({
  src: [
    { path: './fonts/zen-kaku-gothic-new-500-latin.woff2', weight: '500', style: 'normal' },
    { path: './fonts/zen-kaku-gothic-new-700-latin.woff2', weight: '700', style: 'normal' },
  ],
  // The loader only accepts literals here, so the range cannot be named once and reused.
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
  display: 'swap',
  variable: '--font-zen',
});

const plex = IBM_Plex_Sans({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-plex',
});

/** Every live figure on the site is set in this, so a number never reflows as it updates. */
const plexMono = IBM_Plex_Mono({
  weight: ['400', '500'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-plex-mono',
});


/**
 * Every canonical, Open Graph URL and breadcrumb in the site is a relative path resolved
 * against this origin, so it is pinned to the canonical hostname rather than taken from the
 * request. The site answers on more than one hostname, and a page served on a secondary or
 * preview host must still name the canonical host as its canonical, never itself: otherwise
 * each hostname publishes a self-canonicalising copy of the whole index and they compete.
 */
export const metadata: Metadata = {
  title: {
    default: "VN Club | Japanese Visual Novels, Untranslated",
    template: "%s | VN Club",
  },
  description: "The hub for people who read Japanese visual novels in the original, untranslated form. What is being read this week, where it ranks, what is coming next, and the club reading it.",
  authors: [{ name: "VN Club Resurrection" }],
  metadataBase: new URL(SITE_URL),
  icons: {
    icon: '/assets/hikaru-icon2.webp',
    shortcut: '/favicon.ico',
    apple: '/assets/hikaru-icon2.png',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: '/',
    siteName: 'VN Club',
    title: 'VN Club | Japanese Visual Novels, Untranslated',
    description: 'The site for people serious about Japanese visual novels. Browse the catalogue, follow the club picks, and get set up to read them in the original Japanese.',
    images: [
      {
        url: '/assets/hikaru-icon2.webp',
        width: 512,
        height: 512,
        alt: 'VN Club, a site about Japanese visual novels',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'VN Club | Japanese Visual Novels, Untranslated',
    description: 'For people serious about Japanese visual novels: the whole catalogue, club picks, rankings, and guides for reading them in Japanese.',
    images: ['/assets/hikaru-icon2.webp'],
  },
  robots: {
    index: true,
    follow: true,
  },
};

/**
 * Who publishes the site.
 *
 * A plain organisation rather than an educational one: that type describes schools, and a
 * community around a medium is not one. The subjects lead with the medium, because that is
 * what the site is about, with reading in Japanese as the stance it takes toward it.
 *
 * Addresses are built from the same constant the metadata resolves against, so a request served
 * on another hostname cannot leave the structured data pointing somewhere the canonical does
 * not.
 */
const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'VN Club',
  alternateName: ['VNCR', 'VN Club Resurrection'],
  url: SITE_URL,
  logo: {
    '@type': 'ImageObject',
    url: `${SITE_URL}/assets/hikaru-icon2.webp`,
    width: 512,
    height: 512,
  },
  description: 'A community for people serious about Japanese visual novels, who read them in the original Japanese.',
  sameAs: [
    'https://discord.gg/Ze7dYKVTHf',
    'https://github.com/drinosaret/vn-club-resources',
  ],
  knowsAbout: ['Japanese visual novels', 'Visual novel databases', 'Reading in Japanese', 'Text hooking', 'Immersion reading'],
};

/**
 * The scheme the browser paints scrollbars, native select popups and default form fills in.
 * Bound to the class the theme is carried on, because the meta declaration resolves its choice
 * from the operating system and so can name the opposite of the theme on screen.
 */
const THEME_SCHEME = 'html.light { color-scheme: light; } html.dark { color-scheme: dark; }';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`light ${zen.variable} ${plex.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <meta name="color-scheme" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: THEME_SCHEME }} />
        <link rel="alternate" type="application/rss+xml" title="VN Club - Visual Novel News" href="/feed.xml" />
        {process.env.NEXT_PUBLIC_VNDB_STATS_API && (
          <link rel="preconnect" href={process.env.NEXT_PUBLIC_VNDB_STATS_API} />
        )}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(organizationSchema) }}
        />
        {/* The stored theme, applied before the first paint so a dark-mode reader never sees
            the light page flash. A file rather than inline code: React does not execute a
            script it renders and warns on meeting one, and it still blocks parsing here, so
            the class is set before anything is painted. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts -- it has to block: a deferred
            script applies the theme after the flash it exists to prevent */}
        <script src="/theme-init.js" />
        {/* Loaded on the first sign of a person; see the file. */}
        {process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID && (
          <script
            defer
            src="/analytics-init.js"
            data-src={`${process.env.NEXT_PUBLIC_UMAMI_URL}/script.js`}
            data-website-id={process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID}
          />
        )}
      </head>
      <body
        className="font-sans"
        suppressHydrationWarning
      >
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        <NavigationPrefetch />
        <Providers>
          <ScrollToTop />
          <ScrollToTopButton />
          <ErrorBoundary>
            <div className="flex flex-col min-h-screen overflow-x-clip">
              <Header />
              <main className="grow pt-16 md:pt-[72px]">
                {children}
              </main>
              <Footer />
            </div>
          </ErrorBoundary>
        </Providers>
      </body>
    </html>
  );
}
