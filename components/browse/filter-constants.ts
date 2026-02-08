import { SelectOption } from './DropdownSelect';

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

export const PLATFORMS: SelectOption[] = [
  { value: 'win', label: 'Windows' },
  { value: 'lin', label: 'Linux' },
  { value: 'mac', label: 'Mac' },
  { value: 'web', label: 'Web' },
  { value: 'and', label: 'Android' },
  { value: 'ios', label: 'iOS' },
  { value: 'swi', label: 'Switch' },
  { value: 'ps4', label: 'PS4' },
  { value: 'ps5', label: 'PS5' },
  { value: 'psv', label: 'PS Vita' },
];

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

// Derived label maps for ActiveFilterChips (value -> label)
function toLabelMap(options: SelectOption[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const opt of options) {
    map[opt.value] = opt.label;
  }
  return map;
}

export const LANGUAGE_LABELS = toLabelMap(LANGUAGES);
export const PLATFORM_LABELS = toLabelMap(PLATFORMS);
export const LENGTH_LABELS = toLabelMap(LENGTHS);
export const AGE_LABELS = toLabelMap(AGE_RATINGS);
export const STATUS_LABELS = toLabelMap(DEV_STATUS);
