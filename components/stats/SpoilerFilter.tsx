'use client';

export type SpoilerFilterValue = 0 | 1 | 2;

const SPOILER_OPTIONS: { value: SpoilerFilterValue; label: string }[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Minor' },
  { value: 2, label: 'Major' },
];

interface SpoilerFilterProps {
  value: SpoilerFilterValue;
  onChange: (value: SpoilerFilterValue) => void;
  className?: string;
}

export function SpoilerFilter({ value, onChange, className = '' }: SpoilerFilterProps) {
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value) as SpoilerFilterValue)}
        className="st-select px-2 py-1.5 text-xs"
      >
        {SPOILER_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            Spoilers: {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
