/**
 * Signal weights used by the recommendation match score, and the reader's own tuning of
 * them.
 *
 * The backend is authoritative: its CATALOGUE_SIGNAL_WEIGHTS in hybrid_recommender.py is
 * what an untuned request runs under, and `GET /recommendations/presets` publishes it.
 * The page reads that published vector on load and hands it to every helper here as the
 * baseline, so "default" means the same thing on both sides even if this table is stale.
 * The table is the fallback for a page rendered before the catalogue answers, and the
 * scale the sliders are laid out on.
 *
 * Keys match the `scores` object returned per recommendation, and the wire format below
 * is the one `GET /recommendations/{uid}/v2?weights=` accepts.
 */

export const SIGNAL_WEIGHTS = {
  tag: 1.4,
  similar_games: 1.2,
  users_also_read: 1.2,
  quality: 0.8,
  developer: 1.2,
  staff: 1.0,
  trait: 0.7,
  seiyuu: 0.7,
  description: 1.2,
} as const;

export type SignalKey = keyof typeof SIGNAL_WEIGHTS;
export type SignalWeights = Record<SignalKey, number>;

/** Every signal, in the order the API lists them and the controls show them. */
export const SIGNAL_KEYS: SignalKey[] = [
  'description',
  'tag',
  'similar_games',
  'users_also_read',
  'quality',
  'developer',
  'staff',
  'trait',
  'seiyuu',
];

/** Score a VN would reach with every signal maxed out. Derived, never written down. */
export const MAX_RAW_SCORE = Object.values(SIGNAL_WEIGHTS).reduce((a, b) => a + b, 0);

/**
 * Limits the endpoint applies. Mirrored so a control cannot be dragged somewhere the
 * request would be turned away, and so the page can say why a value was adjusted.
 */
export const MAX_SIGNAL_WEIGHT = 10;
export const MAX_TOTAL_WEIGHT = 20;
export const MIN_TOTAL_WEIGHT = 0.1;

/**
 * Range and granularity of one slider. Narrower than the endpoint's ceiling: a signal at
 * several times the others already decides the ranking alone, so the range stops there.
 * Wide enough that every preset sits inside it, since a preset the slider cannot show
 * would read as a value it is not.
 */
export const SLIDER_MAX = 6;
export const SLIDER_STEP = 0.1;

/** Decimal places a weight is kept to, matching what the endpoint rounds to. */
const WEIGHT_PRECISION = 3;

function round(value: number): number {
  return Number(value.toFixed(WEIGHT_PRECISION));
}

/** A weight as it appears in a link: no trailing zeros, so one vector is one string. */
function formatWeight(value: number): string {
  return String(round(value));
}

export function defaultWeights(defaults: SignalWeights = SIGNAL_WEIGHTS): SignalWeights {
  return { ...defaults };
}

export function weightTotal(weights: SignalWeights): number {
  return SIGNAL_KEYS.reduce((total, key) => total + weights[key], 0);
}

/** A signal's share of a total. The bar beside each slider and each breakdown row. */
export function contributionPct(weight: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.round((weight / total) * 100);
}

/** A signal's share of the total if every signal scored perfectly. */
export function maxContributionPct(weight: number): number {
  return contributionPct(weight, MAX_RAW_SCORE);
}

export function clampWeight(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_SIGNAL_WEIGHT, Math.max(0, round(value)));
}

export function isDefaultWeights(
  weights: SignalWeights | null | undefined,
  defaults: SignalWeights = SIGNAL_WEIGHTS,
): boolean {
  if (!weights) return true;
  return SIGNAL_KEYS.every((key) => round(weights[key]) === round(defaults[key]));
}

/**
 * The defaults as the catalogue publishes them, from the `/presets` answer, or null where
 * the answer does not carry a full vector. Read once per page so the baseline the controls
 * compare against is the one the engine actually scores under.
 */
export function parsePublishedWeights(data: unknown): SignalWeights | null {
  const signals = (data as { signals?: unknown })?.signals;
  if (!Array.isArray(signals)) return null;
  const found: Partial<SignalWeights> = {};
  for (const entry of signals as Array<{ name?: string; default?: unknown }>) {
    if (entry?.name && SIGNAL_KEYS.includes(entry.name as SignalKey) && typeof entry.default === 'number') {
      found[entry.name as SignalKey] = entry.default;
    }
  }
  return SIGNAL_KEYS.every((key) => typeof found[key] === 'number') ? (found as SignalWeights) : null;
}

/** Whether the endpoint will scale the vector down to keep it inside the total ceiling. */
export function exceedsTotalLimit(weights: SignalWeights): boolean {
  return round(weightTotal(weights)) > MAX_TOTAL_WEIGHT;
}

/** Whether the vector says nothing, which the endpoint refuses rather than clamps. */
export function isEmptyWeights(weights: SignalWeights): boolean {
  return round(weightTotal(weights)) < MIN_TOTAL_WEIGHT;
}

