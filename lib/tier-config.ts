// Stable empty array to avoid new-reference re-renders in memoized components
export const EMPTY_STRING_ARRAY: readonly string[] = [];

// === Types ===

export type TierListMode = 'vns' | 'characters';

export interface TierDef {
  id: string;
  label: string;
  color: string;       // Tailwind bg class
  textColor: string;   // Tailwind text class
  noAutoSort?: boolean; // true for user-added tiers — excluded from VNDB import auto-distribution
}

export interface TierVN {
  id: string;
  title: string;
  titleJp?: string;
  titleRomaji?: string;
  customTitle?: string;
  imageUrl: string | null;
  imageSexual: number | null;
  defaultImageUrl?: string | null;
  vote?: number;
}

export type DisplayMode = 'covers' | 'titles';

// === Thumbnail sizes ===

export type ThumbnailSize = 'sm' | 'md' | 'lg';

export interface SizeConfig {
  coverClass: string;
  overlayClass: string;
  rowMinH: string;
  rowGap: string;
  rowPad: string;
  scoreFontClass: string;
  scoreMinW: string;
  titleFontClass: string;
  noImageFontClass: string;
  actionBtnClass: string;
  actionIconClass: string;
  editBtnTopClass: string;
  coverSizes: string;
  export: {
    itemW: number;
    itemH: number;
    minRowH: number;
    gap: number;
    pad: number;
    scoreFontSize: number;
    titleFontSize: number;
    titleBarH: number;
  };
}

export const THUMBNAIL_SIZES: Record<ThumbnailSize, SizeConfig> = {
  sm: {
    coverClass: 'w-[48px] h-[66px] sm:w-[56px] sm:h-[77px]',
    overlayClass: 'w-[48px] h-[66px] sm:w-[56px] sm:h-[77px]',
    rowMinH: 'min-h-[74px] sm:min-h-[85px]',
    rowGap: 'gap-0.5 sm:gap-1',
    rowPad: 'p-0.5 sm:p-1',
    scoreFontClass: 'text-[7px] sm:text-[8px]',
    scoreMinW: 'min-w-[16px]',
    titleFontClass: 'text-[7px] sm:text-[8px]',
    noImageFontClass: 'text-[8px]',
    actionBtnClass: 'w-4 h-4',
    actionIconClass: 'w-2.5 h-2.5',
    editBtnTopClass: 'top-[22px]',
    coverSizes: '56px',
    export: { itemW: 88, itemH: 121, minRowH: 133, gap: 3, pad: 5, scoreFontSize: 11, titleFontSize: 12, titleBarH: 26 },
  },
  md: {
    coverClass: 'w-[64px] h-[88px] sm:w-[76px] sm:h-[105px]',
    overlayClass: 'w-[64px] h-[88px] sm:w-[76px] sm:h-[105px]',
    rowMinH: 'min-h-[96px] sm:min-h-[113px]',
    rowGap: 'gap-1 sm:gap-1.5',
    rowPad: 'p-1 sm:p-1.5',
    scoreFontClass: 'text-[8px] sm:text-[9px]',
    scoreMinW: 'min-w-[18px]',
    titleFontClass: 'text-[8px] sm:text-[9px]',
    noImageFontClass: 'text-[9px]',
    actionBtnClass: 'w-4.5 h-4.5',
    actionIconClass: 'w-3 h-3',
    editBtnTopClass: 'top-[24px]',
    coverSizes: '76px',
    export: { itemW: 118, itemH: 163, minRowH: 175, gap: 4, pad: 6, scoreFontSize: 13, titleFontSize: 14, titleBarH: 32 },
  },
  lg: {
    coverClass: 'w-[84px] h-[116px] sm:w-[100px] sm:h-[138px]',
    overlayClass: 'w-[84px] h-[116px] sm:w-[100px] sm:h-[138px]',
    rowMinH: 'min-h-[124px] sm:min-h-[146px]',
    rowGap: 'gap-1 sm:gap-2',
    rowPad: 'p-1 sm:p-2',
    scoreFontClass: 'text-[9px] sm:text-[10px]',
    scoreMinW: 'min-w-[20px]',
    titleFontClass: 'text-[9px] sm:text-[10px]',
    noImageFontClass: 'text-[10px]',
    actionBtnClass: 'w-5 h-5',
    actionIconClass: 'w-3 h-3',
    editBtnTopClass: 'top-[26px]',
    coverSizes: '100px',
    export: { itemW: 155, itemH: 214, minRowH: 226, gap: 5, pad: 8, scoreFontSize: 15, titleFontSize: 16, titleBarH: 38 },
  },
};

