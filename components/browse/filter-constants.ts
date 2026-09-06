import { SelectOption, SelectedValue } from './DropdownSelect';
import {
  PLATFORMS as ALL_PLATFORMS,
  PLATFORM_GROUPS,
  PLATFORM_SHORT_LABELS,
} from '@/lib/platforms';

// Shared filter option arrays and label maps used by CompactFilterBar, SidebarFilters, and ActiveFilterChips

export const LANGUAGES: SelectOption[] = [
  { value: 'ja', label: 'Japanese' },
  { value: 'en', label: 'English' },
  { value: 'zh-Hans', label: 'Chinese (Simp.)' },
  { value: 'zh-Hant', label: 'Chinese (Trad.)' },
  { value: 'ko', label: 'Korean' },
  { value: 'ru', label: 'Russian' },
  { value: 'es', label: 'Spanish' },
  { value: 'pt-br', label: 'Portuguese' },
  { value: 'de', label: 'German' },
  { value: 'fr', label: 'French' },
  { value: 'vi', label: 'Vietnamese' },
];

// Every platform VNDB records, grouped for a list this long. Derived from lib/platforms
// rather than listed again here, so partial copies of this map cannot drift apart.
export const PLATFORMS: SelectOption[] = PLATFORM_GROUPS.flatMap((group) =>
  ALL_PLATFORMS.filter((platform) => platform.group === group).map((platform) => ({
    value: platform.code,
    label: platform.label,
    group,
  })),
);

export const LENGTHS: SelectOption[] = [
  { value: 'very_short', label: 'Very Short (<2h)' },
  { value: 'short', label: 'Short (2-10h)' },
  { value: 'medium', label: 'Medium (10-30h)' },
  { value: 'long', label: 'Long (30-50h)' },
  { value: 'very_long', label: 'Very Long (50h+)' },
];

export const AGE_RATINGS: SelectOption[] = [
  { value: 'all_ages', label: 'All Ages' },
  { value: 'teen', label: 'Teen' },
  { value: 'adult', label: 'Adult (18+)' },
];

export const DEV_STATUS: SelectOption[] = [
  { value: '0', label: 'Finished' },
  { value: '1', label: 'In Development' },
  { value: '2', label: 'Cancelled' },
];

// Bounds for the shared range controls. Kept here rather than beside each slider so the
// same filter cannot cover a different span on one page than on another.
export const YEAR_RANGE = { min: 1990, max: new Date().getFullYear() };
export const RATING_RANGE = { min: 1, max: 10 };
export const VOTES_RANGE = { min: 0, max: 5000 };
// The difficulty bands run 0 to 5. Setting this range at all restricts the results to the
// titles whose script has been analysed, which is a small fraction of the database, so a
// control bound to it says so rather than appearing to filter the whole catalogue.
export const DIFFICULTY_RANGE = { min: 0, max: 5 };

// Derived label maps for ActiveFilterChips (value -> label)
function toLabelMap(options: SelectOption[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const opt of options) {
    map[opt.value] = opt.label;
  }
  return map;
}

/** Comma-separated include and exclude strings, as the multi-select carries them. */
export function parseSelected(
  includeStr: string | undefined,
  excludeStr: string | undefined,
): SelectedValue[] {
  const result: SelectedValue[] = [];

  if (includeStr) {
    includeStr.split(',').forEach(v => {
      const trimmed = v.trim();
      if (trimmed) result.push({ value: trimmed, mode: 'include' });
    });
  }

  if (excludeStr) {
    excludeStr.split(',').forEach(v => {
      const trimmed = v.trim();
      if (trimmed) result.push({ value: trimmed, mode: 'exclude' });
    });
  }

  return result;
}

/** The inverse of parseSelected: undefined for a side with nothing on it. */
export function toFilterStrings(selected: SelectedValue[]): { include: string | undefined; exclude: string | undefined } {
  const includes = selected.filter(s => s.mode === 'include').map(s => s.value);
  const excludes = selected.filter(s => s.mode === 'exclude').map(s => s.value);

  return {
    include: includes.length > 0 ? includes.join(',') : undefined,
    exclude: excludes.length > 0 ? excludes.join(',') : undefined,
  };
}

export const LANGUAGE_LABELS = toLabelMap(LANGUAGES);
export const PLATFORM_LABELS = PLATFORM_SHORT_LABELS;
export const LENGTH_LABELS = toLabelMap(LENGTHS);
export const AGE_LABELS = toLabelMap(AGE_RATINGS);
export const STATUS_LABELS = toLabelMap(DEV_STATUS);