/**
 * Named vectors, mirroring the set the endpoint publishes at
 * `GET /recommendations/presets`. Held here as well so the buttons render before any
 * request has been made; the endpoint remains the authority on what a name means.
 */
export interface WeightPreset {
  name: string;
  label: string;
  description: string;
  weights: SignalWeights;
}

function buildPresets(defaults: SignalWeights): WeightPreset[] {
  return [
  {
    name: 'balanced',
    label: 'Balanced',
    description: 'The default blend: content and co-reading signals lead, with a smaller quality term.',
    weights: { ...defaults },
  },
  {
    name: 'by-theme',
    label: 'By theme',
    description: 'Leans on tag affinity, so subject matter decides and popularity has little say.',
    weights: {
      tag: 5.0,
      similar_games: 1.5,
      users_also_read: 0.8,
      quality: 0.8,
      developer: 0.4,
      staff: 0.4,
      trait: 0.6,
      seiyuu: 0.2,
      description: 2.0,
    },
  },
  {
    name: 'by-premise',
    label: 'By premise',
    description: 'Leans almost entirely on how a title describes itself, which is the one thing a title carries whether or not anyone has read it.',
    weights: {
      tag: 0.8,
      similar_games: 0.3,
      users_also_read: 0.0,
      quality: 0.3,
      developer: 1.0,
      staff: 0.6,
      trait: 0.4,
      seiyuu: 0.3,
      description: 6.0,
    },
  },
  {
    name: 'by-creator',
    label: 'By creator',
    description: 'Leans on the studios, writers and voice actors behind titles you rated highly.',
    weights: {
      tag: 1.5,
      similar_games: 1.0,
      users_also_read: 0.5,
      quality: 0.5,
      developer: 2.5,
      staff: 2.5,
      trait: 0.4,
      seiyuu: 1.5,
      description: 1.0,
    },
  },
  {
    name: 'by-similar-readers',
    label: 'By similar readers',
    description: 'Leans on what readers of the same titles went on to read, rather than on the titles themselves.',
    weights: {
      tag: 1.0,
      similar_games: 3.0,
      users_also_read: 4.0,
      quality: 0.5,
      developer: 0.3,
      staff: 0.3,
      trait: 0.3,
      seiyuu: 0.2,
      description: 0.8,
    },
  },
  {
    name: 'by-characters',
    label: 'By characters',
    description: 'Leans on character archetypes and voice actors, which the default blend keeps quiet.',
    weights: {
      tag: 2.0,
      similar_games: 1.2,
      users_also_read: 0.8,
      quality: 0.5,
      developer: 0.3,
      staff: 0.4,
      trait: 3.0,
      seiyuu: 1.8,
      description: 1.2,
    },
  },
  {
    name: 'ignore-consensus',
    label: 'Ignore consensus',
    description:
      'Drops every signal that only exists once a title has been widely read: tags, both co-reading terms and the quality average. What is left is what a title says about itself and who made it.',
    weights: { ...defaults, tag: 0, similar_games: 0, users_also_read: 0, quality: 0 },
  },
  ];
}

/** The presets against a baseline: Balanced is the baseline itself, the rest are fixed vectors. */
export function weightPresets(defaults: SignalWeights = SIGNAL_WEIGHTS): WeightPreset[] {
  return buildPresets(defaults);
}

export const WEIGHT_PRESETS: WeightPreset[] = weightPresets();

/** The preset a vector reproduces, so a link carrying numbers still shows a name. */
export function matchingPreset(
  weights: SignalWeights | null | undefined,
  defaults: SignalWeights = SIGNAL_WEIGHTS,
): WeightPreset | null {
  if (!weights) return null;
  return (
    weightPresets(defaults).find((preset) =>
      SIGNAL_KEYS.every((key) => round(preset.weights[key]) === round(weights[key])),
    ) ?? null
  );
}

/**
 * The `weights` parameter, naming only what differs from the default. Empty when nothing
 * does, which is how an untuned request says it wants the ordinary answer.
 */
export function formatWeightsParam(
  weights: SignalWeights | null | undefined,
  defaults: SignalWeights = SIGNAL_WEIGHTS,
): string {
  if (!weights) return '';
  return SIGNAL_KEYS.filter((key) => round(weights[key]) !== round(defaults[key]))
    .map((key) => `${key}:${formatWeight(weights[key])}`)
    .join(',');
}

/**
 * Read a `weights` parameter back into a full vector, or null where it names nothing.
 *
 * Unreadable entries are dropped rather than failing the page: the parameter arrives from
 * a link that may have been edited by hand, and a link with one bad pair should still
 * produce the recommendations it was shared for. The endpoint validates independently.
 */
export function parseWeightsParam(raw: string | null | undefined): SignalWeights | null {
  if (!raw) return null;
  const weights = defaultWeights();
  let named = false;
  for (const entry of raw.split(',')) {
    const [key, value] = entry.split(':');
    const name = key?.trim() as SignalKey;
    if (!name || !(name in SIGNAL_WEIGHTS)) continue;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) continue;
    weights[name] = clampWeight(parsed);
    named = true;
  }
  if (!named) return null;
  return isDefaultWeights(weights) ? null : weights;
}

