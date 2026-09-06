'use client';

import { RecommendationList, SIGNAL_LABELS, reasonSignal } from '@/lib/recommendation-weights';
import { TitlePreference, getDisplayTitle, getEntityDisplayName } from '@/lib/title-preference';
import { LENGTH_LABELS } from '@/components/browse/filter-constants';
import { DIFFICULTY_BANDS } from '@/lib/difficulty';

/**
 * What a card says about itself: the mark the signals expect, how widely they agreed, and
 * the entities the match was made of.
 *
 * All three are statements about evidence rather than scores, which is the whole point of
 * them. A single blended percentage answers "how much" without ever answering "of what",
 * and a reader cannot check it against anything they know.
 */

/** The signals' expected marks for one title, and the range they disagree over. */
export interface PredictedRating {
  mean: number;
  /** Null where one signal spoke alone: the spread of one number is unmeasured, not zero. */
  low: number | null;
  high: number | null;
  /** The mark each signal gave on its own; fresh pages only, the saved page carries the mean and range. */
  signals?: Record<string, number>;
}

/**
 * Which entities put a title on a list, and how many of them there were.
 *
 * `count` is a floor only where `count_is_floor` says so: the matched entities are cut
 * before they reach the response only when the source list ran past its own depth, and a
 * count from a list that never hit that depth is already the total.
 */
export interface RecommendationReason {
  list: string;
  signal: string;
  count: number;
  count_is_floor?: boolean;
  /**
   * The strongest few, each with what the other script calls it: a romanisation for a
   * person, the title variants for a title. Which is shown is the reader's setting.
   */
  top: Array<{
    name: string;
    id?: number | string;
    original?: string | null;
    title_jp?: string | null;
    title_romaji?: string | null;
  }>;
}

/** One named thing from a reason, in the script the reader chose. */
function namedAs(
  entry: RecommendationReason['top'][number],
  preference: TitlePreference | undefined,
): string {
  if (!preference) return entry.name;
  if (entry.title_jp !== undefined || entry.title_romaji !== undefined) {
    return getDisplayTitle(
      { title: entry.name, title_jp: entry.title_jp ?? undefined, title_romaji: entry.title_romaji ?? undefined },
      preference,
    );
  }
  return getEntityDisplayName({ name: entry.name, original: entry.original ?? undefined }, preference);
}

/** What the answer says about the list it served. */
export interface ListBlock {
  name: string;
  signal: string | null;
  /**
   * How many different scores the ranking signal gave the page. One means it separated
   * nothing, and the order is entirely the retrieval arm's affinity ranking.
   */
  distinct_scores?: number;
  /** How many of the page the list's own source named, the rest being exploration. */
  from_retrieval?: number;
  weights_ignored?: boolean;
}

/** How many entities to name before the rest are counted. */
const NAMED_ENTITIES = 3;

/**
 * The reason as one sentence.
 *
 * The residual carries a floor marker only when the source list was itself cut short:
 * naming three of ten and calling the rest "7 more" would claim a total that was never
 * measured, but a count already exact needs no hedge in front of the reader.
 */
export function reasonSentence(
  reason: RecommendationReason,
  list: RecommendationList | undefined,
  preference?: TitlePreference,
): string {
  const label = list?.reasonLabel || fallbackReasonLabel(reason.signal);
  const named = reason.top
    .slice(0, NAMED_ENTITIES)
    .map((entry) => namedAs(entry, preference))
    .filter(Boolean);
  if (named.length === 0) return label;
  const remaining = Math.max(0, reason.count - named.length);
  const floor = reason.count_is_floor ? '+' : '';
  const tail = remaining > 0 ? `, and ${remaining}${floor} more` : '';
  return `${label}: ${named.join(', ')}${tail}`;
}

/**
 * A reason belonging to a signal whose list is not the one on screen, which is every card
 * on the combined tab. The label is derived from the signal so the two vocabularies cannot
 * drift into naming the same thing twice.
 */
function fallbackReasonLabel(signal: string): string {
  const key = reasonSignal(signal);
  return key ? SIGNAL_LABELS[key] : 'Matched';
}

const PREDICTION_TOOLTIP =
  'The mark each signal expects you to give this title, combined, with the signals that ' +
  'have predicted ratings best counting for most. The range is where those signals agree, ' +
  'not a forecast of what you would actually rate it.';

const PREDICTION_TOOLTIP_ALONE =
  'The mark one signal expects you to give this title. Only one had anything to go on, so ' +
  'there is no range: the spread of a single number is unmeasured rather than zero.';