const THUMBNAIL_SIZES_SQUARE: Record<ThumbnailSize, SizeConfig> = {
  sm: {
    ...THUMBNAIL_SIZES.sm,
    coverClass: 'w-[48px] h-[48px] sm:w-[56px] sm:h-[56px]',
    overlayClass: 'w-[48px] h-[48px] sm:w-[56px] sm:h-[56px]',
    rowMinH: 'min-h-[56px] sm:min-h-[64px]',
    editBtnTopClass: 'top-[18px]',
    export: { ...THUMBNAIL_SIZES.sm.export, itemH: 88, minRowH: 100 },
  },
  md: {
    ...THUMBNAIL_SIZES.md,
    coverClass: 'w-[64px] h-[64px] sm:w-[76px] sm:h-[76px]',
    overlayClass: 'w-[64px] h-[64px] sm:w-[76px] sm:h-[76px]',
    rowMinH: 'min-h-[72px] sm:min-h-[84px]',
    editBtnTopClass: 'top-[20px]',
    export: { ...THUMBNAIL_SIZES.md.export, itemH: 118, minRowH: 130 },
  },
  lg: {
    ...THUMBNAIL_SIZES.lg,
    coverClass: 'w-[84px] h-[84px] sm:w-[100px] sm:h-[100px]',
    overlayClass: 'w-[84px] h-[84px] sm:w-[100px] sm:h-[100px]',
    rowMinH: 'min-h-[92px] sm:min-h-[108px]',
    editBtnTopClass: 'top-[22px]',
    export: { ...THUMBNAIL_SIZES.lg.export, itemH: 155, minRowH: 167 },
  },
};

export function getSizeConfig(size: ThumbnailSize, cropSquare: boolean): SizeConfig {
  return cropSquare ? THUMBNAIL_SIZES_SQUARE[size] : THUMBNAIL_SIZES[size];
}

// === Color presets ===

export interface TierColor {
  id: string;
  color: string;
  textColor: string;
}

export const TIER_COLORS: TierColor[] = [
  { id: 'red', color: 'bg-red-400', textColor: 'text-red-950' },
  { id: 'orange', color: 'bg-orange-400', textColor: 'text-orange-950' },
  { id: 'amber', color: 'bg-amber-400', textColor: 'text-amber-950' },
  { id: 'yellow', color: 'bg-yellow-300', textColor: 'text-yellow-950' },
  { id: 'lime', color: 'bg-lime-400', textColor: 'text-lime-950' },
  { id: 'green', color: 'bg-green-400', textColor: 'text-green-950' },
  { id: 'teal', color: 'bg-teal-400', textColor: 'text-teal-950' },
  { id: 'blue', color: 'bg-blue-400', textColor: 'text-blue-950' },
  { id: 'purple', color: 'bg-purple-400', textColor: 'text-purple-950' },
  { id: 'pink', color: 'bg-pink-400', textColor: 'text-pink-950' },
  { id: 'gray', color: 'bg-gray-300 dark:bg-gray-600', textColor: 'text-gray-700 dark:text-gray-200' },
];

// === Defaults ===

let _idCounter = 0;
export function generateTierId(): string {
  return `tier-${Date.now()}-${_idCounter++}`;
}

export const DEFAULT_TIER_DEFS: TierDef[] = [
  { id: 'S', label: 'S', color: 'bg-amber-400', textColor: 'text-amber-950' },
  { id: 'A', label: 'A', color: 'bg-green-400', textColor: 'text-green-950' },
  { id: 'B', label: 'B', color: 'bg-blue-400', textColor: 'text-blue-950' },
  { id: 'C', label: 'C', color: 'bg-yellow-300', textColor: 'text-yellow-950' },
  { id: 'D', label: 'D', color: 'bg-orange-400', textColor: 'text-orange-950' },
  { id: 'F', label: 'F', color: 'bg-red-400', textColor: 'text-red-950' },
];

