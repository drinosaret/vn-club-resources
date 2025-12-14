'use client';

import { useState, useEffect } from 'react';

interface RelativeTimeProps {
  dateString: string;
  className?: string;
}

function formatRelativeTime(dateString: string) {
  try {
    // Guard against browsers that don't support Intl.RelativeTimeFormat
    if (typeof Intl === 'undefined' || !('RelativeTimeFormat' in Intl)) {
      return '';
    }

    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
    const intervals: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
      { unit: 'year', seconds: 60 * 60 * 24 * 365 },
      { unit: 'month', seconds: 60 * 60 * 24 * 30 },
      { unit: 'week', seconds: 60 * 60 * 24 * 7 },
      { unit: 'day', seconds: 60 * 60 * 24 },
      { unit: 'hour', seconds: 60 * 60 },
      { unit: 'minute', seconds: 60 },
      { unit: 'second', seconds: 1 },
    ];

    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

    for (const interval of intervals) {
      if (Math.abs(diffInSeconds) >= interval.seconds || interval.unit === 'second') {
        const value = diffInSeconds / interval.seconds;
        return rtf.format(Math.round(value), interval.unit);
      }
    }

    return '';
  } catch {
    // Gracefully degrade if anything fails
    return '';
  }
}

function formatFullDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function RelativeTime({ dateString, className }: RelativeTimeProps) {
  // Use null initial state to avoid hydration mismatch from locale/timezone differences
  const [displayText, setDisplayText] = useState<string | null>(null);

  useEffect(() => {
    // Only format dates on the client to avoid server/client mismatch
    const fullDate = formatFullDate(dateString);
    const relativeText = formatRelativeTime(dateString);
    setDisplayText(relativeText ? `${fullDate} (${relativeText})` : fullDate);
  }, [dateString]);

  // Render a placeholder during SSR that won't cause hydration mismatch
  return (
    <time dateTime={dateString} className={className}>
      {displayText ?? dateString}
    </time>
  );
}