/**
 * The predicted mark and the interval around it.
 *
 * The interval is the 95% interval for the mean under the signals' own scatter, so it says
 * how much the signals disagreed and nothing about how close the mean is to a real rating.
 * The wording keeps that distinction because a range presented as a forecast is read as a
 * guarantee, and this one is not calibrated against anything.
 */
export function PredictedRatingLine({ prediction }: { prediction: PredictedRating }) {
  const hasInterval = prediction.low !== null && prediction.high !== null;
  // A saved page carries the mean and the range but not the marks behind them, so the
  // count is unknown there and the spoken summary leaves it out rather than saying zero.
  const spoke = prediction.signals ? Object.keys(prediction.signals).length : 0;

  return (
    <p
      className="rc-why flex items-baseline gap-1"
      title={hasInterval ? PREDICTION_TOOLTIP : PREDICTION_TOOLTIP_ALONE}
    >
      <span>Predicted</span>
      <span className="rc-num font-semibold text-[color:var(--ink)]">
        {prediction.mean.toFixed(1)}
      </span>
      {hasInterval ? (
        <span className="rc-num">
          ({prediction.low!.toFixed(1)}-{prediction.high!.toFixed(1)})
        </span>
      ) : (
        <span>from 1 signal</span>
      )}
      {hasInterval && spoke > 0 && <span className="sr-only">across {spoke} signals</span>}
    </p>
  );
}

export const AGREEMENT_TOOLTIP =
  'How high this title placed, counted across every ranking the engine read. The count ' +
  'beside it is how many of the tabbed lists placed it; the percentage also counts the ' +
  'global-rating ranking, which has no tab of its own. It is not a probability or a share ' +
  'of anything: a title placed first in a single ranking and absent from the rest lands ' +
  'near 11%.';

/**
 * Breadth and depth of agreement, together.
 *
 * The count leads because the percentage alone cannot be read: the same figure comes from
 * one first place and from three middling ones, and which of those a title is changes what
 * it is being offered as.
 */
export function AgreementLine({
  confidence,
  signalsRanked,
  totalLists,
}: {
  confidence: number;
  signalsRanked: number;
  totalLists: number;
}) {
  // A title no list placed inside its own results still reaches the page, through the
  // draw that keeps the page from being nine rankings of the same titles. "0 of 8, 0%"
  // states that correctly and reads as an error, so it is said in words instead.
  if (signalsRanked <= 0) {
    return (
      <p className="rc-why" title={AGREEMENT_TOOLTIP}>
        No list ranked it; drawn in for variety
      </p>
    );
  }

  return (
    <p
      className="rc-why"
      title={AGREEMENT_TOOLTIP}
    >
      In{' '}
      <span className="rc-num font-semibold text-[color:var(--ink)]">
        {signalsRanked} of {totalLists}
      </span>{' '}
      lists, <span className="rc-num">{confidence}%</span> agreement
    </p>
  );
}

/** The entities the match was made of, clamped, with the whole sentence on hover. */
export function ReasonLine({
  reason,
  list,
  preference,
}: {
  reason: RecommendationReason;
  list: RecommendationList | undefined;
  preference?: TitlePreference;
}) {
  const sentence = reasonSentence(reason, list, preference);
  return (
    <p
      className="rc-why line-clamp-2"
      title={sentence}
    >
      {sentence}
    </p>
  );
}

/**
 * What a signal list is, said once above its grid, plus how much its signal actually decided.
 *
 * Several of the signals score most of the candidates they reach identically. Their lists are
 * still worth serving, because the arm that retrieved them ranked them on how much of the
 * reader's own list the matched entities account for, but an order a score did not separate is
 * closer to a set than a ranking and has to be labelled as one. The count of distinct scores
 * is reported rather than tested against a cut-off: it is the fact, and where it is small the
 * reader can see how small without being handed someone's threshold.
 */
