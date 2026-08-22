/**
 * The axes a ranking can be narrowed by, and the presets that fill them in.
 *
 * Only display material lives here. Every option's value is the code the backend already
 * stores, so nothing in this file defines what a slice means: it defines what a reader is
 * offered and what each option is called.
 */

import { PLATFORMS } from '@/lib/platforms';

export interface SliceState {
  subject: 'vns' | 'readers';
  question: string;
  tag: number | null;
  tagName: string | null;
  yearMin: number | null;
  yearMax: number | null;
  platform: string | null;
  length: number | null;
  minage: number | null;
  difficulty: 'any' | 'beginner' | 'advanced';
  /** 'ja-only' is Japanese with no release in any other language. */
  olang: 'ja' | 'any' | 'ja-only';
  free: 'any' | 'free' | 'ja';
  /** Ceiling on VNDB's vote count, which is how "barely read" is expressed. */
  votesMax: number | null;
  /** Only for the as-of question, where the year is the question rather than a filter. */
  asOf: number | null;
}

export const EMPTY_SLICE: SliceState = {
  subject: 'vns',
  question: 'rated',
  tag: null,
  tagName: null,
  yearMin: null,
  yearMax: null,
  platform: null,
  length: null,
  minage: null,
  difficulty: 'any',
  olang: 'ja',
  free: 'any',
  votesMax: null,
  asOf: null,
};

// VNDB's category for tags describing an individual adult scene. A ranking of named readers
// may not be narrowed to one: how much of a person's reading carries such a tag is an
// inference about that person, and these pages are public. The service refuses the
// combination on its own; this keeps the picker from offering it.
export const ADULT_SCENE_TAG_CATEGORIES: readonly string[] = ['ero'];

/**
 * Length as VNDB records it, which is a 1-5 category rather than an hour count.
 *
 * Under half the database carries one, so the label says what is being asked rather than
 * implying every title has an answer.
 */
export const LENGTH_OPTIONS = [
  { value: 1, label: 'Very short, under 2 hours' },
  { value: 2, label: 'Short, 2 to 10 hours' },
  { value: 3, label: 'Medium, 10 to 30 hours' },
  { value: 4, label: 'Long, 30 to 50 hours' },
  { value: 5, label: 'Very long, over 50 hours' },
];

/**
 * Original language, with "never translated" folded in.
 *
 * It belongs here rather than as a checkbox of its own: a reader choosing a language is
 * already answering this question, and a title written in Japanese and released in no other
 * language is one idea rather than two independent filters.
 */
export const LANGUAGE_OPTIONS = [
  { value: 'ja', label: 'Japanese originals' },
  { value: 'ja-only', label: 'Japanese, never translated' },
  { value: 'any', label: 'Every language' },
] as const;

export const FREE_OPTIONS = [
  { value: 'any', label: 'Any price' },
  { value: 'free', label: 'Has a free release' },
  { value: 'ja', label: 'Free in Japanese' },
] as const;

/**
 * How little attention a title can have drawn and still be ranked.
 *
 * A ceiling rather than a floor, because the interesting question is the hidden-gem one:
 * what is well regarded among the titles almost nobody has voted on.
 */
export const ATTENTION_OPTIONS = [
  { value: '', label: 'Any number of votes' },
  { value: '100', label: '100 votes or fewer' },
  { value: '50', label: '50 votes or fewer' },
  { value: '20', label: '20 votes or fewer' },
];

export const AGE_OPTIONS = [
  { value: 15, label: 'All-ages, rated 15 or under' },
  { value: 17, label: 'Nothing rated 18+' },
  { value: 0, label: 'Rated 0 only' },
];

/**
 * The two ends of the measured difficulty scale, as bands rather than numbers.
 *
 * A reader picking a difficulty is choosing between "something I can get through" and
 * "something that will fight back", not a decimal. Both bands restrict the slice to titles
 * jiten.moe has analysed, which is a small part of the database.
 */
export const DIFFICULTY_BANDS = {
  any: { label: 'Any difficulty', min: null, max: null },
  beginner: { label: 'Beginner-level Japanese', min: null, max: 2.0 },
  advanced: { label: 'Advanced Japanese', min: 3.0, max: null },
} as const;

/** Platforms worth offering, in the order the filter list already uses. */
export const PLATFORM_OPTIONS = PLATFORMS.map((platform) => ({
  value: platform.code,
  label: platform.label,
  group: platform.group,
}));

/** Release years the range selectors offer, newest first. */
export function releaseYears(): number[] {
  const now = new Date().getUTCFullYear();
  const years: number[] = [];
  for (let year = now; year >= 1980; year -= 1) years.push(year);
  return years;
}

/**
 * Years a "what did the community think then" ranking can be asked about.
 *
 * Stops short of the present because a ranking taken a few months back is the current one
 * with fewer votes, which says nothing about how opinion moved.
 */
export function judgedYears(): number[] {
  const now = new Date().getUTCFullYear();
  const years: number[] = [];
  for (let year = now - 2; year >= 2005; year -= 1) years.push(year);
  return years;
}

