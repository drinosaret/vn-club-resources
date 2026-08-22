import { PLATFORM_SHORT_LABELS } from '@/lib/platforms';

/** Shared utilities for VN detail page components. */

export const lengthLabels: Record<number, { label: string; hours: string }> = {
  1: { label: 'Very Short', hours: '< 2 hours' },
  2: { label: 'Short', hours: '2-10 hours' },
  3: { label: 'Medium', hours: '10-30 hours' },
  4: { label: 'Long', hours: '30-50 hours' },
  5: { label: 'Very Long', hours: '> 50 hours' },
};

// Badge names for the VN sidebar. Defined in lib/platforms alongside every other form of
// the same list, so a platform cannot be named one thing here and another on the filters.
export const platformNames: Record<string, string> = PLATFORM_SHORT_LABELS;

/** Detects if a string contains Japanese characters */
export function hasJapanese(s: string): boolean {
  return /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(s);
}

export function formatReleaseDate(dateStr: string): string {
  if (!dateStr) return '';
  if (dateStr === 'tba' || dateStr.includes('9999')) return 'TBA';

  const parts = dateStr.split('-');
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];

  if (!year || year === '0000') return 'Unknown';
  if (!month || month === '99' || month === '00') return year;

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthNum = parseInt(month, 10);
  const monthName = monthNames[monthNum - 1] || month;

  if (!day || day === '99' || day === '00') return `${monthName} ${year}`;
  return `${monthName} ${parseInt(day, 10)}, ${year}`;
}

export function formatUpdatedAt(dateStr: string): string {
  if (!dateStr) return '';

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  }

  // Use actual calendar difference for months/years
  let months = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
  if (now.getDate() < date.getDate()) months--;
  months = Math.max(1, months);

  if (months < 12) {
    return `${months} month${months > 1 ? 's' : ''} ago`;
  }

  const years = Math.floor(months / 12);
  return `${years} year${years > 1 ? 's' : ''} ago`;
}
