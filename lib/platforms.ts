/**
 * Every platform VNDB records, in one place.
 *
 * Codes are VNDB's own, confirmed against the enums in their API schema. Every surface that
 * names a platform reads from here, so a platform is spelled the same way wherever it
 * appears.
 *
 * Two labels per platform, because the surfaces genuinely want different things. A badge
 * beside a cover has room for "PS4"; a filter list someone is scanning for their platform
 * needs "PlayStation 4". Only the code is data, and only the code is ever stored.
 */

export type PlatformGroup =
  | 'Computer'
  | 'Japanese computers'
  | 'Console'
  | 'Handheld'
  | 'Mobile'
  | 'Other';

/**
 * Group order in the filter list. Japanese computers sit high deliberately: this site is
 * about Japanese visual novels, and PC-98 is a category its readers actively look for.
 */
export const PLATFORM_GROUPS: PlatformGroup[] = [
  'Computer',
  'Japanese computers',
  'Console',
  'Handheld',
  'Mobile',
  'Other',
];

export interface PlatformInfo {
  code: string;
  /** Full name, for a filter list being read. */
  label: string;
  /** Compact name, for a badge or a chip. */
  short: string;
  group: PlatformGroup;
}

export const PLATFORMS: PlatformInfo[] = [
  { code: 'win', label: 'Windows', short: 'Windows', group: 'Computer' },
  { code: 'mac', label: 'macOS', short: 'macOS', group: 'Computer' },
  { code: 'lin', label: 'Linux', short: 'Linux', group: 'Computer' },
  { code: 'dos', label: 'DOS', short: 'DOS', group: 'Computer' },

  { code: 'p98', label: 'PC-98', short: 'PC-98', group: 'Japanese computers' },
  { code: 'p88', label: 'PC-88', short: 'PC-88', group: 'Japanese computers' },
  { code: 'x68', label: 'Sharp X68000', short: 'X68000', group: 'Japanese computers' },
  { code: 'x1s', label: 'Sharp X1', short: 'Sharp X1', group: 'Japanese computers' },
  { code: 'fmt', label: 'FM Towns', short: 'FM Towns', group: 'Japanese computers' },
  { code: 'fm7', label: 'FM-7', short: 'FM-7', group: 'Japanese computers' },
  { code: 'fm8', label: 'FM-8', short: 'FM-8', group: 'Japanese computers' },
  { code: 'msx', label: 'MSX', short: 'MSX', group: 'Japanese computers' },

  { code: 'ps1', label: 'PlayStation', short: 'PS1', group: 'Console' },
  { code: 'ps2', label: 'PlayStation 2', short: 'PS2', group: 'Console' },
  { code: 'ps3', label: 'PlayStation 3', short: 'PS3', group: 'Console' },
  { code: 'ps4', label: 'PlayStation 4', short: 'PS4', group: 'Console' },
  { code: 'ps5', label: 'PlayStation 5', short: 'PS5', group: 'Console' },
  { code: 'swi', label: 'Nintendo Switch', short: 'Switch', group: 'Console' },
  { code: 'sw2', label: 'Nintendo Switch 2', short: 'Switch 2', group: 'Console' },
  { code: 'wii', label: 'Nintendo Wii', short: 'Wii', group: 'Console' },
  { code: 'wiu', label: 'Nintendo Wii U', short: 'Wii U', group: 'Console' },
  { code: 'nes', label: 'Famicom', short: 'Famicom', group: 'Console' },
  { code: 'sfc', label: 'Super Famicom', short: 'Super Famicom', group: 'Console' },
  { code: 'xb1', label: 'Xbox', short: 'Xbox', group: 'Console' },
  { code: 'xb3', label: 'Xbox 360', short: 'Xbox 360', group: 'Console' },
  { code: 'xbo', label: 'Xbox One', short: 'Xbox One', group: 'Console' },
  { code: 'xxs', label: 'Xbox Series X/S', short: 'Xbox X/S', group: 'Console' },
  { code: 'drc', label: 'Dreamcast', short: 'Dreamcast', group: 'Console' },
  { code: 'sat', label: 'Sega Saturn', short: 'Saturn', group: 'Console' },
  { code: 'smd', label: 'Sega Mega Drive', short: 'Mega Drive', group: 'Console' },
  { code: 'scd', label: 'Sega Mega-CD', short: 'Mega-CD', group: 'Console' },
  { code: 'pce', label: 'PC Engine', short: 'PC Engine', group: 'Console' },
  { code: 'pcf', label: 'PC-FX', short: 'PC-FX', group: 'Console' },
  { code: 'tdo', label: '3DO', short: '3DO', group: 'Console' },

  { code: 'psp', label: 'PlayStation Portable', short: 'PSP', group: 'Handheld' },
  { code: 'psv', label: 'PlayStation Vita', short: 'PS Vita', group: 'Handheld' },
  { code: 'nds', label: 'Nintendo DS', short: 'Nintendo DS', group: 'Handheld' },
  { code: 'n3d', label: 'Nintendo 3DS', short: '3DS', group: 'Handheld' },
  { code: 'gba', label: 'Game Boy Advance', short: 'GBA', group: 'Handheld' },
  { code: 'gbc', label: 'Game Boy Color', short: 'Game Boy Color', group: 'Handheld' },

  { code: 'and', label: 'Android', short: 'Android', group: 'Mobile' },
  // VNDB calls this "Apple iProduct"; nobody scanning a filter list looks for that.
  { code: 'ios', label: 'iOS', short: 'iOS', group: 'Mobile' },
  { code: 'mob', label: 'Other mobile', short: 'Mobile', group: 'Mobile' },

  { code: 'web', label: 'Browser', short: 'Web', group: 'Other' },
  { code: 'dvd', label: 'DVD Player', short: 'DVD', group: 'Other' },
  { code: 'bdp', label: 'Blu-ray Player', short: 'Blu-ray', group: 'Other' },
  // A visual novel reader that runs on the Nintendo DS, not the hardware itself.
  { code: 'vnd', label: 'VNDS', short: 'VNDS', group: 'Other' },
  { code: 'oth', label: 'Other', short: 'Other', group: 'Other' },
];

function toMap(pick: (p: PlatformInfo) => string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const platform of PLATFORMS) map[platform.code] = pick(platform);
  return map;
}

/** Compact names, for badges and filter chips. */
export const PLATFORM_SHORT_LABELS = toMap((p) => p.short);

/** Full names, for lists being read rather than glanced at. */
export const PLATFORM_FULL_LABELS = toMap((p) => p.label);

/** A code the dump carries but this list does not should still render as something. */
export function platformLabel(code: string, full = false): string {
  return (full ? PLATFORM_FULL_LABELS : PLATFORM_SHORT_LABELS)[code] || code;
}
