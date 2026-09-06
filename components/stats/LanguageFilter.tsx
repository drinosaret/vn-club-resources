'use client';

export type LanguageFilterValue = 'ja' | 'all';

interface LanguageFilterProps {
  value: LanguageFilterValue;
  onChange: (value: LanguageFilterValue) => void;
  className?: string;
}

/**
 * Toggle filter for showing Japanese-only VNs vs all VNs.
 * Defaults to Japanese-only since the site targets Japanese learners.
 */
export function LanguageFilter({ value, onChange, className = '' }: LanguageFilterProps) {
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <span className="fig-label" id="language-filter-label">Language</span>
      <div role="group" aria-labelledby="language-filter-label" className="tabs">
        <button
          onClick={() => onChange('ja')}
          aria-pressed={value === 'ja'}
          className={`tab ${value === 'ja' ? 'tab--on' : ''}`}
        >
          Japanese
        </button>
        <button
          onClick={() => onChange('all')}
          aria-pressed={value === 'all'}
          className={`tab ${value === 'all' ? 'tab--on' : ''}`}
        >
          All
        </button>
      </div>
    </div>
  );
}

/**
 * Helper function to filter VNs by original language.
 * Returns true if the VN should be shown based on the filter.
 */
export function filterByLanguage<T extends { olang?: string }>(
  vn: T,
  filter: LanguageFilterValue
): boolean {
  if (filter === 'all') return true;
  return vn.olang === 'ja';
}
