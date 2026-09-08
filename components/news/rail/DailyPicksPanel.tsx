import Link from '@/components/Link';
import { NSFWImage } from '@/components/NSFWImage';
import { VNTitle } from '@/components/VNTitle';
import { getCoverSrc } from '@/lib/vndb-image-cache';
import { FuriganaText, stripFurigana, toHiragana } from '@/lib/furigana';
import type { VNOfTheDayData } from '@/lib/vn-of-the-day';
import type { WordOfTheDayData } from '@/lib/word-of-the-day';
import { vnPath } from '@/lib/news';
import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { RailPanel } from './RailPanel';

/** The two daily picks side by side: a title and a word. */
export function DailyPicksPanel({
  locale,
  vnOfTheDay,
  wordOfTheDay,
}: {
  locale: Locale;
  vnOfTheDay: VNOfTheDayData | null;
  wordOfTheDay: WordOfTheDayData | null;
}) {
  if (!vnOfTheDay && !wordOfTheDay) return null;
  const cover = vnOfTheDay?.image_url ? getCoverSrc(vnOfTheDay.image_url, { width: 128 }) : null;
  const vnHref = vnOfTheDay ? vnPath(vnOfTheDay.vn_id) : null;
  const reading = wordOfTheDay ? wordOfTheDay.main_reading.text : '';
  const kana = reading ? toHiragana(reading) : '';
  const gloss = wordOfTheDay?.definitions?.[0]?.meanings?.slice(0, 2).join('; ');

  return (
    <RailPanel plate={ns(locale, 'rail.picks')} href="/word-of-the-day/" hrefLabel={ns(locale, 'rail.picks.more')}>
      {vnOfTheDay && (
        <div className="nw-pick">
          <span className="nw-pick-label">{ns(locale, 'rail.vnOfTheDay')}</span>
          <div className="dg-feature">
            {cover && (
              <span className="dg-cover">
                <NSFWImage
                  src={cover}
                  alt={vnOfTheDay.title}
                  vnId={vnOfTheDay.vn_id}
                  imageSexual={vnOfTheDay.image_sexual ?? 0}
                  className="h-full w-full object-cover"
                  compact
                />
              </span>
            )}
            <span className="dg-stack">
              {vnHref ? (
                <Link href={vnHref} className="dg-feature-name">
                  <VNTitle
                    title={vnOfTheDay.title}
                    title_jp={vnOfTheDay.title_jp}
                    title_romaji={vnOfTheDay.title_romaji}
                  />
                </Link>
              ) : (
                <span className="dg-feature-name">{vnOfTheDay.title}</span>
              )}
              {vnOfTheDay.rating != null && (
                <span className="dg-feature-meta">
                  <span className="dg-figure">{vnOfTheDay.rating.toFixed(2)}</span>
                  {vnOfTheDay.votecount != null && ` · ${ns(locale, 'rail.votes', { n: vnOfTheDay.votecount.toLocaleString() })}`}
                </span>
              )}
            </span>
          </div>
        </div>
      )}
      {wordOfTheDay && (
        <div className="nw-pick">
          <span className="nw-pick-label">{ns(locale, 'rail.wordOfTheDay')}</span>
          <p className="dg-word" lang="ja">
            <FuriganaText text={reading} rubyClassName="dg-ruby" />
          </p>
          {kana !== stripFurigana(reading) && (
            <p className="dg-word-reading" lang="ja">
              {kana}
            </p>
          )}
          {gloss && <p className="dg-word-gloss">{gloss}</p>}
        </div>
      )}
    </RailPanel>
  );
}
