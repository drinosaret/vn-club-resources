'use client';

import { useState } from 'react';
import { X, Plus, Minus, ChevronDown } from 'lucide-react';
import { DropdownSelect, SelectedValue } from '../browse/DropdownSelect';
import { RangeSlider } from '../browse/RangeSlider';
import {
  PLATFORMS,
  LANGUAGES,
  LENGTHS,
  AGE_RATINGS,
  DEV_STATUS,
  PLATFORM_LABELS,
  LANGUAGE_LABELS,
  LENGTH_LABELS,
  AGE_LABELS,
  STATUS_LABELS,
  YEAR_RANGE,
  RATING_RANGE,
  VOTES_RANGE,
  DIFFICULTY_RANGE,
  parseSelected,
  toFilterStrings,
} from '../browse/filter-constants';
import { JitenAttribution } from '@/components/JitenAttribution';
import { getEntityDisplayName, useTitlePreference } from '@/lib/title-preference';
import { DIFFICULTY_BANDS } from '@/lib/difficulty';
import { SelectedItem } from './TagTraitAutocomplete';
import { EntityFilterAutocomplete } from './EntityFilterAutocomplete';
import {
  RecommendationEntity,
  RecommendationFilters,
  RecommendationFilterState,
  countFilterGroups,
  countActiveFilters,
} from '@/lib/recommendation-filters';

interface CompactRecommendationFiltersProps {
  state: RecommendationFilterState;
  onFilterChange: (changes: Partial<RecommendationFilters>) => void;
  onEntitiesChange: (entities: RecommendationEntity[]) => void;
  onRemoveTagTrait: (index: number) => void;
  onToggleTagTraitMode: (index: number) => void;
  onClearAll: () => void;
  /**
   * Whether the summary of what is in force is drawn here. A caller keeping the controls
   * behind a disclosure renders it outside them instead, where it is visible with the
   * disclosure shut.
   */
  showChips?: boolean;
}

const RATING_STEP = 0.5;
const VOTES_STEP = 10;

function formatVotes(value: number): string {
  return value >= VOTES_RANGE.max
    ? `${VOTES_RANGE.max.toLocaleString()}+`
    : value.toLocaleString();
}

function difficultyName(band: number): string {
  return DIFFICULTY_BANDS[band]?.label ?? String(band);
}

/**
 * The filter bar above the recommendation grid.
 *
 * The controls people reach for stay on the face of it, with the long tail behind one
 * disclosure that opens by itself when a link arrives carrying any of them. Nothing here
 * requests anything: the page fetches on Apply, because a request is rate limited and can
 * take seconds.
 */