// === Presets ===

export interface TierPreset {
  id: string;
  label: string;
  tiers: TierDef[];
}

export const TIER_PRESETS: TierPreset[] = [
  {
    id: 'saf',
    label: 'S–F',
    tiers: DEFAULT_TIER_DEFS,
  },
  {
    id: '1-5',
    label: '1–5',
    tiers: [
      { id: '5', label: '5', color: 'bg-green-400', textColor: 'text-green-950' },
      { id: '4', label: '4', color: 'bg-lime-400', textColor: 'text-lime-950' },
      { id: '3', label: '3', color: 'bg-yellow-300', textColor: 'text-yellow-950' },
      { id: '2', label: '2', color: 'bg-orange-400', textColor: 'text-orange-950' },
      { id: '1', label: '1', color: 'bg-red-400', textColor: 'text-red-950' },
    ],
  },
  {
    id: '1-10',
    label: '1–10',
    tiers: [
      { id: '10', label: '10', color: 'bg-green-400', textColor: 'text-green-950' },
      { id: '9', label: '9', color: 'bg-teal-400', textColor: 'text-teal-950' },
      { id: '8', label: '8', color: 'bg-lime-400', textColor: 'text-lime-950' },
      { id: '7', label: '7', color: 'bg-yellow-300', textColor: 'text-yellow-950' },
      { id: '6', label: '6', color: 'bg-amber-400', textColor: 'text-amber-950' },
      { id: '5', label: '5', color: 'bg-orange-400', textColor: 'text-orange-950' },
      { id: '4', label: '4', color: 'bg-red-400', textColor: 'text-red-950' },
      { id: '3', label: '3', color: 'bg-pink-400', textColor: 'text-pink-950' },
      { id: '2', label: '2', color: 'bg-purple-400', textColor: 'text-purple-950' },
      { id: '1', label: '1', color: 'bg-blue-400', textColor: 'text-blue-950' },
    ],
  },
  {
    id: '10-100',
    label: '10–100',
    tiers: [
      { id: '91-100', label: '91–100', color: 'bg-green-400', textColor: 'text-green-950' },
      { id: '81-90', label: '81–90', color: 'bg-teal-400', textColor: 'text-teal-950' },
      { id: '71-80', label: '71–80', color: 'bg-lime-400', textColor: 'text-lime-950' },
      { id: '61-70', label: '61–70', color: 'bg-yellow-300', textColor: 'text-yellow-950' },
      { id: '51-60', label: '51–60', color: 'bg-amber-400', textColor: 'text-amber-950' },
      { id: '41-50', label: '41–50', color: 'bg-orange-400', textColor: 'text-orange-950' },
      { id: '31-40', label: '31–40', color: 'bg-red-400', textColor: 'text-red-950' },
      { id: '21-30', label: '21–30', color: 'bg-pink-400', textColor: 'text-pink-950' },
      { id: '10-20', label: '10–20', color: 'bg-gray-300 dark:bg-gray-600', textColor: 'text-gray-700 dark:text-gray-200' },
    ],
  },
];

// === Preset helpers ===

export function getPresetById(id: string): TierPreset | undefined {
  return TIER_PRESETS.find(p => p.id === id);
}

export function getCurrentPresetId(tierDefs: TierDef[]): string | null {
  for (const preset of TIER_PRESETS) {
    if (preset.tiers.length === tierDefs.length &&
        preset.tiers.every((t, i) => tierDefs[i]?.id === t.id)) {
      return preset.id;
    }
  }
  return null;
}

// === VNDB import helpers ===

/** Map a VNDB vote (10-100) to a tier ID based on current tier definitions */
export function getAutoTierForDefs(tierDefs: TierDef[], vote: number | undefined): string {
  const lastId = tierDefs[tierDefs.length - 1]?.id ?? '';
  if (!vote || tierDefs.length === 0) return lastId;

  const n = tierDefs.length;
  const clamped = Math.min(100, Math.max(10, vote));
  // Divide the actual 10-100 range (90 points) into n equal buckets.
  const bucketWidth = 90 / n;
  const fromTop = Math.floor((100 - clamped) / bucketWidth);
  return tierDefs[Math.min(n - 1, fromTop)].id;
}
