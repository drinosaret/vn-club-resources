'use client';

export type LengthFilterValue = 'any' | 'very_short' | 'short' | 'medium' | 'long' | 'very_long';

const LENGTH_OPTIONS: { value: LengthFilterValue; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'very_short', label: 'Very Short' },
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'long', label: 'Long' },
  { value: 'very_long', label: 'Very Long' },
];

interface LengthFilterProps {
  value: LengthFilterValue;
  onChange: (value: LengthFilterValue) => void;
  className?: string;
}

export function LengthFilter({ value, onChange, className = '' }: LengthFilterProps) {
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <span className="fig-label" id="length-filter-label">Length</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as LengthFilterValue)}
        aria-labelledby="length-filter-label"
        className="st-select px-2 py-1.5 text-xs"
      >
        {LENGTH_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function filterByLength<T extends { length?: number }>(
  vn: T,
  filter: LengthFilterValue
): boolean {
  if (filter === 'any') return true;
  if (!vn.length) return false;

  const lengthMap: Record<LengthFilterValue, number> = {
    any: 0,
    very_short: 1,
    short: 2,
    medium: 3,
    long: 4,
    very_long: 5,
  };

  return vn.length === lengthMap[filter];
}
