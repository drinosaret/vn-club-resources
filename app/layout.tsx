import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const roboto = Roboto({
  weight: ['300', '400', '500', '700'],
  subsets: ["latin"],
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: "Visual Novel Club Resources",
    template: "%s | VN Club",
  },
  description: "Learn Japanese with visual novels using our comprehensive guides, tools, and resources. Setup text hookers, dictionaries, Anki mining, and start your immersion journey today.",
  keywords: ["visual novels", "Japanese learning", "VN", "Japanese", "learning resources", "text hooking", "Anki", "immersion"],
  authors: [{ name: "VN Club Resurrection" }],
  metadataBase: new URL('https://vnclub.org'),
  icons: {
    icon: '/assets/hikaru-icon2.webp',
    apple: '/assets/hikaru-icon2.webp',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://vnclub.org',
    siteName: 'Visual Novel Club Resources',
    title: 'Visual Novel Club Resources',
    description: 'Learn Japanese with visual novels using our comprehensive guides, tools, and resources. Setup text hookers, dictionaries, Anki mining, and start your immersion journey today.',
    images: [
      {
        url: '/assets/hikaru-icon2.webp',
        width: 512,
        height: 512,
        alt: 'Visual Novel Club Resources',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'Visual Novel Club Resources',
    description: 'Learn Japanese with visual novels using our comprehensive guides, tools, and resources.',
    images: ['/assets/hikaru-icon2.webp'],
  },
  robots: {
    index: true,
    follow: true,
  },
};

// Organization JSON-LD schema
const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Visual Novel Club Resources',
  url: 'https://vnclub.org',
  logo: {
    '@type': 'ImageObject',
    url: 'https://vnclub.org/assets/hikaru-icon2.webp',
    width: 512,
    height: 512,
  },
  description: 'Learn Japanese with visual novels using our comprehensive guides, tools, and resources.',
  sameAs: [
    'https://discord.gg/hnfUpsPv8T',
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
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
      </head>
      <body className={roboto.className} suppressHydrationWarning>
        <div className="flex flex-col min-h-screen">
          <Header />
          <main className="flex-grow">
            {children}
          </main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