export interface Preset {
  label: string;
  /** What it fills in. Anything unset is cleared, so a preset is a whole state. */
  slice: Partial<SliceState>;
  /**
   * Shown on the rankings page as well as here.
   *
   * The full set is long enough to read as a wall on a page whose job is to introduce the
   * idea, so that page takes a spread across the groups and the builder itself carries the
   * rest.
   */
  featured?: boolean;
}

/**
 * Starting points, not a menu of the only answers.
 *
 * These are the slices worth offering by name. Kept as chips rather than pages
 * because the point of the picker is that a slice is a choice: landing on one and seeing the
 * controls already filled in says the reader can change it, which a fixed URL does not.
 */
export const PRESETS: { group: string; items: Preset[] }[] = [
  {
    group: 'Overall',
    items: [
      { label: 'Highest rated', featured: true, slice: { olang: 'any' } },
      { label: 'Most voted on', featured: true, slice: { question: 'voted', olang: 'any' } },
      { label: 'Most divisive', featured: true, slice: { question: 'divisive', olang: 'any' } },
      { label: 'Hidden gems', featured: true, slice: { olang: 'any', votesMax: 100 } },
      { label: 'Most finished', slice: { question: 'finished', olang: 'any' } },
      { label: 'Most given up on', slice: { question: 'dropped', olang: 'any' } },
      { label: 'Most wishlisted', slice: { question: 'wishlisted', olang: 'any' } },
      { label: 'Aged best', slice: { question: 'aged-up', olang: 'any' } },
      { label: 'Did not last', slice: { question: 'aged-down', olang: 'any' } },
    ],
  },
  {
    group: 'By era',
    items: [
      { label: 'Best of the 1990s', featured: true, slice: { yearMin: 1990, yearMax: 1999 } },
      { label: 'Best of the 2000s', slice: { yearMin: 2000, yearMax: 2009 } },
      { label: 'Best of the 2010s', slice: { yearMin: 2010, yearMax: 2019 } },
      { label: 'Best of the 2020s', featured: true, slice: { yearMin: 2020, yearMax: 2029 } },
      { label: 'As judged in 2010', featured: true, slice: { question: 'as-of', asOf: 2010 } },
      { label: 'As judged in 2015', slice: { question: 'as-of', asOf: 2015 } },
    ],
  },
  {
    group: 'By kind',
    items: [
      { label: 'Best on the PC-98', featured: true, slice: { platform: 'p98', olang: 'any' } },
      { label: 'Best short reads', featured: true, slice: { length: 1 } },
      { label: 'Best long reads', slice: { length: 5 } },
      { label: 'Best all-ages', slice: { minage: 15 } },
      { label: 'Best freeware', slice: { free: 'ja' } },
      { label: 'Best never translated', slice: { olang: 'ja-only' } },
    ],
  },
  {
    group: 'By Japanese',
    items: [
      { label: 'Easiest Japanese', featured: true, slice: { question: 'easiest' } },
      { label: 'Hardest Japanese', slice: { question: 'hardest' } },
      { label: 'Best beginner reads', featured: true, slice: { difficulty: 'beginner' } },
      {
        label: 'Most Japanese read',
        featured: true,
        slice: { subject: 'readers', question: 'characters' },
      },
    ],
  },
  {
    group: 'Readers',
    items: [
      {
        label: 'Most votes cast',
        featured: true,
        slice: { subject: 'readers', question: 'read-most', olang: 'any' },
      },
      {
        label: 'Read the most pre-2000',
        featured: true,
        slice: { subject: 'readers', question: 'read-most', yearMax: 1999, olang: 'any' },
      },
      {
        label: 'Libraries made of pre-2000',
        slice: { subject: 'readers', question: 'share', yearMax: 1999, olang: 'any' },
      },
      {
        label: 'Read the most PC-98',
        slice: { subject: 'readers', question: 'read-most', platform: 'p98', olang: 'any' },
      },
      {
        label: 'Libraries built on the PC-98',
        featured: true,
        slice: { subject: 'readers', question: 'share', platform: 'p98', olang: 'any' },
      },
      {
        label: 'Read the most never translated',
        slice: { subject: 'readers', question: 'read-most', olang: 'ja-only' },
      },
      {
        label: 'Read the most freeware',
        slice: { subject: 'readers', question: 'read-most', free: 'ja' },
      },
      {
        label: 'Biggest readers of Otome',
        featured: true,
        slice: { subject: 'readers', question: 'read-most', tag: 542, tagName: 'Otome Game' },
      },
      {
        label: 'Libraries built on Nakige',
        slice: { subject: 'readers', question: 'share', tag: 596, tagName: 'Nakige' },
      },
      {
        label: 'Readers of full-screen text',
        slice: { subject: 'readers', question: 'share', tag: 43, tagName: 'NVL', olang: 'any' },
      },
    ],
  },
];

