'use client';

import { BookOpen, Sparkles, BarChart3 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

interface StatItemProps {
  icon: React.ReactNode;
  value: number;
  label: string;
  suffix?: string;
  href?: string;
}

function AnimatedNumber({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [displayValue, setDisplayValue] = useState(0);
  const [hasAnimated, setHasAnimated] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (hasAnimated) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setHasAnimated(true);
          // Animate the number
          const duration = 1500;
          const steps = 60;
          const increment = value / steps;
          let current = 0;
          const timer = setInterval(() => {
            current += increment;
            if (current >= value) {
              setDisplayValue(value);
              clearInterval(timer);
            } else {
              setDisplayValue(Math.floor(current));
            }
          }, duration / steps);
        }
      },
      { threshold: 0.5 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [value, hasAnimated]);

  return (
    <span ref={ref} className="tabular-nums">
      {displayValue.toLocaleString()}{suffix}
    </span>
  );
}

function StatItem({ icon, value, label, suffix, href }: StatItemProps) {
  const content = (
    <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-white/15 hover:bg-white/20 transition-colors">
      <div className="p-2 rounded-lg bg-white/20">
        {icon}
      </div>
      <div className="text-left">
        <div className="text-xl md:text-2xl font-bold text-white">
          <AnimatedNumber value={value} suffix={suffix} />
        </div>
        <div className="text-sm text-primary-100">{label}</div>
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {content}
      </Link>
    );
  }

  return content;
}

export function StatsBanner() {
  return (
    <div className="hero-stats flex flex-wrap justify-center gap-3 md:gap-4 pt-2">
      <StatItem
        icon={<BookOpen className="w-5 h-5 text-white" />}
        value={15}
        suffix="+"
        label="Setup Guides"
        href="/jl-guide"
      />
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
