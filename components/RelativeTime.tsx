'use client';

import { useState, useEffect } from 'react';

interface RelativeTimeProps {
  dateString: string;
  className?: string;
}

function formatRelativeTime(dateString: string) {
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
}

function formatFullDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function RelativeTime({ dateString, className }: RelativeTimeProps) {
  const fullDate = formatFullDate(dateString);
  // Start with just the full date to ensure server/client match
  const [relativeText, setRelativeText] = useState<string | null>(null);

  useEffect(() => {
    // Update to relative time only on the client
    setRelativeText(formatRelativeTime(dateString));
  }, [dateString]);

  return (
    <time dateTime={dateString} className={className}>
      {fullDate}{relativeText && ` (${relativeText})`}
    </time>
  );
}
