import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getBoard } from '@/lib/vndb-server';
import type { Leaderboard, LeaderboardRow } from '@/lib/vndb-stats-api';
import {
  generatePageMetadata,
  safeJsonLdStringify,
  SITE_URL,
  generateBreadcrumbJsonLd,
  truncateDescription,
} from '@/lib/metadata-utils';

import LeaderboardClient from './LeaderboardClient';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** Turn a slug into something readable, for when the backend cannot be reached. */
function titleFromSlug(slug: string): string {
  const words = slug.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * What a search result should say about a board.
 *
 * Board blurbs are written to sit under a heading that already names the board, so most of
 * them are a single clause and far too short to stand alone as a description. Naming the
 * board and the source turns each one into a sentence that makes sense with no page around
 * it, and keeps two boards from reading identically.
 */
function boardDescription(board: { title: string; blurb: string; total_ranked: number }): string {
  const blurb = board.blurb.trim();
  const ranked = board.total_ranked
    ? `${board.total_ranked.toLocaleString()} ranked. `
    : '';
  const composed = `${board.title}: ${blurb}${blurb.endsWith('.') ? '' : '.'} ${ranked}`
    + 'Built from the daily VNDB dump on VN Club, for people reading Japanese visual novels.';

  return truncateDescription(composed, 200);
}

/** The schema type that matches what a board ranks. */
function itemTypeFor(subject: string): string {
  if (subject === 'user') return 'Person';
  if (subject === 'staff' || subject === 'seiyuu') return 'Person';
  if (subject === 'developer' || subject === 'publisher') return 'Organization';
  if (subject === 'tag' || subject === 'trait') return 'Thing';
  if (subject === 'series') return 'CreativeWorkSeries';
  return 'VideoGame';
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const lookup = await getBoard(slug);

  // A slug the registry does not know is kept out of the index by directive rather than by
  // status. A loading boundary covers this whole section, so the response has already begun
  // streaming by the time a page can decide to answer 404, and the status is fixed at 200 by
  // then. The body below is still the not-found page, so a reader is told plainly; this stops
  // the URL being indexed as a near-copy of the board whose name it almost spells.
  if (lookup.status === 'missing') {
    return {
      ...generatePageMetadata({
        title: `${titleFromSlug(slug)} - Visual Novel Rankings`,
        description:
          'This ranking does not exist. Browse every community leaderboard on VN Club, all '
          + 'built from the daily VNDB dump for people reading Japanese visual novels.',
        path: `/stats/rankings/${slug}/`,
      }),
      robots: { index: false, follow: true },
    };
  }

  if (lookup.status !== 'found') {
    return generatePageMetadata({
      title: `${titleFromSlug(slug)} - Visual Novel Rankings`,
      description:
        'A community leaderboard built from the daily VNDB dump on VN Club, for people '
        + 'reading Japanese visual novels. Every ranking states how it was counted.',
      path: `/stats/rankings/${slug}/`,
    });
  }

  return generatePageMetadata({
    title: `${lookup.board.title} - Visual Novel Rankings`,
    description: boardDescription(lookup.board),
    path: `/stats/rankings/${slug}/`,
  });
}

/**
 * The structured list a board is.
 *
 * Declaring an ItemList and leaving it empty describes a page that holds nothing. The rows
 * are already in hand from the same fetch that titled the page, so they travel with it.
 */
function boardJsonLd(slug: string, board: Leaderboard) {
  const itemType = itemTypeFor(board.subject);

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: board.title,
    description: board.blurb || undefined,
    url: `${SITE_URL}/stats/rankings/${slug}/`,
    numberOfItems: board.total_ranked || board.rows.length,
    itemListOrder: 'https://schema.org/ItemListOrderDescending',
    itemListElement: board.rows.slice(0, 100).map((row: LeaderboardRow) => ({
      '@type': 'ListItem',
      position: row.rank,
      item: {
        '@type': itemType,
        name: row.label,
        ...(row.href ? { url: `${SITE_URL}${row.href}/` } : {}),
      },
    })),
  };
}

export default async function LeaderboardPage({ params }: PageProps) {
  const { slug } = await params;
  const lookup = await getBoard(slug);

  // Only a registry that answered and did not know the slug justifies a 404. An unreachable
  // backend leaves the page to render its own unavailable state, which is a different thing
  // from the board not existing and must not be reported as one.
  if (lookup.status === 'missing') notFound();

  const board = lookup.status === 'found' ? lookup.board : null;
  const title = board?.title ?? titleFromSlug(slug);
  const onTrends = board?.home === 'trends';

  const jsonLd = [
    board
      ? boardJsonLd(slug, board)
      : {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: title,
          url: `${SITE_URL}/stats/rankings/${slug}/`,
        },
    // Follows where the board is catalogued rather than where it is served from: the two
    // pages share one board route, and a crumb pointing at a page the board is absent from
    // describes a path a reader cannot retrace.
    generateBreadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Stats', path: '/stats/' },
      onTrends
        ? { name: 'Trends', path: '/stats/trends/' }
        : { name: 'Rankings', path: '/stats/rankings/' },
      { name: title, path: `/stats/rankings/${slug}/` },
    ]),
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <LeaderboardClient key={slug} slug={slug} fallbackTitle={title} initialBoard={board} />
    </>
  );
}
