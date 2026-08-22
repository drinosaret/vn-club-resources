import { BookOpen, Building2, Layers, Pen, Tag, Users } from 'lucide-react';

import type { LeaderboardCatalogueEntry } from '@/lib/vndb-stats-api';

/**
 * How the catalogue is organised for reading.
 *
 * The boards themselves are grouped by subject, which is the right axis for the data and the
 * wrong one for a reader: it leaves the reader boards in one undifferentiated block while
 * several subjects hold only a board or two. This file regroups them, splitting
 * the large sections by the question each board answers and merging the small ones.
 *
 * Membership is decided by metric, window and facet rather than by listing slugs. A slug list
 * silently drops a board the day the registry gains one; a predicate puts it somewhere.
 */

/** The facet text a board carries when it ranks the whole database. */
const UNFACETED = 'all visual novels';

const isFaceted = (board: LeaderboardCatalogueEntry) =>
  board.facet_description !== UNFACETED;

/**
 * What a board's facet narrows by, as published alongside it.
 *
 * Falls back to reading the description only if the field is missing, which happens for one
 * cache generation after a deploy and never after that.
 */
const facetKind = (board: LeaderboardCatalogueEntry): string =>
  board.facet_kind ?? (isFaceted(board) ? 'kind' : 'none');

export interface Cluster {
  label: string;
  /** One line under the cluster heading, where the grouping needs explaining. */
  note?: string;
  matches: (board: LeaderboardCatalogueEntry) => boolean;
}

export interface CatalogueSection {
  key: string;
  label: string;
  blurb: string;
  Icon: typeof Users;
  /** Board subjects gathered into this section. */
  subjects: string[];
  /** Optional split within the section, applied in order. */
  clusters?: Cluster[];
}

/**
 * Order matters: this is the reading order and the order of the jump navigation. Visual
 * novels lead because that is what most visitors came for.
 */
export const CATALOGUE_SECTIONS: CatalogueSection[] = [
  {
    key: 'vn',
    label: 'Visual novels',
    blurb: 'What is moving now, and where a reading list stops. Rating and dropping are questions for the builder.',
    Icon: BookOpen,
    subjects: ['vn'],
    clusters: [
      {
        label: 'Best overall',
        // Hidden gems belongs here rather than with the slices: it narrows by how much
        // attention a title has had, not by anything about the title itself.
        matches: (b) => b.metric === 'bayesian' && ['none', 'attention'].includes(facetKind(b)),
      },
      {
        label: 'Best of each era',
        matches: (b) => b.metric === 'bayesian' && facetKind(b) === 'era',
      },
      {
        label: 'Best of a kind',
        note: 'The same ranking, narrowed by platform, language, length or audience.',
        // Difficulty slices are excluded so they group with the other difficulty board
        // rather than being swallowed here, since this cluster runs first.
        matches: (b) => b.metric === 'bayesian' && facetKind(b) !== 'difficulty',
      },
      {
        label: 'How much attention it drew',
        matches: (b) => ['voters', 'wishlist', 'velocity'].includes(b.metric),
      },
      {
        label: 'How it landed',
        note: 'Whether readers agreed, and whether they finished.',
        matches: (b) => ['divisiveness', 'drop_rate', 'completion_rate'].includes(b.metric),
      },
      {
        label: 'How it changed',
        note: 'Reception is not fixed. These compare a title against its own past.',
        matches: (b) => ['reputation_shift', 'rating_as_of'].includes(b.metric),
      },
      {
        label: 'Where reading lists end',
        note: 'Titles that turn up as the last thing someone logged more often than chance.',
        matches: (b) => b.metric === 'terminal_rate',
      },
      {
        label: 'When it was found',
        note: 'Measured against other titles released the same year, not against the calendar.',
        matches: (b) => b.metric === 'discovery_lag',
      },
      {
        label: 'Japanese difficulty',
        note: 'Covers only the titles whose script has been analysed.',
        matches: (b) => b.metric === 'difficulty' || facetKind(b) === 'difficulty',
      },
    ],
  },
  {
    key: 'user',
    label: 'Readers',
    blurb: 'Who reads what, and how much of it.',
    Icon: Users,
    subjects: ['user'],
    clusters: [
      {
        label: 'Who reads the most',
        matches: (b) =>
          !isFaceted(b) &&
          ['votes', 'finished', 'dropped', 'drop_rate', 'completion_rate', 'wishlist'].includes(
            b.metric,
          ),
      },
      {
        label: 'Specialists',
        note: 'Ranked only on a corner of the database, so depth beats volume.',
        matches: isFaceted,
      },
      {
        label: 'What their library is made of',
        note: 'A share of what someone has read, not a count of it, so a long list is no advantage.',
        matches: (b) =>
          ['nvl', 'branching', 'linear', 'bare_bones', 'pc98', 'pre_2000'].includes(
            b.composition ?? '',
          ) || b.metric === 'theme_range',
      },
      {
        label: 'What they stay with',
        note: 'Whether a reader returns to the same studio, writer or series, or keeps moving.',
        matches: (b) =>
          ['top_studio', 'top_writer', 'series_return', 'franchise_depth'].includes(
            b.composition ?? '',
          ),
      },
      {
        label: 'How they vote',
        note: 'Measured against the community on the same titles, not against ten out of ten.',
        matches: (b) =>
          ['vote_bias', 'vote_divergence', 'avg_score', 'vote_response'].includes(b.metric),
      },
      {
        label: 'How far off the map',
        matches: (b) => ['obscurity', 'sole_voter'].includes(b.metric),
      },
      {
        label: 'Reading across time',
        note: 'The shape of a reading history rather than its size: when, how evenly, how far back.',
        matches: (b) =>
          ['era', 'era_window', 'steadiness', 'reading_drift'].includes(b.metric),
      },
      {
        label: 'Intent against practice',
        note: 'What someone means to read set against what they get through.',
        matches: (b) => b.metric === 'backlog_gap',
      },
    ],
  },
  {
    key: 'tags',
    label: 'Tags',
    blurb: 'What the tags themselves say about the titles carrying them.',
    Icon: Tag,
    subjects: ['tag'],
    clusters: [
      {
        label: 'How they read',
        note: 'Reading difficulty averaged across the titles carrying each tag.',
        matches: (b) => b.metric === 'title_difficulty',
      },
      {
        label: 'How readers respond',
        note: 'Whether the titles get finished, and whether they are being picked up now.',
        matches: (b) => ['title_drop_rate', 'title_recency'].includes(b.metric),
      },
      {
        label: 'How they are rated',
        matches: (b) => ['title_mean', 'title_spread'].includes(b.metric),
      },
    ],
  },
  {
    key: 'series',
    label: 'Series',
    blurb: 'Franchises, inferred from how titles relate to each other.',
    Icon: Layers,
    subjects: ['series'],
    clusters: [
      {
        label: 'Longevity',
        note: 'Built on continuation relations only, so a shared setting cannot backdate a line.',
        matches: (b) => b.metric === 'series_span',
      },
      {
        label: 'Reach',
        matches: () => true,
      },
    ],
  },
  {
    key: 'studios',
    label: 'Studios',
    blurb: 'Developers and publishers, by how their catalogue was received.',
    Icon: Building2,
    subjects: ['developer', 'publisher'],
    clusters: [
      {
        label: 'Across the catalogue',
        matches: (b) => ['votes', 'bayesian'].includes(b.metric),
      },
      {
        label: 'Reliability',
        note: 'Judged on the weakest entry rather than the average.',
        matches: (b) => b.metric === 'catalogue_floor',
      },
      {
        label: 'Longevity',
        matches: (b) => b.metric === 'active_span',
      },
    ],
  },
  {
    key: 'people',
    label: 'Creators',
    blurb: 'Writers, artists, composers and the voices behind the cast.',
    Icon: Pen,
    subjects: ['staff', 'seiyuu'],
    clusters: [
      {
        label: 'By craft',
        note: 'Judged only on the credits that shaped the work, not on translation or testing.',
        matches: (b) => b.metric === 'bayesian' && b.subject === 'staff',
      },
      {
        label: 'By how much they worked',
        note: 'Every credit counts here, in any role.',
        matches: (b) => b.metric === 'votes',
      },
      {
        label: 'Voice acting',
        note: 'The leading-role boards count only leads; the others count every appearance.',
        matches: (b) => b.subject === 'seiyuu',
      },
    ],
  },
];

