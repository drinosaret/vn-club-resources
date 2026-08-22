import { Metadata } from 'next';
import UserStatsContent from './UserStatsContent';
import { generatePageMetadata, safeJsonLdStringify, generateBreadcrumbJsonLd, SITE_URL } from '@/lib/metadata-utils';

interface PageProps {
  params: Promise<{ uid: string }>;
  searchParams: Promise<{ username?: string; tab?: string }>;
}

// VNDB user ids are an optional "u" prefix plus digits; the digit bound keeps an oversized
// route segment out of the title and description.
const UID_PATTERN = /^u?\d{1,9}$/;

// VNDB usernames are 2 to 15 characters of letters, digits, hyphens and underscores.
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{2,15}$/;

/**
 * Resolve the name and copy shown for a reader page.
 *
 * The username arrives from the query string, so anything outside the VNDB username shape is
 * discarded in favour of a neutral label rather than reflected into the title, description,
 * Open Graph tags or structured data. One source for all of them keeps them in agreement.
 */
function readerIdentity(uid: string, username?: string) {
  const knownUid = UID_PATTERN.test(uid);
  const safeUid = knownUid ? uid : 'unknown';
  const trimmedName = username?.trim();
  const safeUsername = trimmedName && USERNAME_PATTERN.test(trimmedName) ? trimmedName : undefined;
  const displayName = safeUsername || `User ${safeUid}`;

  // The route matches any segment, so a path built from the raw one would put arbitrary text
  // in the canonical, the Open Graph tags and the structured data. A segment outside the id
  // shape names no reader, so it points at the section instead and stays out of the index.
  const path = knownUid ? `/stats/${uid}/` : '/stats/';

  return {
    knownUid,
    path,
    safeUsername,
    displayName,
    title: `${displayName}'s Stats`,
    description: `Visual novel reading statistics for ${displayName}: score distribution, favorite tags, developers and seiyuu, plus reading recommendations for anyone learning Japanese with visual novels.`,
  };
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { uid } = await params;
  const { username } = await searchParams;
  const { title, description, path, knownUid } = readerIdentity(uid, username);

  const metadata = generatePageMetadata({ title, description, path });
  return knownUid ? metadata : { ...metadata, robots: { index: false, follow: true } };
}

export default async function Page({ params, searchParams }: PageProps) {
  const { uid } = await params;
  const { username, tab } = await searchParams;
  const { safeUsername, displayName, title, description, path } = readerIdentity(uid, username);

  const pageUrl = `${SITE_URL}${path}`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      name: title,
      description,
      url: pageUrl,
      mainEntity: {
        '@type': 'Person',
        name: displayName,
      },
      isPartOf: { '@type': 'WebSite', name: 'VN Club', url: SITE_URL },
    },
    generateBreadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Stats', path: '/stats/' },
      { name: title, path },
    ]),
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <UserStatsContent key={uid} uid={uid} initialUsername={safeUsername} initialTab={tab} />
    </>
  );
}
