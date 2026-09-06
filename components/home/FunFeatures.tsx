import Link from '@/components/Link';
import { getCoverSrc } from '@/lib/vndb-image-cache';
import { HOMEPAGE_COVER_THRESHOLD } from '@/lib/safe-cover';

import type { FeaturedVNData } from '@/lib/featured-vns';
import type { CommunityPulse } from '@/lib/community-pulse';

/**
 * The things on this site that are not work.
 *
 * They were a row of text links, which undersells a tier list and a roulette wheel: nobody
 * clicks a word to find out what a toy does. Each block draws a small, still version of the
 * thing itself, so the shape of it is the advertisement.
 *
 * The previews are drawn from covers the page has already fetched for other sections, so the
 * band costs no request of its own. They are decoration and carry no link and no caption; the
 * whole block is one target.
 */

const PREVIEW_COVERS = 9;

interface FunFeaturesProps {
  /** Local, and cannot fail on the network, so a preview always has something to draw. */
  fallbackCovers: FeaturedVNData[];
  pulse: CommunityPulse | null;
}

/**
 * Covers safe to draw here.
 *
 * These are plain images with no reveal, so a cover that would merely be blurred elsewhere is
 * dropped rather than shown. The previews are decoration and can afford to lose a title.
 */
function safeCovers(fallback: FeaturedVNData[], pulse: CommunityPulse | null): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  const consider = (id: string, url: string | null | undefined, sexual: number | null | undefined) => {
    if (seen.has(id) || !url) return;
    seen.add(id);
    if ((sexual ?? 0) >= HOMEPAGE_COVER_THRESHOLD) return;
    const src = getCoverSrc(url, 128);
    if (src) urls.push(src);
  };

  for (const vn of fallback) consider(vn.id, vn.imageUrl, vn.image_sexual);
  for (const title of pulse?.rising ?? []) consider(title.id, title.image_url, title.image_sexual);
  for (const title of pulse?.newReleases ?? []) consider(title.id, title.image_url, title.image_sexual);

  return urls;
}

/** A cover at a fixed slot, wrapping so a short pool still fills a preview. */
function cover(covers: string[], index: number): string | null {
  return covers.length > 0 ? covers[index % covers.length] : null;
}

function Art({ src }: { src: string | null }) {
  if (!src) return <span className="fun-cell fun-cell--empty" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="fun-cell" src={src} alt="" loading="lazy" decoding="async" />;
}

export function FunFeatures({ fallbackCovers, pulse }: FunFeaturesProps) {
  const covers = safeCovers(fallbackCovers, pulse);
  const at = (i: number) => cover(covers, i);

  return (
    <section aria-labelledby="fun" className="fun">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="sec-head">
          <div>
            <h2 id="fun" className="sec-title">
              Things to play with
            </h2>
            <p className="sec-sub">
              Free, no account, and they all run in the browser.
            </p>
          </div>
        </div>

        <ul className="fun-grid">
          <FunCard
            href="/tierlist/"
            name="Tier List"
            blurb="Drag your VNDB ratings into tiers, name the tiers, export the picture."
          >
            {/* Two tiers with their labels, which is the whole interface in miniature. */}
            <span className="fun-tier">
              <span className="fun-tier-label fun-tier-label--s">S</span>
              <Art src={at(0)} />
              <Art src={at(1)} />
              <Art src={at(2)} />
            </span>
            <span className="fun-tier">
              <span className="fun-tier-label fun-tier-label--a">A</span>
              <Art src={at(3)} />
              <Art src={at(4)} />
            </span>
          </FunCard>

          <FunCard
            href="/3x3-maker/"
            name="3x3 Maker"
            blurb="The nine you would show someone, cropped and exported as one image."
          >
            <span className="fun-nine">
              {Array.from({ length: PREVIEW_COVERS }, (_, i) => (
                <Art key={i} src={at(i)} />
              ))}
            </span>
          </FunCard>

          <FunCard
            href="/roulette/"
            name="Roulette"
            blurb="Put the shortlist on a wheel and let it decide. Group mode splits it between friends."
          >
            <span className="fun-wheel" aria-hidden>
              <span className="fun-wheel-face" />
              <span className="fun-wheel-pin" />
            </span>
          </FunCard>

          <FunCard
            href="/higher-or-lower/"
            name="Higher or Lower"
            blurb="Two titles, one question: which one does everybody rate higher?"
          >
            <span className="fun-versus">
              <Art src={at(5)} />
              <span className="fun-versus-mark" aria-hidden>
                ?
              </span>
              <Art src={at(6)} />
            </span>
          </FunCard>

          <FunCard
            href="/random/"
            name="Random Picker"
            blurb="Roll for something to read, narrowed by tag, length, rating and language."
          >
            <span className="fun-roll">
              <Art src={at(7)} />
              <Art src={at(2)} />
              <Art src={at(4)} />
            </span>
          </FunCard>

          <FunCard
            href="/quiz/"
            name="Kana Quiz"
            blurb="Hiragana and katakana on sight, with a streak to keep you honest."
          >
            <span className="fun-kana" aria-hidden>
              <span lang="ja">あ</span>
              <span lang="ja">ア</span>
              <span lang="ja">を</span>
            </span>
          </FunCard>
        </ul>
      </div>
    </section>
  );
}

function FunCard({
  href,
  name,
  blurb,
  children,
}: {
  href: string;
  name: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link href={href} className="fun-card">
        <span className="fun-art" aria-hidden>
          {children}
        </span>
        <span className="fun-name">{name}</span>
        <span className="fun-blurb">{blurb}</span>
      </Link>
    </li>
  );
}
