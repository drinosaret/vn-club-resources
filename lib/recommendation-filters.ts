import type { SelectedItem } from '@/components/recommendations/TagTraitAutocomplete';
import {
  SignalWeights,
  formatWeightsParam,
  isDefaultWeights,
  parseWeightsParam,
} from '@/lib/recommendation-weights';

/**
 * The recommendation filter set, its query-string round-trip, and the request it builds.
 *
 * Names match the VN search endpoint so both surfaces speak one filter vocabulary, and the
 * page's own query string reuses those names again: a shared link is readable and reproduces
 * the exact result it was copied from.
 */

/** Producers have no autocomplete of their own; one arrives from a link and travels as an id. */
export type EntityFilterType = 'staff' | 'seiyuu' | 'developer' | 'publisher' | 'producer';

/** The types the entity autocomplete can offer, in the order its results are grouped. */
export const SEARCHABLE_ENTITY_TYPES: EntityFilterType[] = [
  'staff',
  'seiyuu',
  'developer',
  'publisher',
];

export interface RecommendationEntity {
  id: string;
  name: string;
  /** Romanised form where the catalogue has one; the chip picks between the two. */
  original?: string | null;
  type: EntityFilterType;
}

export interface RecommendationFilters {
  min_rating?: number;
  max_rating?: number;
  year_min?: number;
  year_max?: number;
  min_votecount?: number;
  max_votecount?: number;
  /** Difficulty bands, not raw scores. Setting either end restricts to analysed titles. */
  min_difficulty?: number;
  max_difficulty?: number;
  length?: string;
  exclude_length?: string;
  minage?: string;
  exclude_minage?: string;
  devstatus?: string;
  exclude_devstatus?: string;
  olang?: string;
  exclude_olang?: string;
  platform?: string;
  exclude_platform?: string;
  japanese_only: boolean;
  exclude_blacklist: boolean;
  spoiler_level: number;
  nsfw: boolean;
  /**
   * How closely the list is matched to how well known the reader's own titles are, 0 to 1.
   * Undefined leaves it to the deployment default. It narrows nothing, so it is deliberately
   * absent from the filter counts, the same as the weights.
   */
  discovery?: number;
}

export interface RecommendationFilterState {
  filters: RecommendationFilters;
  tagTraits: SelectedItem[];
  entities: RecommendationEntity[];
  /**
   * The reader's own balance between the eight scoring signals, or null for the default
   * one. It travels with the filters because it belongs to the same request and the same
   * link, but it narrows nothing: it changes how the candidates are ranked, not which of
   * them qualify, so it is deliberately absent from the filter counts.
   */
  weights: SignalWeights | null;
}

export const DEFAULT_FILTERS: RecommendationFilters = {
  japanese_only: true,
  exclude_blacklist: true,
  spoiler_level: 0,
  nsfw: true,
};

export const EMPTY_FILTER_STATE: RecommendationFilterState = {
  filters: DEFAULT_FILTERS,
  tagTraits: [],
  entities: [],
  weights: null,
};

/** How many tags, traits, or entities one request may carry. */
export const MAX_TAG_TRAIT_FILTERS = 10;
export const MAX_ENTITY_FILTERS = 10;

