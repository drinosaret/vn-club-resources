'use client';

import { X, Tag, Minus, User, Pen, Mic, Building2, Newspaper } from 'lucide-react';
import { BrowseFilters } from '@/lib/vndb-stats-api';
import { SelectedTag, FilterEntityType } from './TagFilter';
import { LANGUAGE_LABELS, PLATFORM_LABELS, LENGTH_LABELS, AGE_LABELS, STATUS_LABELS } from './filter-constants';

interface ActiveFilterChipsProps {
  filters: BrowseFilters;
  selectedTags: SelectedTag[];
  onRemoveFilter: (filterKey: keyof BrowseFilters, value?: string) => void;
  onRemoveTag: (tagId: string, tagType: FilterEntityType) => void;
  onClearAll: () => void;
}

interface ChipProps {
  label: string;
  onRemove: () => void;
  isExclude?: boolean;
  icon?: React.ReactNode;
}

function Chip({ label, onRemove, isExclude, icon }: ChipProps) {
  return (
    <span
      className={`
        inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap flex-shrink-0
        ${isExclude
          ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700'
          : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700'
        }
      `}
    >
      {icon}
      {isExclude && <Minus className="w-3 h-3" />}
      <span className={isExclude ? 'line-through' : ''}>{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="hover:bg-black/10 dark:hover:bg-white/10 rounded-full p-0.5 transition-colors"
        aria-label={`Remove ${label} filter`}
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

export function ActiveFilterChips({
  filters,
  selectedTags,
  onRemoveFilter,
  onRemoveTag,
  onClearAll,
}: ActiveFilterChipsProps) {
  const chips: React.ReactNode[] = [];

  // Tags / Traits / Entities
  const ENTITY_ICONS: Record<FilterEntityType, React.ReactNode> = {
    tag: <Tag className="w-3 h-3" />,
    trait: <User className="w-3 h-3" />,
    staff: <Pen className="w-3 h-3" />,
    seiyuu: <Mic className="w-3 h-3" />,
    developer: <Building2 className="w-3 h-3" />,
    publisher: <Newspaper className="w-3 h-3" />,
  };
  selectedTags.forEach((tag) => {
    chips.push(
      <Chip
        key={`${tag.type}-${tag.id}`}
        label={tag.name}
        onRemove={() => onRemoveTag(tag.id, tag.type)}
        isExclude={tag.mode === 'exclude'}
        icon={ENTITY_ICONS[tag.type]}
      />
    );
  });

  // Original Language
  if (filters.olang) {
    filters.olang.split(',').forEach((lang) => {
      const label = LANGUAGE_LABELS[lang.trim()] || lang.trim();
      chips.push(
        <Chip
          key={`olang-${lang}`}
          label={label}
          onRemove={() => onRemoveFilter('olang', lang.trim())}
        />
      );
    });
  }
  if (filters.exclude_olang) {
    filters.exclude_olang.split(',').forEach((lang) => {
      const label = LANGUAGE_LABELS[lang.trim()] || lang.trim();
      chips.push(
        <Chip
          key={`exclude_olang-${lang}`}
          label={label}
          onRemove={() => onRemoveFilter('exclude_olang', lang.trim())}
          isExclude
        />
      );
    });
  }

  // Platform
  if (filters.platform) {
    filters.platform.split(',').forEach((plat) => {
      const label = PLATFORM_LABELS[plat.trim()] || plat.trim();
      chips.push(
        <Chip
          key={`platform-${plat}`}
          label={label}
          onRemove={() => onRemoveFilter('platform', plat.trim())}
        />
      );
    });
  }
  if (filters.exclude_platform) {
    filters.exclude_platform.split(',').forEach((plat) => {
      const label = PLATFORM_LABELS[plat.trim()] || plat.trim();
      chips.push(
        <Chip
          key={`exclude_platform-${plat}`}
          label={label}
          onRemove={() => onRemoveFilter('exclude_platform', plat.trim())}
          isExclude
        />
      );
    });
  }

  // Length
  if (filters.length) {
    filters.length.split(',').forEach((len) => {
      const label = LENGTH_LABELS[len.trim()] || len.trim();
      chips.push(
        <Chip
          key={`length-${len}`}
          label={label}
          onRemove={() => onRemoveFilter('length', len.trim())}
        />
      );
    });
  }
  if (filters.exclude_length) {
    filters.exclude_length.split(',').forEach((len) => {
      const label = LENGTH_LABELS[len.trim()] || len.trim();
      chips.push(
        <Chip
          key={`exclude_length-${len}`}
          label={label}
          onRemove={() => onRemoveFilter('exclude_length', len.trim())}
          isExclude
        />
      );
    });
  }

  // Age Rating
  if (filters.minage) {
    filters.minage.split(',').forEach((age) => {
      const label = AGE_LABELS[age.trim()] || age.trim();
      chips.push(
        <Chip
          key={`minage-${age}`}
          label={label}
          onRemove={() => onRemoveFilter('minage', age.trim())}
        />
      );
    });
  }
  if (filters.exclude_minage) {
    filters.exclude_minage.split(',').forEach((age) => {
      const label = AGE_LABELS[age.trim()] || age.trim();
      chips.push(
        <Chip
          key={`exclude_minage-${age}`}
          label={label}
          onRemove={() => onRemoveFilter('exclude_minage', age.trim())}
          isExclude
        />
      );
    });
  }

  // Dev Status (only if not default -1)
  if (filters.devstatus && filters.devstatus !== '-1') {
    filters.devstatus.split(',').forEach((status) => {
      const label = STATUS_LABELS[status.trim()] || status.trim();
      chips.push(
        <Chip
          key={`devstatus-${status}`}
          label={label}
          onRemove={() => onRemoveFilter('devstatus', status.trim())}
        />
      );
    });
  }
  if (filters.exclude_devstatus) {
    filters.exclude_devstatus.split(',').forEach((status) => {
      const label = STATUS_LABELS[status.trim()] || status.trim();
      chips.push(
        <Chip
          key={`exclude_devstatus-${status}`}
          label={label}
          onRemove={() => onRemoveFilter('exclude_devstatus', status.trim())}
          isExclude
        />
      );
    });
  }

  // Year Range
  if (filters.year_min || filters.year_max) {
    const yearLabel = filters.year_min === filters.year_max
      ? `Year: ${filters.year_min}`
      : `Year: ${filters.year_min || '...'} - ${filters.year_max || '...'}`;
    chips.push(
      <Chip
        key="year"
        label={yearLabel}
        onRemove={() => onRemoveFilter('year_min')}
      />
    );
  }

  // Rating Range
  if (filters.min_rating || filters.max_rating) {
    const ratingLabel = filters.min_rating === filters.max_rating
      ? `Rating: ${filters.min_rating}`
      : `Rating: ${filters.min_rating || '1'} - ${filters.max_rating || '10'}`;
    chips.push(
      <Chip
        key="rating"
        label={ratingLabel}
        onRemove={() => onRemoveFilter('min_rating')}
      />
    );
  }

  // Vote Count Range
  if (filters.min_votecount || filters.max_votecount) {
    const voteLabel = filters.min_votecount === filters.max_votecount
      ? `Votes: ${filters.min_votecount}`
      : `Votes: ${filters.min_votecount || '0'}${filters.max_votecount ? ` - ${filters.max_votecount}` : '+'}`;
    chips.push(
      <Chip
        key="votecount"
        label={voteLabel}
        onRemove={() => onRemoveFilter('min_votecount')}
      />
    );
  }

  // Spoiler level (only if not default 0)
  if (filters.spoiler_level && filters.spoiler_level > 0) {
    const spoilerLabel = filters.spoiler_level === 1 ? 'Minor Spoilers' : 'All Spoilers';
    chips.push(
      <Chip
        key="spoiler"
        label={spoilerLabel}
        onRemove={() => onRemoveFilter('spoiler_level')}
      />
    );
  }

  // Include children toggle (only show if disabled - non-default)
  if (filters.include_children === false) {
    chips.push(
      <Chip
        key="include_children"
        label="Exact tags only"
        onRemove={() => onRemoveFilter('include_children')}
      />
    );
  }

  if (chips.length === 0) return null;

  return (
    <div className="py-2">
      {/* Mobile: horizontal scroll, Desktop: wrap */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 lg:overflow-visible lg:flex-wrap lg:pb-0 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600">
        {chips}
        {chips.length > 1 && (
          <button
            type="button"
            onClick={onClearAll}
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline whitespace-nowrap flex-shrink-0"
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
