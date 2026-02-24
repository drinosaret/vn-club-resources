'use client';

import { BookOpen, Sparkles, BarChart3 } from 'lucide-react';
import Link from 'next/link';

export function StatsBanner() {
  return (
    <div className="hero-stats flex flex-wrap justify-center gap-3 md:gap-4 pt-2">
      <Link href="/jl-guide" className="block">
        <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-white/15 hover:bg-white/20 transition-colors">
          <div className="p-2 rounded-lg bg-white/20">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <div className="text-xl md:text-2xl font-bold text-white tabular-nums">
              15+
            </div>
            <div className="text-sm text-primary-100">Setup Guides</div>
          </div>
        </div>
      </Link>
      <Link
        href="/recommendations"
        className="flex items-center gap-3 px-4 py-2 rounded-xl bg-white/15 hover:bg-white/20 transition-colors"
      >
        <div className="p-2 rounded-lg bg-white/20">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div className="text-left">
          <div className="text-xl md:text-2xl font-bold text-white">
            Get Recs
          </div>
          <div className="text-sm text-primary-100">Find Your Next VN</div>
        </div>
      </Link>
      <Link
        href="/stats"
        className="flex items-center gap-3 px-4 py-2 rounded-xl bg-white/15 hover:bg-white/20 transition-colors"
      >
        <div className="p-2 rounded-lg bg-white/20">
          <BarChart3 className="w-5 h-5 text-white" />
        </div>
        <div className="text-left">
          <div className="text-xl md:text-2xl font-bold text-white">
            View Stats
          </div>
          <div className="text-sm text-primary-100">Analyze Your Reading</div>
        </div>
      </Link>
    </div>
  );
}