function readString(params: URLSearchParams, key: string): string | undefined {
  const raw = params.get(key);
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/** Empty and unparseable both read as unset. Zero does not: band 0 is the easiest band. */
function readNumber(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function readBoolean(params: URLSearchParams, key: string, fallback: boolean): boolean {
  const raw = params.get(key);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}

/**
 * Japanese-only and an explicit original-language choice are the same axis. The explicit
 * choice is the narrower of the two, so it wins wherever both are present. This mirrors
 * the rule the endpoint applies, and the two have to agree or a link reproduces a
 * different result than the page that produced it.
 *
 * An excluded language is not a choice of language: naming one to leave out says nothing
 * about which of the rest is wanted, so it leaves the shorthand standing.
 */
export function normalizeFilters(filters: RecommendationFilters): RecommendationFilters {
  if (filters.japanese_only && filters.olang) {
    return { ...filters, japanese_only: false };
  }
  return filters;
}

/** Tags and traits travel as "id:name" pairs so a shared link can label its own chips. */
function parseTagTraitParam(
  raw: string | null,
  type: 'tag' | 'trait',
  mode: 'include' | 'exclude',
): SelectedItem[] {
  if (!raw) return [];
  const items: SelectedItem[] = [];
  for (const entry of raw.split(',')) {
    const [id, ...nameParts] = entry.split(':');
    const parsedId = parseInt(id, 10);
    const name = nameParts.join(':');
    if (!name || Number.isNaN(parsedId)) continue;
    items.push({ id: parsedId, name: safeDecode(name), type, mode });
  }
  return items;
}

/**
 * Entities travel as "type:id:name:original", the id being the part the API needs. Both
 * names are encoded, so a colon inside one cannot be read as a separator, and the fourth
 * part is absent where the catalogue has no romanisation or the link predates it.
 */
function parseEntityParam(raw: string | null): RecommendationEntity[] {
  if (!raw) return [];
  const entities: RecommendationEntity[] = [];
  for (const entry of raw.split(',')) {
    const [type, id, name, original] = entry.split(':');
    if (!id || !isEntityType(type)) continue;
    entities.push({
      type,
      id,
      name: name ? safeDecode(name) : id,
      original: original ? safeDecode(original) : null,
    });
  }
  return entities;
}

function isEntityType(value: string): value is EntityFilterType {
  return (
    value === 'staff' ||
    value === 'seiyuu' ||
    value === 'developer' ||
    value === 'publisher' ||
    value === 'producer'
  );
}

/** Names are encoded so a comma inside one cannot split the list. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseRecommendationFilters(params: URLSearchParams): RecommendationFilterState {
  const spoiler = readNumber(params, 'spoiler_level');
  // A link carrying "-1" is read as unset here, and the request then falls back to the
  // endpoint's own finished-only default.
  const devstatus = readString(params, 'devstatus');

  const filters: RecommendationFilters = {
    min_rating: readNumber(params, 'min_rating'),
    max_rating: readNumber(params, 'max_rating'),
    year_min: readNumber(params, 'year_min'),
    year_max: readNumber(params, 'year_max'),
    min_votecount: readNumber(params, 'min_votecount'),
    max_votecount: readNumber(params, 'max_votecount'),
    min_difficulty: readNumber(params, 'min_difficulty'),
    max_difficulty: readNumber(params, 'max_difficulty'),
    length: readString(params, 'length'),
    exclude_length: readString(params, 'exclude_length'),
    minage: readString(params, 'minage'),
    exclude_minage: readString(params, 'exclude_minage'),
    devstatus: devstatus === '-1' ? undefined : devstatus,
    exclude_devstatus: readString(params, 'exclude_devstatus'),
    olang: readString(params, 'olang'),
    exclude_olang: readString(params, 'exclude_olang'),
    platform: readString(params, 'platform'),
    exclude_platform: readString(params, 'exclude_platform'),
    japanese_only: readBoolean(params, 'japanese_only', DEFAULT_FILTERS.japanese_only),
    exclude_blacklist: readBoolean(params, 'exclude_blacklist', DEFAULT_FILTERS.exclude_blacklist),
    spoiler_level: spoiler === 1 || spoiler === 2 ? spoiler : 0,
    nsfw: readBoolean(params, 'nsfw', DEFAULT_FILTERS.nsfw),
    discovery: readNumber(params, 'discovery'),
  };

  const tagTraits = [
    ...parseTagTraitParam(params.get('includeTags'), 'tag', 'include'),
    ...parseTagTraitParam(params.get('excludeTags'), 'tag', 'exclude'),
    ...parseTagTraitParam(params.get('includeTraits'), 'trait', 'include'),
    ...parseTagTraitParam(params.get('excludeTraits'), 'trait', 'exclude'),
  ];

  // A bare id list is what a link from a staff or producer page carries. It names the chip
  // by its id until the reader replaces it, and is rewritten as a named entity on the next
  // apply.
  const entities = [...parseEntityParam(params.get('entities'))];
  for (const type of ['staff', 'seiyuu', 'developer', 'publisher', 'producer'] as const) {
    const raw = readString(params, type);
    if (!raw) continue;
    for (const id of raw.split(',').map((value) => value.trim()).filter(Boolean)) {
      if (entities.some((entity) => entity.type === type && entity.id === id)) continue;
      entities.push({ type, id, name: id });
    }
  }

  return {
    filters: normalizeFilters(filters),
    tagTraits: tagTraits.slice(0, MAX_TAG_TRAIT_FILTERS),
    entities: entities.slice(0, MAX_ENTITY_FILTERS),
    weights: parseWeightsParam(params.get('weights')),
  };
}

function joinTagTraits(
  items: SelectedItem[],
  type: 'tag' | 'trait',
  mode: 'include' | 'exclude',
): string {
  return items
    .filter((item) => item.type === type && item.mode === mode)
    .map((item) => `${item.id}:${encodeURIComponent(item.name)}`)
    .join(',');
}

function joinEntityIds(entities: RecommendationEntity[], type: EntityFilterType): string {
  return entities
    .filter((entity) => entity.type === type)
    .map((entity) => entity.id)
    .join(',');
}

/**
 * The page's own query string. Only values that differ from the defaults are written, so an
 * unfiltered link stays short and a filtered one shows exactly what was asked for.
 */
export function serializeRecommendationFilters(
  state: RecommendationFilterState,
  identity: { uid: string; username?: string },
): string {
  const params = new URLSearchParams();
  params.set('uid', identity.uid);
  if (identity.username) params.set('username', identity.username);

  const { filters, tagTraits, entities } = state;

  const numbers: [string, number | undefined][] = [
    ['min_rating', filters.min_rating],
    ['max_rating', filters.max_rating],
    ['year_min', filters.year_min],
    ['year_max', filters.year_max],
    ['min_votecount', filters.min_votecount],
    ['max_votecount', filters.max_votecount],
    ['min_difficulty', filters.min_difficulty],
    ['max_difficulty', filters.max_difficulty],
    ['discovery', filters.discovery],
  ];
  for (const [key, value] of numbers) {
    if (value !== undefined) params.set(key, String(value));
  }

  const strings: [string, string | undefined][] = [
    ['length', filters.length],
    ['exclude_length', filters.exclude_length],
    ['minage', filters.minage],
    ['exclude_minage', filters.exclude_minage],
    ['devstatus', filters.devstatus],
    ['exclude_devstatus', filters.exclude_devstatus],
    ['olang', filters.olang],
    ['exclude_olang', filters.exclude_olang],
    ['platform', filters.platform],
    ['exclude_platform', filters.exclude_platform],
  ];
  for (const [key, value] of strings) {
    if (value) params.set(key, value);
  }

  if (!filters.japanese_only) params.set('japanese_only', 'false');
  if (!filters.exclude_blacklist) params.set('exclude_blacklist', 'false');
  if (filters.spoiler_level > 0) params.set('spoiler_level', String(filters.spoiler_level));
  if (!filters.nsfw) params.set('nsfw', 'false');

  const includeTags = joinTagTraits(tagTraits, 'tag', 'include');
  const excludeTags = joinTagTraits(tagTraits, 'tag', 'exclude');
  const includeTraits = joinTagTraits(tagTraits, 'trait', 'include');
  const excludeTraits = joinTagTraits(tagTraits, 'trait', 'exclude');
  if (includeTags) params.set('includeTags', includeTags);
  if (excludeTags) params.set('excludeTags', excludeTags);
  if (includeTraits) params.set('includeTraits', includeTraits);
  if (excludeTraits) params.set('excludeTraits', excludeTraits);

  if (entities.length > 0) {
    params.set(
      'entities',
      entities
        .map((entity) => {
          const parts = [entity.type, entity.id, encodeURIComponent(entity.name)];
          if (entity.original) parts.push(encodeURIComponent(entity.original));
          return parts.join(':');
        })
        .join(','),
    );
  }

  // Only the signals moved off their default are written, so a link stays readable and
  // says exactly what was tuned.
  const weights = formatWeightsParam(state.weights);
  if (weights) params.set('weights', weights);

  return params.toString();
}

/** The request the recommender is asked for. */
export function buildRecommendationRequest(
  state: RecommendationFilterState,
  limit: number,
): URLSearchParams {
  const { filters, tagTraits, entities } = state;
  const params = new URLSearchParams({ limit: String(limit) });

  const numbers: [string, number | undefined][] = [
    ['min_rating', filters.min_rating],
    ['max_rating', filters.max_rating],
    ['year_min', filters.year_min],
    ['year_max', filters.year_max],
    ['min_votecount', filters.min_votecount],
    ['max_votecount', filters.max_votecount],
    ['min_difficulty', filters.min_difficulty],
    ['max_difficulty', filters.max_difficulty],
    ['discovery', filters.discovery],
  ];
  for (const [key, value] of numbers) {
    if (value !== undefined) params.set(key, String(value));
  }

  // The length categories are sent, never the 1-5 min_length/max_length pair the endpoint
  // also accepts: a category list can say "very short or very long" where a range cannot.
  const strings: [string, string | undefined][] = [
    ['length', filters.length],
    ['exclude_length', filters.exclude_length],
    ['minage', filters.minage],
    ['exclude_minage', filters.exclude_minage],
    ['exclude_devstatus', filters.exclude_devstatus],
    ['olang', filters.olang],
    ['exclude_olang', filters.exclude_olang],
    ['platform', filters.platform],
    ['exclude_platform', filters.exclude_platform],
  ];
  for (const [key, value] of strings) {
    if (value) params.set(key, value);
  }

  // Unset means the endpoint's own default, finished titles only; an explicit status
  // list, or "-1" for every status, is what admits unfinished and cancelled titles.
  if (filters.devstatus) params.set('devstatus', filters.devstatus);

  // Adult titles are part of the catalogue the recommender draws from, so the request states
  // the choice rather than leaning on a default that means the opposite.
  params.set('nsfw', String(filters.nsfw));

  params.set('japanese_only', String(filters.japanese_only));
  params.set('exclude_blacklist', String(filters.exclude_blacklist));
  if (filters.spoiler_level > 0) params.set('spoiler_level', String(filters.spoiler_level));

  const tagTraitParams: [string, 'tag' | 'trait', 'include' | 'exclude'][] = [
    ['include_tags', 'tag', 'include'],
    ['exclude_tags', 'tag', 'exclude'],
    ['include_traits', 'trait', 'include'],
    ['exclude_traits', 'trait', 'exclude'],
  ];
  for (const [key, type, mode] of tagTraitParams) {
    const ids = tagTraits
      .filter((item) => item.type === type && item.mode === mode)
      .map((item) => item.id);
    if (ids.length > 0) params.set(key, ids.join(','));
  }

  for (const type of ['staff', 'seiyuu', 'developer', 'publisher', 'producer'] as const) {
    const ids = joinEntityIds(entities, type);
    if (ids) params.set(type, ids);
  }

  // Sent only when it differs from the published balance. A request that names the
  // defaults is answered from the shared cache like any other; one that tunes them is
  // computed fresh, so saying nothing is the cheaper request as well as the plainer one.
  if (!isDefaultWeights(state.weights)) {
    const weights = formatWeightsParam(state.weights);
    if (weights) params.set('weights', weights);
  }

  return params;
}

function countValues(value: string | undefined): number {
  return value ? value.split(',').filter((entry) => entry.trim()).length : 0;
}

/** Filters behind the disclosure, counted for its badge. */
export function countAdvancedFilters(state: RecommendationFilterState): number {
  const { filters, entities } = state;
  let count = 0;

  count += countValues(filters.minage) + countValues(filters.exclude_minage);
  count += countValues(filters.devstatus) + countValues(filters.exclude_devstatus);
  count += countValues(filters.olang) + countValues(filters.exclude_olang);

  if (filters.year_min !== undefined || filters.year_max !== undefined) count++;
  if (filters.min_votecount !== undefined || filters.max_votecount !== undefined) count++;
  if (filters.min_difficulty !== undefined || filters.max_difficulty !== undefined) count++;
  if (!filters.nsfw) count++;

  count += entities.length;

  return count;
}

/**
 * What is in force, by the group of controls it lives under. The sum equals
 * countActiveFilters less the tag and trait picks, which sit above the groups. Each group
 * header shows its own figure so a shut group still says whether it is doing anything.
 */
export function countFilterGroups(state: RecommendationFilterState): {
  basics: number;
  release: number;
  reading: number;
  people: number;
  content: number;
} {
  const { filters, entities } = state;
  let basics = countValues(filters.platform) + countValues(filters.exclude_platform);
  basics += countValues(filters.length) + countValues(filters.exclude_length);
  if (filters.min_rating !== undefined || filters.max_rating !== undefined) basics++;
  if (!filters.japanese_only) basics++;
  if (!filters.exclude_blacklist) basics++;
  if (filters.spoiler_level > 0) basics++;

  let release = countValues(filters.minage) + countValues(filters.exclude_minage);
  release += countValues(filters.devstatus) + countValues(filters.exclude_devstatus);
  release += countValues(filters.olang) + countValues(filters.exclude_olang);
  if (filters.year_min !== undefined || filters.year_max !== undefined) release++;

  let reading = 0;
  if (filters.min_votecount !== undefined || filters.max_votecount !== undefined) reading++;
  if (filters.min_difficulty !== undefined || filters.max_difficulty !== undefined) reading++;

  return {
    basics,
    release,
    reading,
    people: entities.length,
    content: filters.nsfw ? 0 : 1,
  };
}

export function countActiveFilters(state: RecommendationFilterState): number {
  const { filters, tagTraits } = state;
  let count = countAdvancedFilters(state);

  count += countValues(filters.platform) + countValues(filters.exclude_platform);
  count += countValues(filters.length) + countValues(filters.exclude_length);

  if (filters.min_rating !== undefined || filters.max_rating !== undefined) count++;
  if (!filters.japanese_only) count++;
  if (!filters.exclude_blacklist) count++;
  if (filters.spoiler_level > 0) count++;

  count += tagTraits.length;

  return count;
}

export function hasActiveFilters(state: RecommendationFilterState): boolean {
  return countActiveFilters(state) > 0;
}