/** Turn the picker's state into the query the API takes. */
export function toQuery(slice: SliceState) {
  const band = DIFFICULTY_BANDS[slice.difficulty];
  return {
    subject: slice.subject,
    question: slice.question,
    olang: slice.olang === 'ja-only' ? 'ja' : slice.olang,
    lang_only: slice.olang === 'ja-only' ? 'ja' : null,
    free: slice.free === 'any' ? null : slice.free,
    votecount_max: slice.votesMax,
    tag: slice.tag,
    year_min: slice.yearMin,
    year_max: slice.yearMax,
    platform: slice.platform,
    length: slice.length,
    minage_max: slice.minage ?? undefined,
    difficulty_min: band.min,
    difficulty_max: band.max,
    year: slice.question === 'as-of' ? slice.asOf : null,
  };
}

/** The URL a slice is shareable at, which is the same state written down. */
export function toSearchParams(slice: SliceState): string {
  const params = new URLSearchParams();
  if (slice.subject !== 'vns') params.set('subject', slice.subject);
  if (slice.question !== 'rated') params.set('question', slice.question);
  if (slice.tag) {
    params.set('tag', String(slice.tag));
    if (slice.tagName) params.set('name', slice.tagName);
  }
  if (slice.yearMin) params.set('from', String(slice.yearMin));
  if (slice.yearMax) params.set('to', String(slice.yearMax));
  if (slice.platform) params.set('platform', slice.platform);
  if (slice.length) params.set('length', String(slice.length));
  if (slice.minage !== null) params.set('age', String(slice.minage));
  if (slice.difficulty !== 'any') params.set('difficulty', slice.difficulty);
  if (slice.olang !== 'ja') params.set('olang', slice.olang);
  if (slice.free !== 'any') params.set('free', slice.free);
  if (slice.votesMax) params.set('votes_max', String(slice.votesMax));
  if (slice.asOf) params.set('year', String(slice.asOf));
  return params.toString();
}

/** Read a slice back out of a URL, ignoring anything it does not recognise. */
export function fromSearchParams(params: URLSearchParams): SliceState {
  const number = (key: string): number | null => {
    const raw = params.get(key);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  const difficulty = params.get('difficulty');
  return {
    ...EMPTY_SLICE,
    subject: params.get('subject') === 'readers' ? 'readers' : 'vns',
    question: params.get('question') ?? 'rated',
    tag: number('tag'),
    tagName: params.get('name'),
    yearMin: number('from'),
    yearMax: number('to'),
    platform: params.get('platform'),
    length: number('length'),
    minage: number('age'),
    difficulty:
      difficulty === 'beginner' || difficulty === 'advanced' ? difficulty : 'any',
    olang:
      params.get('olang') === 'any'
        ? 'any'
        : params.get('olang') === 'ja-only'
          ? 'ja-only'
          : 'ja',
    free:
      params.get('free') === 'free' ? 'free' : params.get('free') === 'ja' ? 'ja' : 'any',
    votesMax: number('votes_max'),
    asOf: number('year'),
  };
}

/** Every axis currently narrowing the slice, for the row of removable chips. */
export function activeAxes(slice: SliceState): { key: keyof SliceState; label: string }[] {
  const axes: { key: keyof SliceState; label: string }[] = [];
  if (slice.tag) axes.push({ key: 'tag', label: slice.tagName ?? `Tag ${slice.tag}` });
  if (slice.yearMin || slice.yearMax) {
    const from = slice.yearMin ?? 1980;
    const to = slice.yearMax ?? new Date().getUTCFullYear();
    axes.push({ key: 'yearMin', label: from === to ? `${from}` : `${from} to ${to}` });
  }
  if (slice.platform) {
    const found = PLATFORM_OPTIONS.find((option) => option.value === slice.platform);
    axes.push({ key: 'platform', label: found?.label ?? slice.platform });
  }
  if (slice.length) {
    const found = LENGTH_OPTIONS.find((option) => option.value === slice.length);
    axes.push({ key: 'length', label: found?.label.split(',')[0] ?? `Length ${slice.length}` });
  }
  if (slice.minage !== null) {
    const found = AGE_OPTIONS.find((option) => option.value === slice.minage);
    axes.push({ key: 'minage', label: found?.label ?? `Rated ${slice.minage} or under` });
  }
  if (slice.difficulty !== 'any') {
    axes.push({ key: 'difficulty', label: DIFFICULTY_BANDS[slice.difficulty].label });
  }
  if (slice.olang === 'any') axes.push({ key: 'olang', label: 'Every language' });
  if (slice.olang === 'ja-only') axes.push({ key: 'olang', label: 'Never translated' });
  if (slice.free !== 'any') {
    const found = FREE_OPTIONS.find((option) => option.value === slice.free);
    axes.push({ key: 'free', label: found?.label ?? 'Free' });
  }
  if (slice.votesMax) {
    axes.push({ key: 'votesMax', label: `${slice.votesMax} votes or fewer` });
  }
  return axes;
}