/**
 * One word per thing. These names label the sliders, the tabs and the per-card reasons, so
 * a reader is never shown two words for one signal on the same screen.
 */
export const SIGNAL_LABELS: Record<SignalKey, string> = {
  description: 'Premise',
  tag: 'Tags',
  similar_games: 'Similar titles',
  users_also_read: 'Also read',
  quality: 'Global rating',
  developer: 'Studios',
  staff: 'Staff',
  trait: 'Characters',
  seiyuu: 'Voices',
};

/**
 * The lists the endpoint serves, one per tab.
 *
 * Each list is the same request ranked by one signal alone, which is why a list name and a
 * signal name are two different vocabularies: the list token keys the URL, the signal keys
 * the score breakdown. The endpoint publishes the pairing at `GET /recommendations/presets`
 * and stays the authority on it; the table here adds the labels and the copy, which the
 * endpoint does not carry, and lets the tabs render before any request has been made.
 *
 * `quality` has no list of its own. It is the same number for every reader, so a list of it
 * would rank the catalogue by how well known a title is and say nothing about anyone.
 */
export type ListName =
  | 'combined'
  | 'tags'
  | 'premise'
  | 'similar'
  | 'studios'
  | 'staff'
  | 'voices'
  | 'characters'
  | 'also-read';

export interface RecommendationList {
  name: ListName;
  /** Null on the combined list, which is every signal at once. */
  signal: SignalKey | null;
  label: string;
  /** What this list ranks by, said once, above the grid. */
  blurb: string;
  /**
   * How a card on this list names what it matched. The entities are the reader's own
   * affinities for every list except the three whose entities are titles they have read.
   */
  reasonLabel: string;
}

export const DEFAULT_LIST: ListName = 'combined';

export const RECOMMENDATION_LISTS: RecommendationList[] = [
  {
    name: 'combined',
    signal: null,
    label: 'Combined',
    blurb: 'Ranked by how high a title placed across all eight lists at once, rather than by a sum of their scores.',
    reasonLabel: '',
  },
  {
    name: 'tags',
    signal: 'tag',
    label: 'Tags',
    blurb: 'Ranked by subject matter, weighted toward the tags that single you out from other readers.',
    reasonLabel: 'Tags you rate highly',
  },
  {
    name: 'premise',
    signal: 'description',
    label: 'Premise',
    blurb: 'Ranked by how a title describes itself, which is the one thing it carries whether or not anyone has read it.',
    reasonLabel: 'Reads like',
  },
  {
    name: 'similar',
    signal: 'similar_games',
    label: 'Similar',
    blurb: 'Ranked by VNDB\u2019s own similarity between a title and the ones you rated highest.',
    reasonLabel: 'Similar to',
  },
  {
    name: 'studios',
    signal: 'developer',
    label: 'Studios',
    blurb: 'Ranked by the developers and publishers whose work you mark above your own average.',
    reasonLabel: 'Studios you rate highly',
  },
  {
    name: 'staff',
    signal: 'staff',
    label: 'Staff',
    blurb: 'Ranked by the writers, artists and composers whose work you mark above your own average.',
    reasonLabel: 'Staff you rate highly',
  },
  {
    name: 'voices',
    signal: 'seiyuu',
    label: 'Voices',
    blurb: 'Ranked by the voice actors who recur in the titles you rated highly.',
    reasonLabel: 'Voice actors you rate highly',
  },
  {
    name: 'characters',
    signal: 'trait',
    label: 'Characters',
    blurb: 'Ranked by the character archetypes that recur in what you enjoy.',
    reasonLabel: 'Character traits you rate highly',
  },
  {
    name: 'also-read',
    signal: 'users_also_read',
    label: 'Also read',
    blurb: 'Ranked by what readers of the same titles went on to read, rather than by the titles themselves.',
    reasonLabel: 'Read alongside',
  },
];

const LISTS_BY_NAME = new Map<string, RecommendationList>(
  RECOMMENDATION_LISTS.map((list) => [list.name, list]),
);

export function listByName(name: string | null | undefined): RecommendationList | undefined {
  return name ? LISTS_BY_NAME.get(name) : undefined;
}

/**
 * The list a link asks for. An unknown token falls back to the combined list rather than
 * to the endpoint's 400, since a mistyped tab in a shared address should still produce
 * recommendations.
 */
export function parseListParam(raw: string | null | undefined): ListName {
  const list = listByName(raw?.trim());
  return list ? list.name : DEFAULT_LIST;
}

/**
 * Which signal a card's entities belong to, given the reason the response attached. Falls
 * back to the list's own signal, which is what a signal list always reports.
 */
export function reasonSignal(signal: string | null | undefined): SignalKey | null {
  return signal && signal in SIGNAL_WEIGHTS ? (signal as SignalKey) : null;
}
