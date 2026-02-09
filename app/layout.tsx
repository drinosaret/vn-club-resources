import type { Metadata } from "next";
import { headers } from "next/headers";
import { Roboto } from "next/font/google";
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
import { safeJsonLdStringify } from "@/lib/metadata-utils";

const roboto = Roboto({
  weight: ['400', '500', '700'],
  subsets: ["latin"],
  display: 'swap',
});

const ALLOWED_HOSTS = new Set(['vnclub.org', 'www.vnclub.org', 'beta.vnclub.org']);
const DEFAULT_ORIGIN = 'https://vnclub.org';

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers();
  const host = headersList.get('host')?.split(':')[0] || '';
  const origin = ALLOWED_HOSTS.has(host) ? `https://${host}` : DEFAULT_ORIGIN;

  return {
    title: {
      default: "VN Club | Learn Japanese with Visual Novels",
      template: "%s | VN Club",
    },
    description: "Learn Japanese with visual novels. Comprehensive guides for text hooking, dictionary setup, Anki mining, and immersion-based reading. Browse VNDB, get personalized recommendations, and find VNs for your level.",
    keywords: ["learn japanese with visual novels", "visual novel japanese learning", "japanese learning resources", "vn club", "visual novels", "text hooking", "Anki", "immersion", "beginner visual novels japanese", "japanese through visual novels"],
    authors: [{ name: "VN Club Resurrection" }],
    metadataBase: new URL(origin),
    icons: {
      icon: '/assets/hikaru-icon2.webp',
      shortcut: '/favicon.ico',
      apple: '/assets/hikaru-icon2.webp',
    },
    openGraph: {
      type: 'website',
      locale: 'en_US',
      url: '/',
      siteName: 'VN Club',
      title: 'VN Club | Learn Japanese with Visual Novels',
      description: 'Learn Japanese with visual novels. Comprehensive guides for text hooking, dictionary setup, Anki mining, and immersion-based reading. Browse VNDB, get recommendations, and find VNs for your level.',
      images: [
        {
          url: '/assets/hikaru-icon2.webp',
          width: 512,
          height: 512,
          alt: 'VN Club - Learn Japanese with Visual Novels',
        },
      ],
    },
    twitter: {
      card: 'summary',
      title: 'VN Club | Learn Japanese with Visual Novels',
      description: 'Learn Japanese with visual novels. Guides, tools, and VNDB integration to find VNs for every level.',
      images: ['/assets/hikaru-icon2.webp'],
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

// Organization JSON-LD schema
const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'EducationalOrganization',
  name: 'VN Club',
  alternateName: 'Visual Novel Club Resources',
  url: 'https://vnclub.org',
  logo: {
    '@type': 'ImageObject',
    url: 'https://vnclub.org/assets/hikaru-icon2.webp',
    width: 512,
    height: 512,
  },
  description: 'Learn Japanese with visual novels. Comprehensive guides, tools, and resources for immersion-based Japanese learning through VNs.',
  sameAs: [
    'https://discord.gg/hnfUpsPv8T',
    'https://github.com/drinosaret/vn-club-resources',
  ],
  knowsAbout: ['Japanese language learning', 'Visual novels', 'Immersion learning', 'Text hooking'],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(organizationSchema) }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme') || 'light';
                  document.documentElement.className = theme;
                } catch (e) {}
              })();
            `,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                document.documentElement.classList.add('fonts-loading');
                var done = false;
                function show() {
                  if (!done) { done = true; document.documentElement.classList.remove('fonts-loading'); }
                }
                document.fonts.ready.then(show);
                setTimeout(show, 300);
              })();
            `,
          }}
        />
      </head>
      <body className={roboto.className} suppressHydrationWarning>
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        <NavigationPrefetch />
        <Providers>
          <ScrollToTop />
          <ScrollToTopButton />
          <ErrorBoundary>
            <div className="flex flex-col min-h-screen">
              <Header />
              <main className="flex-grow pt-16 md:pt-[72px]">
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
