import { getAllContent } from '@/lib/mdx';
import Link from '@/components/Link';
import { ArrowRight, BookOpen } from 'lucide-react';
import type { Metadata } from 'next';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

const HUB_DESCRIPTION =
  'Every setup guide on VN Club: text hookers, popup dictionaries, Anki mining, OCR, upscaling and emulation, so you can read Japanese visual novels in the original.';

export const metadata: Metadata = generatePageMetadata({
  title: 'Visual Novel Setup Guides',
  description: HUB_DESCRIPTION,
  path: '/guides/',
});

/**
 * The slug of the long-form walkthrough, which is the one thing a first-time reader should
 * open. It is featured on its own above the index rather than listed among the tool guides,
 * so the two pages read as a walkthrough and its appendix rather than as rivals.
 */
const FEATURED_SLUG = 'guide';

/**
 * Ordered groups for the index. A slug listed here that has no file is skipped, and a file
 * whose slug appears in no group still lists under the trailing group, so adding an .mdx to
 * content/guides is enough to publish it.
 */
const GROUPS: { title: string; blurb: string; slugs: string[] }[] = [
  {
    title: 'Getting the text out of the game',
    blurb: 'Capture Japanese text as it appears on screen so a dictionary can read it.',
    slugs: ['textractor-guide', 'agent-guide', 'owocr-guide', 'meikipop-guide'],
  },
  {
    title: 'Dictionaries and vocabulary',
    blurb: 'Look words up without leaving the scene, and keep the ones worth keeping.',
    slugs: ['jl-guide', 'yomitan-guide', 'anki-guide'],
  },
  {
    title: 'Running visual novels anywhere',
    blurb: 'Linux, Android and decades-old Japanese hardware.',
    slugs: ['bottles-guide', 'kirikiroid-guide', 'gamehub-lite-guide', 'np2-guide'],
  },
  {
    title: 'Picture quality',
    blurb: 'Scaling and shaders for titles that were drawn for a smaller screen.',
    slugs: ['magpie-guide', 'shaderglass-guide'],
  },
  {
    title: 'Finding and tracking',
    blurb: 'Where the titles are, and how to see what you have read.',
    slugs: ['find', 'sources', 'tools', 'jdownloader-guide', 'timetracker-guide'],
  },
];

const TRAILING_GROUP_TITLE = 'Everything else';

const guidesJsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Visual Novel Setup Guides',
    description: HUB_DESCRIPTION,
    url: `${SITE_URL}/guides/`,
    isPartOf: { '@type': 'WebSite', name: 'VN Club', url: SITE_URL },
  },
  generateBreadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Guides', path: '/guides/' },
  ]),
];

function GuideCard({ slug, title, description }: { slug: string; title: string; description?: string }) {
  return (
    <Link
      href={`/${encodeURIComponent(slug)}`}
      className="group block h-full bg-[color:var(--surface)] rounded-xs border border-[color:var(--rule)] hover:border-[color:var(--kohaku)] transition-colors p-5"
    >
      <h3 className="font-display text-lg font-semibold mb-1 text-[color:var(--ink)] group-hover:text-[color:var(--ai)] transition-colors">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-[color:var(--nezu)] leading-relaxed">{description}</p>
      )}
    </Link>
  );
}

export default async function GuidesPage() {
  const guides = getAllContent('guides');
  const bySlug = new Map(guides.map((guide) => [guide.slug, guide]));

  const featured = bySlug.get(FEATURED_SLUG);
  const placed = new Set<string>(featured ? [FEATURED_SLUG] : []);

  const groups = GROUPS.map((group) => {
    const items = group.slugs.flatMap((slug) => {
      const guide = bySlug.get(slug);
      if (!guide || placed.has(slug)) return [];
      placed.add(slug);
      return [guide];
    });
    return { ...group, items };
  }).filter((group) => group.items.length > 0);

  const trailing = guides.filter((guide) => !placed.has(guide.slug));

  const allGroups = trailing.length > 0
    ? [...groups, { title: TRAILING_GROUP_TITLE, blurb: '', items: trailing }]
    : groups;

  return (
    <>
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(guidesJsonLd) }}
    />
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <h1 className="font-display text-4xl font-bold mb-4 text-[color:var(--ink)]">
        Visual Novel Setup Guides
      </h1>
      <p className="text-lg text-[color:var(--nezu)] mb-10 max-w-3xl">
        Text hookers, popup dictionaries, Anki mining, OCR, upscaling and emulation. Each guide
        is written for reading the original Japanese, with screenshots and the settings that
        matter.
      </p>

      {featured && (
        <Link
          href={`/${encodeURIComponent(featured.slug)}`}
          className="group block mb-12 rounded-xs border border-[color:var(--rule)] bg-[color:var(--surface-inset)] p-6 hover:border-[color:var(--kohaku)] transition-colors"
        >
          <div className="flex items-start gap-4">
            <div className="mt-1 shrink-0">
              <BookOpen className="w-6 h-6 text-[color:var(--ai)]" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="nameplate mb-2">
                Start here
              </p>
              <h2 className="font-display text-2xl font-semibold mb-2 text-[color:var(--ink)] group-hover:text-[color:var(--ai)] transition-colors">
                {featured.title}
              </h2>
              {featured.description && (
                <p className="text-[color:var(--nezu)]">{featured.description}</p>
              )}
              <span className="sec-more mt-3">
                Read the walkthrough
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </span>
            </div>
          </div>
        </Link>
      )}

      <div className="space-y-12">
        {allGroups.map((group) => (
          <section key={group.title}>
            <h2 className="font-display text-2xl font-bold mb-1 text-[color:var(--ink)]">
              {group.title}
            </h2>
            {group.blurb && (
              <p className="text-[color:var(--nezu)] mb-5">{group.blurb}</p>
            )}
            <div className={`grid gap-4 sm:grid-cols-2 ${group.blurb ? '' : 'mt-5'}`}>
              {group.items.map((guide) => (
                <GuideCard
                  key={guide.slug}
                  slug={guide.slug}
                  title={guide.title}
                  description={guide.description}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
    </>
  );
}