export function CompactRecommendationFilters({
  state,
  onFilterChange,
  onEntitiesChange,
  onRemoveTagTrait,
  onToggleTagTraitMode,
  onClearAll,
  showChips = true,
}: CompactRecommendationFiltersProps) {
  const { filters, entities } = state;
  const groups = countFilterGroups(state);

  const handlePlatformChange = (selected: SelectedValue[]) => {
    const { include, exclude } = toFilterStrings(selected);
    onFilterChange({ platform: include, exclude_platform: exclude });
  };

  const handleLengthChange = (selected: SelectedValue[]) => {
    const { include, exclude } = toFilterStrings(selected);
    onFilterChange({ length: include, exclude_length: exclude });
  };

  const handleAgeChange = (selected: SelectedValue[]) => {
    const { include, exclude } = toFilterStrings(selected);
    onFilterChange({ minage: include, exclude_minage: exclude });
  };

  const handleStatusChange = (selected: SelectedValue[]) => {
    const { include, exclude } = toFilterStrings(selected);
    onFilterChange({ devstatus: include, exclude_devstatus: exclude });
  };

  // Picking languages here is the narrower request, so it takes the language axis over from
  // the Japanese-only toggle. That handover happens where the change is normalized.
  const handleLanguageChange = (selected: SelectedValue[]) => {
    const { include, exclude } = toFilterStrings(selected);
    onFilterChange({ olang: include, exclude_olang: exclude });
  };

  const handleJapaneseOnly = (japaneseOnly: boolean) => {
    onFilterChange(
      japaneseOnly
        ? { japanese_only: true, olang: undefined, exclude_olang: undefined }
        : { japanese_only: false },
    );
  };

  return (
    <div className="space-y-2">
      <FilterGroup title="Basics" count={groups.basics} defaultOpen>
        <div className="grid grid-cols-2 gap-3 items-end">
          <DropdownSelect
            label="Platform"
            options={PLATFORMS}
            selected={parseSelected(filters.platform, filters.exclude_platform)}
            onChange={handlePlatformChange}
          />
          <DropdownSelect
            label="Length"
            options={LENGTHS}
            selected={parseSelected(filters.length, filters.exclude_length)}
            onChange={handleLengthChange}
          />
          <ToggleGroup
            label="Japanese only"
            options={[
              { label: 'Yes', isActive: filters.japanese_only, onSelect: () => handleJapaneseOnly(true) },
              { label: 'No', isActive: !filters.japanese_only, onSelect: () => handleJapaneseOnly(false) },
            ]}
          />
          <ToggleGroup
            label="Blacklist"
            options={[
              { label: 'Hidden', isActive: filters.exclude_blacklist, onSelect: () => onFilterChange({ exclude_blacklist: true }) },
              { label: 'Shown', isActive: !filters.exclude_blacklist, onSelect: () => onFilterChange({ exclude_blacklist: false }) },
            ]}
          />
          <div className="col-span-2">
            <ToggleGroup
              label="Spoiler Level"
              options={['None', 'Minor', 'Major'].map((label, level) => ({
                label,
                isActive: filters.spoiler_level === level,
                onSelect: () => onFilterChange({ spoiler_level: level }),
              }))}
            />
          </div>
          <div className="col-span-2">
            <RangeSlider
              label="Rating"
              min={RATING_RANGE.min}
              max={RATING_RANGE.max}
              step={RATING_STEP}
              minValue={filters.min_rating}
              maxValue={filters.max_rating}
              onChange={(min, max) => onFilterChange({ min_rating: min, max_rating: max })}
              formatValue={(value) => value.toFixed(1)}
            />
          </div>
        </div>
      </FilterGroup>

      <FilterGroup title="Release" count={groups.release}>
        <div className="grid grid-cols-2 gap-3 items-end">
          <DropdownSelect
            label="Age Rating"
            options={AGE_RATINGS}
            selected={parseSelected(filters.minage, filters.exclude_minage)}
            onChange={handleAgeChange}
          />
          <DropdownSelect
            label="Status"
            options={DEV_STATUS}
            selected={parseSelected(filters.devstatus, filters.exclude_devstatus)}
            onChange={handleStatusChange}
          />
          <div className="col-span-2">
            <DropdownSelect
              label="Original languages"
              options={LANGUAGES}
              selected={parseSelected(filters.olang, filters.exclude_olang)}
              onChange={handleLanguageChange}
            />
          </div>
          <div className="col-span-2">
            <RangeSlider
              label="Year"
              min={YEAR_RANGE.min}
              max={YEAR_RANGE.max}
              step={1}
              minValue={filters.year_min}
              maxValue={filters.year_max}
              onChange={(min, max) => onFilterChange({ year_min: min, year_max: max })}
            />
          </div>
        </div>
        {/* Stated with the control rather than with its result, so the handover is known
            before a language is picked. */}
        <p className="rc-why mt-2">
          A language selection replaces the Japanese-only setting under Basics.
        </p>
      </FilterGroup>

      <FilterGroup title="Reading & difficulty" count={groups.reading}>
        <div className="space-y-5">
          <RangeSlider
            label="Votes"
            min={VOTES_RANGE.min}
            max={VOTES_RANGE.max}
            step={VOTES_STEP}
            minValue={filters.min_votecount}
            maxValue={filters.max_votecount}
            onChange={(min, max) => onFilterChange({ min_votecount: min, max_votecount: max })}
            formatValue={formatVotes}
          />
          <div>
            <RangeSlider
              label="Japanese difficulty"
              hint="Only titles whose script has been analysed"
              min={DIFFICULTY_RANGE.min}
              max={DIFFICULTY_RANGE.max}
              step={1}
              minValue={filters.min_difficulty}
              maxValue={filters.max_difficulty}
              onChange={(min, max) => onFilterChange({ min_difficulty: min, max_difficulty: max })}
              formatValue={difficultyName}
            />
            <JitenAttribution describes="This difficulty scale" className="mt-2" />
          </div>
        </div>
      </FilterGroup>

      <FilterGroup title="People & studios" count={groups.people}>
        <EntityFilterAutocomplete selected={entities} onChange={onEntitiesChange} />
      </FilterGroup>

      <FilterGroup title="Content" count={groups.content}>
        <ToggleGroup
          label="Adult (18+)"
          options={[
            { label: 'Shown', isActive: filters.nsfw, onSelect: () => onFilterChange({ nsfw: true }) },
            { label: 'Hidden', isActive: !filters.nsfw, onSelect: () => onFilterChange({ nsfw: false }) },
          ]}
        />
      </FilterGroup>

      {showChips && (
      <ActiveRecommendationChips
        state={state}
        onFilterChange={onFilterChange}
        onEntitiesChange={onEntitiesChange}
        onRemoveTagTrait={onRemoveTagTrait}
        onToggleTagTraitMode={onToggleTagTraitMode}
        onClearAll={onClearAll}
      />
      )}
    </div>
  );
}

