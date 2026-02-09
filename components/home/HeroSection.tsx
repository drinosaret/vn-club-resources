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
    <section className="relative overflow-hidden bg-gradient-to-br from-primary-600 via-primary-700 to-primary-800 text-white">
      <style dangerouslySetInnerHTML={{ __html: heroResponsiveStyles }} />

      {/* Background decoration orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -right-1/4 w-96 h-96 bg-primary-500/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-1/2 -left-1/4 w-96 h-96 bg-primary-400/10 rounded-full blur-3xl" />
      </div>

      <div className="relative container mx-auto px-4 pt-10 pb-6 md:pt-16 md:pb-0 max-w-6xl">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32 }}>
          {/* Left column: text content */}
          <div className="hero-text" style={{ flex: 1, paddingBottom: 24 }}>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-3 tracking-tight">
              Learn Japanese with Visual Novels
            </h1>

            <div className="mb-4 select-none">
              <span className="text-3xl md:text-4xl font-black tracking-wider bg-gradient-to-br from-white via-primary-200 to-white bg-clip-text text-transparent">
                魑魅魍魎
              </span>
            </div>

            <p className="hero-subtitle text-lg md:text-xl mb-6 max-w-xl text-primary-100 leading-relaxed">
              Welcome to the club. Everything you need to start reading visual novels in Japanese.
            </p>

            <div className="hero-ctas flex flex-col sm:flex-row gap-3 mb-6">
              <Link
                href="/guide"
                className="inline-flex items-center justify-center bg-white text-primary-700 px-7 py-3.5 rounded-xl font-semibold hover:bg-primary-50 hover:shadow-lg transition-all duration-200 text-lg"
              >
                Get Started
              </Link>
              <Link
                href="/browse"
                className="inline-flex items-center justify-center gap-2 bg-primary-500/30 text-white px-7 py-3.5 rounded-xl font-semibold hover:bg-primary-500/50 transition-all duration-200 border-2 border-white/30 hover:border-white/50 text-lg backdrop-blur-sm"
              >
                <Search className="w-5 h-5" />
                Browse VNs
              </Link>
            </div>

            <StatsBanner />
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
              alt=""
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
