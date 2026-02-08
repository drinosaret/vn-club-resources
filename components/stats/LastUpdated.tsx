'use client';

import { Clock } from 'lucide-react';

interface LastUpdatedProps {
  timestamp?: string | null;
  className?: string;
}

/**
 * Format a timestamp as a relative time string (e.g., "5 minutes ago")
 * or as a date if it's older than 24 hours.
 */
function formatRelativeTime(timestamp: string): string {
  // Backend may return timestamps with +00:00 offset, Z suffix, or no timezone
  const hasTimezone = /[Zz]$/.test(timestamp) || /[+-]\d{2}:\d{2}$/.test(timestamp);
  const normalizedTimestamp = hasTimezone ? timestamp : timestamp + 'Z';
  const date = new Date(normalizedTimestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);

  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return 'Just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  } else {
    // Format as date for older timestamps
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
}

/**
 * Display component for showing when stats data was last updated.
 */
export function LastUpdated({ timestamp, className = '' }: LastUpdatedProps) {
  if (!timestamp) {
    return null;
  }

  const formattedTime = formatRelativeTime(timestamp);

  return (
    <div className={`flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 ${className}`}>
      <Clock className="w-3 h-3" />
      <span>Updated {formattedTime}</span>
    </div>
  );
}
