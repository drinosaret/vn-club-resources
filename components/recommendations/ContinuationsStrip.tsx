'use client';

import Link from '@/components/Link';
import { NSFWImage } from '@/components/NSFWImage';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { THUMBNAIL_IMAGE_WIDTH } from '@/components/vn/card-image-utils';
import { TitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { Continuation } from '@/lib/recommendation-types';

/**
 * Unread sequels of what the reader liked, kept apart from the discoveries.
 *
 * A sequel is something the reader already knows about, so it is a reminder rather than
 * a find, and a page that mixed the two would spend its top on reminders. The strip is
 * short and named for what it is; a reader who wants none of it scrolls past one row.
 */
export function ContinuationsStrip({
  items,
  titlePreference,
  hidden,
}: {
  items: Continuation[];
  titlePreference: TitlePreference;
  /** Titles the reader has hidden on this page; they are left out here too. */
  hidden: Set<string>;
}) {
  const shown = items.filter((item) => !hidden.has(item.vn_id));
  if (shown.length === 0) return null;

  return (
    <section aria-labelledby="rec-continue" className="mb-4">
      <h2 id="rec-continue" className="rc-label mb-2">Continue the series</h2>
      <ul className="flex gap-3 overflow-x-auto scrollbar-thin pb-1">
        {shown.map((item) => {
          const name = getDisplayTitle(
            { title: item.title, title_jp: item.title_jp ?? undefined, title_romaji: item.title_romaji ?? undefined },
            titlePreference,
          );
          const source = getDisplayTitle(
            {
              title: item.continues.title,
              title_jp: item.continues.title_jp ?? undefined,
              title_romaji: item.continues.title_romaji ?? undefined,
            },
            titlePreference,
          );
          const image = getProxiedImageUrl(item.image_url, { width: THUMBNAIL_IMAGE_WIDTH, vnId: item.vn_id });
          return (
            <li key={item.vn_id} className="shrink-0 w-40">
              <Link href={`/vn/${item.vn_id.replace('v', '')}`} className="rc-card h-full p-2">
                <span className="rc-art w-10 h-14 mb-1">
                  {item.image_url && (
                    <NSFWImage src={image || item.image_url} alt="" imageSexual={item.image_sexual} vnId={item.vn_id} compact className="w-full h-full object-cover" loading="lazy" />
                  )}
                </span>
                <span className="rc-name rc-name--small line-clamp-2" title={name}>{name}</span>
                {/* The score sits on its own line. Said as one sentence, a long source title
                    pushes the score past the two lines a card allows, and what survives is the
                    half that carries nothing: a title can be cut and still be recognised, a
                    score that ends mid-phrase cannot. */}
                <span className="rc-why line-clamp-2" title={source}>continues {source}</span>
                <span className="rc-why">you gave it {item.continues.score.toFixed(1)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