/**
 * One group of controls behind a header that opens and closes it.
 *
 * Opens itself where something inside is already in force, so a link that carried a
 * filter shows the control that set it. The count on the header is what keeps a shut
 * group honest: it says whether the group is doing anything without being opened.
 */
export function FilterGroup({
  title,
  count = 0,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(() => defaultOpen || count > 0);
  const id = `rc-group-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <section className="rc-group">
      <h3 className="m-0">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={id}
          className="rc-disclose"
        >
          <span className="inline-flex items-center gap-2">
            {title}
            {count > 0 && <span className="rc-badge">{count}</span>}
          </span>
          <ChevronDown aria-hidden className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </h3>
      <div id={id} hidden={!open} className="pt-2 pb-3">
        {children}
      </div>
    </section>
  );
}

interface ToggleOption {
  label: string;
  isActive: boolean;
  onSelect: () => void;
}

function ToggleGroup({ label, options }: { label: string; options: ToggleOption[] }) {
  return (
    <div>
      <label className="rc-label block mb-1">{label}</label>
      <div className="rc-seg rc-seg--wide h-[38px]">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={option.onSelect}
            aria-pressed={option.isActive}
            className={`rc-seg-item ${option.isActive ? 'rc-seg-item--on' : ''}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Removing a value from a comma-separated list, or the whole filter when it was the last. */
function withoutValue(current: string | undefined, value: string): string | undefined {
  const remaining = (current ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry && entry !== value);
  return remaining.length > 0 ? remaining.join(',') : undefined;
}

function rangeLabel(
  name: string,
  min: number | undefined,
  max: number | undefined,
  format: (value: number) => string,
): string {
  if (min !== undefined && max !== undefined) {
    return min === max ? `${name}: ${format(min)}` : `${name}: ${format(min)} - ${format(max)}`;
  }
  if (min !== undefined) return `${name}: ${format(min)}+`;
  return `${name}: up to ${format(max as number)}`;
}

export function ActiveRecommendationChips({
  state,
  onFilterChange,
  onEntitiesChange,
  onRemoveTagTrait,
  onToggleTagTraitMode,
  onClearAll,
}: CompactRecommendationFiltersProps) {
  const { preference } = useTitlePreference();
  const { filters, tagTraits, entities } = state;
  if (countActiveFilters(state) === 0) return null;

  const chips: React.ReactNode[] = [];

  tagTraits.forEach((item, index) => {
    chips.push(
      <TagTraitChip
        key={`${item.type}-${item.id}`}
        item={item}
        onRemove={() => onRemoveTagTrait(index)}
        onToggleMode={() => onToggleTagTraitMode(index)}
      />,
    );
  });

  const listChips: {
    key: keyof RecommendationFilters;
    value: string | undefined;
    labels: Record<string, string>;
    isExclude?: boolean;
  }[] = [
    { key: 'platform', value: filters.platform, labels: PLATFORM_LABELS },
    { key: 'exclude_platform', value: filters.exclude_platform, labels: PLATFORM_LABELS, isExclude: true },
    { key: 'length', value: filters.length, labels: LENGTH_LABELS },
    { key: 'exclude_length', value: filters.exclude_length, labels: LENGTH_LABELS, isExclude: true },
    { key: 'minage', value: filters.minage, labels: AGE_LABELS },
    { key: 'exclude_minage', value: filters.exclude_minage, labels: AGE_LABELS, isExclude: true },
    { key: 'devstatus', value: filters.devstatus, labels: STATUS_LABELS },
    { key: 'exclude_devstatus', value: filters.exclude_devstatus, labels: STATUS_LABELS, isExclude: true },
    { key: 'olang', value: filters.olang, labels: LANGUAGE_LABELS },
    { key: 'exclude_olang', value: filters.exclude_olang, labels: LANGUAGE_LABELS, isExclude: true },
  ];

  for (const { key, value, labels, isExclude } of listChips) {
    if (!value) continue;
    for (const entry of value.split(',').map((v) => v.trim()).filter(Boolean)) {
      chips.push(
        <FilterChip
          key={`${key}-${entry}`}
          label={labels[entry] ?? entry}
          isExclude={isExclude}
          onRemove={() => onFilterChange({ [key]: withoutValue(value, entry) } as Partial<RecommendationFilters>)}
        />,
      );
    }
  }

  if (filters.min_rating !== undefined || filters.max_rating !== undefined) {
    chips.push(
      <FilterChip
        key="rating"
        label={rangeLabel('Rating', filters.min_rating, filters.max_rating, (v) => v.toFixed(1))}
        onRemove={() => onFilterChange({ min_rating: undefined, max_rating: undefined })}
      />,
    );
  }

  if (filters.year_min !== undefined || filters.year_max !== undefined) {
    chips.push(
      <FilterChip
        key="year"
        label={rangeLabel('Year', filters.year_min, filters.year_max, String)}
        onRemove={() => onFilterChange({ year_min: undefined, year_max: undefined })}
      />,
    );
  }

  if (filters.min_votecount !== undefined || filters.max_votecount !== undefined) {
    chips.push(
      <FilterChip
        key="votes"
        label={rangeLabel('Votes', filters.min_votecount, filters.max_votecount, formatVotes)}
        onRemove={() => onFilterChange({ min_votecount: undefined, max_votecount: undefined })}
      />,
    );
  }

  // Tested against undefined rather than truthiness: band 0 is the easiest band, not "unset".
  if (filters.min_difficulty !== undefined || filters.max_difficulty !== undefined) {
    chips.push(
      <FilterChip
        key="difficulty"
        label={rangeLabel('Difficulty', filters.min_difficulty, filters.max_difficulty, difficultyName)}
        onRemove={() => onFilterChange({ min_difficulty: undefined, max_difficulty: undefined })}
      />,
    );
  }

  entities.forEach((entity) => {
    chips.push(
      <FilterChip
        key={`${entity.type}-${entity.id}`}
        label={getEntityDisplayName(entity, preference)}
        onRemove={() =>
          onEntitiesChange(
            entities.filter((item) => !(item.type === entity.type && item.id === entity.id)),
          )
        }
      />,
    );
  });

  if (!filters.japanese_only) {
    chips.push(
      <FilterChip
        key="japanese_only"
        label="Any Language"
        onRemove={() => onFilterChange({ japanese_only: true })}
      />,
    );
  }

  if (!filters.exclude_blacklist) {
    chips.push(
      <FilterChip
        key="blacklist"
        label="Blacklist Shown"
        onRemove={() => onFilterChange({ exclude_blacklist: true })}
      />,
    );
  }

  if (!filters.nsfw) {
    chips.push(
      <FilterChip key="nsfw" label="Adult Hidden" onRemove={() => onFilterChange({ nsfw: true })} />,
    );
  }

  if (filters.spoiler_level > 0) {
    chips.push(
      <FilterChip
        key="spoiler"
        label={filters.spoiler_level === 1 ? 'Minor Spoilers' : 'Major Spoilers'}
        onRemove={() => onFilterChange({ spoiler_level: 0 })}
      />,
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips}
      <button type="button" onClick={onClearAll} className="rc-btn">
        Clear filters
      </button>
    </div>
  );
}

function FilterChip({
  label,
  onRemove,
  isExclude,
}: {
  label: string;
  onRemove: () => void;
  isExclude?: boolean;
}) {
  return (
    <span className={`rc-chip ${isExclude ? 'rc-chip--off' : 'rc-chip--on'}`}>
      {isExclude && <Minus aria-hidden className="w-3 h-3" />}
      <span className={isExclude ? 'line-through' : ''}>{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="rc-chip-btn"
        aria-label={`Remove ${label} filter`}
      >
        <X aria-hidden className="w-3 h-3" />
      </button>
    </span>
  );
}

function TagTraitChip({
  item,
  onRemove,
  onToggleMode,
}: {
  item: SelectedItem;
  onRemove: () => void;
  onToggleMode: () => void;
}) {
  const isExclude = item.mode === 'exclude';

  return (
    <span className={`rc-chip ${isExclude ? 'rc-chip--off' : 'rc-chip--on'}`}>
      <button
        type="button"
        onClick={onToggleMode}
        className="rc-chip-btn"
        aria-label={isExclude ? `Include ${item.name}` : `Exclude ${item.name}`}
        title={isExclude ? 'Click to include' : 'Click to exclude'}
      >
        {isExclude ? <Minus aria-hidden className="w-3 h-3" /> : <Plus aria-hidden className="w-3 h-3" />}
      </button>

      {/* Which kind of thing is being filtered on, said rather than coded into a colour:
          the two lists are searched together and a name alone does not say which it came
          from. */}
      <span className="rc-kind">{item.type}</span>
      <span className={isExclude ? 'line-through' : ''}>{item.name}</span>

      <button
        type="button"
        onClick={onRemove}
        className="rc-chip-btn"
        aria-label={`Remove ${item.name} filter`}
      >
        <X aria-hidden className="w-3 h-3" />
      </button>
    </span>
  );
}
