'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';

const DISCORD_URL = '/join';

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

interface DiscordCTAProps {
  title: string;
  description: string;
  variant?: 'inline' | 'banner';
  dismissKey?: string;
  className?: string;
}

export function DiscordCTA({
  title,
  description,
  variant = 'inline',
  dismissKey,
  className = '',
}: DiscordCTAProps) {
  const [dismissed, setDismissed] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (dismissKey) {
      setDismissed(localStorage.getItem(`discord-cta-${dismissKey}`) === '1');
    } else {
      setDismissed(false);
    }
  }, [dismissKey]);

  if (!mounted || dismissed) return null;

  const handleDismiss = () => {
    if (dismissKey) {
      localStorage.setItem(`discord-cta-${dismissKey}`, '1');
    }
    setDismissed(true);
  };

  if (variant === 'banner') {
    return (
      <div className={`relative rounded-2xl bg-gradient-to-r from-[#5865F2]/10 via-indigo-50 to-[#5865F2]/10 dark:from-[#5865F2]/15 dark:via-indigo-900/20 dark:to-[#5865F2]/15 border border-[#5865F2]/20 dark:border-[#5865F2]/30 p-6 ${className}`}>
        <div className="flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
          <div className="shrink-0 w-12 h-12 rounded-xl bg-[#5865F2]/15 dark:bg-[#5865F2]/25 flex items-center justify-center">
            <DiscordIcon className="w-6 h-6 text-[#5865F2]" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{description}</p>
          </div>
          <Link
            href={DISCORD_URL}
            className="shrink-0 inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white font-semibold transition-colors"
          >
            <DiscordIcon className="w-5 h-5" />
            Join Server
          </Link>
        </div>
        {dismissKey && (
          <button
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="absolute top-3 right-3 p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <p className={`text-sm text-gray-500 dark:text-gray-400 text-center px-4 ${className}`}>
      {description}{' '}
      <Link
        href={DISCORD_URL}
        className="text-primary-600 dark:text-primary-400 hover:underline font-medium"
      >
        {title}
      </Link>
    </p>
  );
}
