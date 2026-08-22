/**
 * The Japanese reading-difficulty scale, in one place.
 *
 * jiten publishes both a continuous value and the integer band it falls in, and the bands are
 * whole numbers: a raw 2.67 is band 2. The boundaries below are the upstream's own rather
 * than a local approximation of them, and every surface that names a band reads from here, so
 * one title cannot be called Easy on one page and Intermediate on another.
 *
 * Coverage is a small fraction of the database. Absent difficulty means "not measured", never
 * "easy", and callers must render the gap rather than defaulting it to a band.
 */

export interface DifficultyBand {
  /** The integer band, matching the upstream's own. */
  band: number;
  label: string;
  /** Hex, for chart fills that cannot take a class. */
  color: string;
  /** Tailwind background, for badges. */
  badgeClass: string;
}

export const DIFFICULTY_BANDS: DifficultyBand[] = [
  { band: 0, label: 'Beginner', color: '#22c55e', badgeClass: 'bg-emerald-600/90' },
  { band: 1, label: 'Easy', color: '#4ade80', badgeClass: 'bg-green-600/90' },
  { band: 2, label: 'Intermediate', color: '#3b82f6', badgeClass: 'bg-sky-600/90' },
  { band: 3, label: 'Hard', color: '#f59e0b', badgeClass: 'bg-amber-600/90' },
  { band: 4, label: 'Very hard', color: '#f97316', badgeClass: 'bg-orange-600/90' },
  { band: 5, label: 'Expert', color: '#ef4444', badgeClass: 'bg-red-600/90' },
];

const LAST_BAND = DIFFICULTY_BANDS[DIFFICULTY_BANDS.length - 1];

/**
 * The band a raw difficulty falls in.
 *
 * Prefer the stored band where one is available; this is for the paths that only carry the
 * raw value. Anything above the top band is clamped to it rather than left unlabelled.
 */
export function difficultyBand(raw: number | null | undefined): DifficultyBand | null {
  if (raw === null || raw === undefined || Number.isNaN(raw)) return null;
  return DIFFICULTY_BANDS[Math.floor(raw)] ?? LAST_BAND;
}

export function difficultyLabel(raw: number | null | undefined): string | null {
  return difficultyBand(raw)?.label ?? null;
}

export function difficultyColor(raw: number | null | undefined): string {
  return difficultyBand(raw)?.color ?? '#9ca3af';
}