export function ListIntro({
  list,
  block,
  pageSize,
}: {
  list: RecommendationList;
  block: ListBlock | null;
  pageSize: number;
}) {
  if (list.name === 'combined') {
    return (
      <p className="rc-why text-center max-w-2xl mx-auto">
        {list.blurb}
      </p>
    );
  }

  const distinct = block?.distinct_scores;
  const fromRetrieval = block?.from_retrieval;

  // Built as strings rather than as JSX with interpolations between words: the surrounding
  // sentence changes with the numbers, and a sentence assembled from fragments loses the
  // spaces between them silently.
  let separation: string | null = null;
  if (fromRetrieval === 0) {
    separation =
      'This list found nothing of its own for you, so what is below was drawn in for variety ' +
      'and is in no meaningful order. The reasons on each card are still accurate.';
  } else if (distinct === 1) {
    separation =
      'The score behind this order is the same for every title here, so it separated ' +
      'nothing. They are ordered by how much of your reading the matched entries account ' +
      'for: read this tab as a set rather than a ranking.';
  } else if (distinct !== undefined && pageSize > 0 && distinct < pageSize) {
    separation =
      `The score behind this order took ${distinct} different values across these ` +
      `${pageSize} titles, so much of it is how much of your reading the matched entries ` +
      'account for rather than the score itself.';
  }
  const warn = fromRetrieval === 0 || distinct === 1;

  const drawn =
    fromRetrieval !== undefined && fromRetrieval > 0 && fromRetrieval < pageSize
      ? `${fromRetrieval} of these came from this list's own search; the rest were drawn in ` +
        'for variety and scored the same way.'
      : null;

  return (
    <div className="text-center max-w-2xl mx-auto space-y-1">
      <p className="rc-why">{list.blurb}</p>
      {separation && (
        <p
          className={
            warn ? 'rc-why rc-caution' : 'rc-why text-[color:var(--text-faint)]'
          }
        >
          {separation}
        </p>
      )}
      {drawn && <p className="rc-why text-[color:var(--text-faint)]">{drawn}</p>}
    </div>
  );
}

/** The VNDB length categories, by the number the catalogue stores, as the filter names them. */
const LENGTH_CATEGORY_SLUGS: Record<number, string> = {
  1: 'very_short',
  2: 'short',
  3: 'medium',
  4: 'long',
  5: 'very_long',
};

/** Playtime as a reader would say it: hours from the reported minutes, else the category. */
function lengthText(length: number | null | undefined, minutes: number | null | undefined): string | null {
  if (minutes && minutes > 0) {
    const hours = minutes / 60;
    return hours < 10 ? `${hours.toFixed(1)}h` : `${Math.round(hours)}h`;
  }
  if (length) return LENGTH_LABELS[LENGTH_CATEGORY_SLUGS[length] ?? ''] ?? null;
  return null;
}

/**
 * Year, length and difficulty on one line. Facts about the title, drawn in the same place
 * on every layout so the three filters a reader can set have their values in view.
 */
export function FactsLine({
  year,
  length,
  lengthMinutes,
  difficulty,
  className = '',
  as = 'p',
}: {
  year?: number | null;
  length?: number | null;
  lengthMinutes?: number | null;
  difficulty?: number | null;
  className?: string;
  as?: 'p' | 'span';
}) {
  const parts: string[] = [];
  if (year) parts.push(String(year));
  const playtime = lengthText(length, lengthMinutes);
  if (playtime) parts.push(playtime);
  const band = difficulty !== null && difficulty !== undefined ? DIFFICULTY_BANDS[difficulty] : null;
  if (band) parts.push(`${band.label} Japanese`);
  if (parts.length === 0) return null;
  const Tag = as;
  return <Tag className={`rc-why rc-num ${className}`}>{parts.join(' · ')}</Tag>;
}

/**
 * What the figures on a card are, said once above the list rather than behind a hover. A
 * tooltip is unreachable on touch and inconsistent under a screen reader, and these three
 * numbers are the page's whole argument.
 */
/**
 * What the three figures on a card are. Lives in the explainer panel beside the other
 * sections rather than under the results, so the page has one place that explains itself.
 * Worded for the list on screen, since a single-signal list shows a different percentage.
 */
export function FigureKey({ list, totalLists }: { list: RecommendationList; totalLists: number }) {
  return (
    <ul className="space-y-1.5 list-disc list-inside">
        <li>
          <strong>Predicted</strong>: the mark the signals expect you to give the title, each
          weighted by how well it has been measured to predict. The range is where the signals
          disagree, not a forecast.
        </li>
        {list.name === 'combined' ? (
          <li>
            <strong>N of {totalLists} lists, X% agreement</strong>: how many of the signal lists
            placed the title, and how high it placed across every ranking the engine read. 100%
            would be first in all of them, including the global-rating ranking that has no tab.
          </li>
        ) : (
          <li>
            <strong>X%</strong>: how strongly the {list.signal ? SIGNAL_LABELS[list.signal] : ''}{' '}
            signal matched, against the strongest match on this page.
          </li>
        )}
        <li>
          <strong>Year, hours, difficulty</strong>: from the catalogue and from jiten&apos;s text
          analysis; a title without a difficulty has not been analysed.
        </li>
      </ul>
  );
}