/**
 * Cross-cutting filters, for the questions that do not live in one section.
 *
 * Deliberately few. Anything answerable by jumping to a section belongs in the navigation
 * instead, and a row of chips that merely restates the sections below it is noise.
 */
export const INTENTS: {
  key: string;
  label: string;
  matches: (b: LeaderboardCatalogueEntry) => boolean;
}[] = [
  { key: 'all', label: 'Everything', matches: () => true },
  {
    key: 'trends',
    label: 'On the trends page',
    matches: (b) => b.home === 'trends',
  },
  {
    key: 'split',
    label: 'Where opinion splits',
    matches: (b) =>
      ['divisiveness', 'title_spread', 'vote_bias', 'vote_divergence', 'vote_response',
       'avg_score'].includes(b.metric),
  },
  {
    key: 'stopped',
    label: 'Where readers stop',
    matches: (b) =>
      ['drop_rate', 'completion_rate', 'title_drop_rate', 'terminal_rate', 'finished',
       'dropped'].includes(b.metric),
  },
  {
    key: 'japanese',
    label: 'Reading in Japanese',
    matches: (b) =>
      ['difficulty', 'title_difficulty'].includes(b.metric) || facetKind(b) === 'difficulty',
  },
  {
    key: 'catalogue',
    label: 'Whole catalogues',
    matches: (b) =>
      ['catalogue_floor', 'works', 'active_span', 'series_span'].includes(b.metric),
  },
];

/** Split boards into their clusters, dropping any cluster nothing landed in. */
export function clusterBoards(
  section: CatalogueSection,
  boards: LeaderboardCatalogueEntry[],
): { label: string; note?: string; boards: LeaderboardCatalogueEntry[] }[] {
  if (!section.clusters) {
    return boards.length ? [{ label: '', boards }] : [];
  }

  const remaining = new Set(boards);
  const result = section.clusters.map(({ label, note, matches }) => {
    const matched = boards.filter((board) => remaining.has(board) && matches(board));
    matched.forEach((board) => remaining.delete(board));
    return { label, note, boards: matched };
  });

  // A board matching no cluster still has to appear. Losing one silently is how a registry
  // addition goes unnoticed until someone asks where their board went.
  if (remaining.size) {
    result.push({ label: 'More', note: undefined, boards: [...remaining] });
  }

  return result.filter((cluster) => cluster.boards.length > 0);
}
