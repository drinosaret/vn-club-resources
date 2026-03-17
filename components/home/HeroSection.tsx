'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { StatsBanner } from './StatsBanner';

// Responsive styles that Tailwind JIT may not generate for new components
const heroResponsiveStyles = `
  .hero-text { text-align: center; }
  .hero-text .hero-subtitle { margin-left: auto; margin-right: auto; }
  .hero-ctas { justify-content: center; }
  .hero-character { display: none; }
  .hero-stats { justify-content: center; }
  @media (min-width: 768px) {
    .hero-text { text-align: left; }
    .hero-text .hero-subtitle { margin-left: 0; margin-right: 0; }
    .hero-ctas { justify-content: flex-start; }
    .hero-character { display: flex; }
    .hero-stats { justify-content: flex-start; }
  }
`;

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-linear-to-br from-primary-600 via-primary-700 to-primary-800 text-white">
      <style dangerouslySetInnerHTML={{ __html: heroResponsiveStyles }} />

      {/* Background decoration orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -right-1/4 w-96 h-96 bg-primary-500/20 rounded-full blur-2xl" />
        <div className="absolute -bottom-1/2 -left-1/4 w-96 h-96 bg-primary-400/10 rounded-full blur-2xl" />
      </div>

      <div className="relative container mx-auto px-4 pt-10 pb-6 md:pt-16 md:pb-0 max-w-6xl">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32 }}>
          {/* Left column: text content */}
          <div className="hero-text" style={{ flex: 1, paddingBottom: 24 }}>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-3 tracking-tight">
              Learn Japanese with Visual Novels
            </h1>

            <div className="mb-4 select-none">
              <span className="text-3xl md:text-4xl font-black tracking-wider bg-linear-to-br from-white via-primary-200 to-white bg-clip-text text-transparent">
                魑魅魍魎
              </span>
            </div>

            <p className="hero-subtitle text-lg md:text-xl mb-6 max-w-xl text-primary-100 leading-relaxed">
              Welcome to the club. Everything you need to start reading visual novels in Japanese.
            </p>

            <div className="hero-ctas flex flex-col sm:flex-row gap-3 mb-6">
              <Link
                href="/guide"
                className="inline-flex items-center justify-center bg-white text-primary-700 px-7 py-3.5 rounded-xl font-semibold hover:bg-primary-50 hover:shadow-lg transition-[background-color,box-shadow] duration-200 text-lg"
              >
                Get Started
              </Link>
              <Link
                href="/browse"
                className="inline-flex items-center justify-center gap-2 bg-primary-500/40 text-white px-7 py-3.5 rounded-xl font-semibold hover:bg-primary-500/50 transition-[background-color,border-color,box-shadow] duration-200 border-2 border-white/30 hover:border-white/50 text-lg"
              >
                <Search className="w-5 h-5" />
                Browse VNs
              </Link>
            </div>

            <StatsBanner />

            <Link
              href="/join"
              className="hero-stats inline-flex items-center gap-1.5 text-sm text-primary-200 hover:text-white transition-colors mt-6"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
              Join the club on Discord
            </Link>
          </div>

          {/* Right column: Hikaru character art (desktop only) */}
          <div
            className="hero-character"
            style={{
              alignItems: 'flex-end',
              justifyContent: 'center',
              flexShrink: 0,
              width: 300,
              position: 'relative',
            }}
          >
            <Image
              src="/assets/hikaruportrait.webp"
              alt="Hikaru, VN Club mascot"
              width={300}
              height={400}
              className="object-contain drop-shadow-2xl"
              style={{ display: 'block' }}
              loading="eager"
              unoptimized
            />
          </div>
        </div>
      </div>
    </section>
  );
}
