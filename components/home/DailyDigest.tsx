import Link from '@/components/Link';
import { NSFWImage } from '@/components/NSFWImage';
import { getCoverSrc } from '@/lib/vndb-image-cache';

import type { HotFeed } from '@/lib/hot-now';
import type { HomeNewsItem } from '@/lib/home-news';
import type { PulseTitle } from '@/lib/community-pulse';
import type { UpcomingReleasesData, UpcomingRelease } from '@/lib/upcoming-releases';
import type { VNOfTheDayData } from '@/lib/vn-of-the-day';
import type { WordOfTheDayData } from '@/lib/word-of-the-day';
import { FuriganaText, stripFurigana, toHiragana } from '@/lib/furigana';
import { formatReleaseDayBadge } from '@/lib/upcoming-releases';
import { platformLabel } from '@/lib/platforms';
import { stripBBCode } from '@/lib/bbcode';
import { VNTitle } from '@/components/VNTitle';
import { EntityName } from '@/components/EntityName';

import { WotdSentenceSource } from './WotdSentenceSource';

/**
 * The digest.
 *
 * Six windows onto the pages that hold the whole of each, chosen so that no two answer the same
 * question. Two are picks for the day; the rest are windows of a week, a month or a season that
 * the nightly import moves along, so the section is not described as a daily one. The test a panel has to pass is that it could read differently tomorrow: a ranking
 * that names the same five titles every week belongs on the rankings page, where somebody has
 * gone looking for a settled order, and not on a page people revisit.
 *
 * Everything is live. A panel whose source is unavailable is left out rather than drawn empty,
 * which is why each one checks its own data before rendering.
 */

interface DailyDigestProps {
  hot: HotFeed | null;
  newReleases: PulseTitle[];
  news: HomeNewsItem[];
  upcoming: UpcomingReleasesData | null;
  vnOfTheDay: VNOfTheDayData | null;
  wordOfTheDay: WordOfTheDayData | null;
}



/** Parts of a meta line, separated only where there is something on both sides of the mark. */
function separated(parts: React.ReactNode[]): React.ReactNode[] {
  return parts.flatMap((part, index) => (index === 0 ? [part] : [' · ', part]));
}

/**
 * The line under the daily title: what it scored, from how many, when, by whom and how long.
 *
 * Each part is dropped rather than shown empty, so a sparse record reads as a shorter line
 * instead of a row of blanks. The studio is an element rather than a string because the
 * script a name is shown in is the reader's setting.
 */
function dailyMeta(vn: VNOfTheDayData): React.ReactNode[] {
  const hours = vn.length_minutes ? Math.round(vn.length_minutes / 60) : null;
  const studio = vn.developers?.[0] ?? null;
  return separated(
    [
      vn.rating ? `${vn.rating.toFixed(2)}` : null,
      vn.votecount ? `${vn.votecount.toLocaleString()} votes` : null,
      vn.released ? vn.released.slice(0, 4) : null,
      studio ? <EntityName key="studio" name={studio.name} original={studio.original} /> : null,
      hours ? `${hours}h` : null,
    ].filter((part) => part !== null),
  );
}

/**
 * The line under an announced title: who is making it and what it runs on.
 *
 * A title with neither is still worth listing, so the line is dropped rather than filled with a
 * placeholder, and the row falls back to its name and date.
 */
function upcomingMeta(item: UpcomingRelease): React.ReactNode[] {
  const studio = item.developers[0] ?? null;
  return separated(
    [
      studio ? <EntityName key="studio" name={studio.name} original={studio.original} /> : null,
      item.platforms.length > 0
        ? item.platforms.slice(0, 2).map((code) => platformLabel(code)).join(' · ')
        : null,
    ].filter((part) => part !== null),
  );
}

/**
 * Cut a blurb at a word boundary.
 *
 * These are prose paragraphs of arbitrary length, and a hard character cut lands mid-word often
 * enough to read as broken markup rather than as an excerpt.
 */
function clamp(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.]$/, '')}…`;
}

/** A panel with its tab. The tab is the heading, so no icon sits beside it. */
function Panel({
  plate,
  href,
  hrefLabel,
  children,
}: {
  plate: string;
  href: string;
  hrefLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel dg-panel" aria-labelledby={`dg-${plate.replace(/\W+/g, '-').toLowerCase()}`}>
      <h3 id={`dg-${plate.replace(/\W+/g, '-').toLowerCase()}`} className="nameplate dg-plate">
        {plate}
      </h3>
      <div className="dg-body">{children}</div>
      <Link href={href} className="dg-more">
        {hrefLabel}
        <span aria-hidden> →</span>
      </Link>
    </section>
  );
}

export function DailyDigest({
  hot,
  newReleases,
  news,
  upcoming,
  vnOfTheDay,
  wordOfTheDay,
}: DailyDigestProps) {
  // Only titles that gained ground. A list mixing climbs and slips would need a column to say
  // which is which, and the panel has one line per title.
  //
  // Ordered by the same figure the rows show. The feed arrives ordered by a damped ratio of
  // the two windows, which is a reasonable way to choose what counts as a riser but not one
  // the reader can see, so a list left in that order reads as no order at all. Votes are
  // also what the movement is stated in: the place a title held before is a poor substitute,
  // because most of that ranking is titles tied on a single vote and ordered among
  // themselves by catalogue id.
  const climbing = (hot?.week?.movers ?? [])
    .filter((m) => m.placeChange === null || m.placeChange > 0)
    .sort((a, b) => b.current - a.current)
    .slice(0, 5);
  const weekDays = hot?.week?.days ?? 7;
  // Ordered as the feed sends them, which is by the votes they have drawn lately, and that
  // is the figure each row shows. A list ordered by one number and labelled with another
  // reads as no order at all.
  const justOut = newReleases.filter((title) => title.votes != null).slice(0, 5);
  // A panel with a date column shows titles that have one. Where only the month is known the
  // full listing still says so under its month heading, which is the right place for it.
  const outNext: UpcomingRelease[] = (upcoming?.items ?? [])
    .filter((item) => item.date_precision === 'day')
    .slice(0, 5);
  // Only a sentence short enough to sit in a panel is worth quoting; a long one would be cut
  // mid-clause, which in Japanese can invert what it says.
  const quotable = (wordOfTheDay?.example_sentences ?? []).filter(
    (s) => stripFurigana(s.text).length <= 48,
  );
  // The characters the word is written with, which is the other half of learning it. A word
  // written in kana alone has none, and the panel gives that room to a second sentence instead.
  const kanji = (wordOfTheDay?.kanji_info ?? []).slice(0, 3);
  const dailyParts = vnOfTheDay ? dailyMeta(vnOfTheDay) : [];
  const sentences = quotable.slice(0, kanji.length > 0 ? 1 : 2);

  // Every panel draws on the same source, and a source that cannot be reached resolves empty
  // rather than failing, so all six can be absent at once. The heading and the line under it
  // promise figures, which leaves nothing to head when no panel has any.
  const hasPanel =
    climbing.length >= 3 ||
    justOut.length > 0 ||
    news.length > 0 ||
    Boolean(vnOfTheDay) ||
    Boolean(wordOfTheDay) ||
    outNext.length > 0;
  if (!hasPanel) return null;

  return (
    <section aria-labelledby="digest" className="dg">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="sec-head">
          <div>
            <h2 id="digest" className="sec-title">
              The digest
            </h2>
            <p className="sec-sub">
              What is moving and what is new, with a title and a word for the day. The figures
              come from VNDB&apos;s public data.
            </p>
          </div>
        </div>

        <div className="dg-grid">
          {climbing.length >= 3 && (
            <Panel plate="Climbing this week" href="/stats/trends/" hrefLabel="All movement">
              <p className="dg-note">
                Votes cast on VNDB in the last {weekDays} days, against the {weekDays} days
                before.
              </p>
              <ul className="dg-list">
                {climbing.map((title) => (
                  <li key={title.id} className="dg-row">
                    <Link href={`${title.href}/`} className="dg-name block">
                      <VNTitle title={title.title} title_jp={title.title_jp} title_romaji={title.title_romaji} />
                    </Link>
                    <span className="dg-num">
                      <span className="dg-figure">{title.current.toLocaleString()}</span> votes,{' '}
                      {title.previous === 0 ? 'none before' : `was ${title.previous.toLocaleString()}`}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {justOut.length > 0 && (
            <Panel plate="Just out" href="/stats/trends/" hrefLabel="All new releases">
              <p className="dg-note">
                Out in the last six months, by the votes they have drawn in the last thirty
                days.
              </p>
              <ul className="dg-list">
                {justOut.map((title) => (
                  <li key={title.id} className="dg-row">
                    <Link href={`${title.href}/`} className="dg-name block">
                      <VNTitle title={title.title} title_jp={title.title_jp} title_romaji={title.title_romaji} />
                    </Link>
                    <span className="dg-num">
                      <span className="dg-figure">{(title.votes ?? 0).toLocaleString()}</span> votes
                      {title.score != null && ` · ${title.score.toFixed(1)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {news.length > 0 && (
            <Panel plate="Just catalogued" href="/news/all/" hrefLabel="All news">
              <p className="dg-note">
                New entries and new editions, as VNDB&apos;s catalogue records them.
              </p>
              <ul className="dg-list">
                {news.slice(0, 5).map((item) => {
                  // The row's target arrives with the feed rather than from this app, so only
                  // the two schemes a link should carry are followed.
                  const safeUrl = item.url && /^https?:\/\//.test(item.url) ? item.url : null;
                  return (
                  <li key={item.id} className="dg-row dg-row--news">
                    {safeUrl ? (
                      <a
                        href={safeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="dg-name block"
                      >
                        <VNTitle title={item.title} title_jp={item.title_jp} />
                      </a>
                    ) : (
                      <span className="dg-name block">
                        <VNTitle title={item.title} title_jp={item.title_jp} />
                      </span>
                    )}
                    {item.publishedAt && (
                      <span className="dg-when">{item.publishedAt.slice(5, 10)}</span>
                    )}
                  </li>
                  );
                })}
              </ul>
            </Panel>
          )}

          {vnOfTheDay && (
            <Panel
              plate="Today's title"
              href={`/vn/${vnOfTheDay.vn_id.replace('v', '')}/`}
              hrefLabel="Read about it"
            >
              <div className="dg-feature">
                <span className="dg-cover">
                  <NSFWImage
                    src={getCoverSrc(vnOfTheDay.image_url, 128)}
                    alt={vnOfTheDay.title}
                    imageSexual={vnOfTheDay.image_sexual}
                    vnId={vnOfTheDay.vn_id}
                    compact
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </span>
                <span className="dg-daily min-w-0">
                  <VNTitle
                    className="dg-feature-name"
                    title={vnOfTheDay.title}
                    title_jp={vnOfTheDay.title_jp}
                    title_romaji={vnOfTheDay.title_romaji}
                  />
                  {dailyParts.length > 0 && (
                    <span className="dg-feature-meta">{dailyParts}</span>
                  )}
                  {vnOfTheDay.description && (
                    <span className="dg-feature-blurb">
                      {clamp(stripBBCode(vnOfTheDay.description), 230)}
                    </span>
                  )}
                  {(vnOfTheDay.tags ?? []).length > 0 && (
                    <span className="dg-daily-tags">
                      {(vnOfTheDay.tags ?? []).slice(0, 3).map((tag) => (
                        <span key={tag.name} className="dg-daily-tag">
                          {tag.name}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </div>
            </Panel>
          )}

          {wordOfTheDay && (
            <Panel plate="Today's word" href="/word-of-the-day/" hrefLabel="Readings and examples">
              <p className="dg-word" lang="ja">
                <FuriganaText text={wordOfTheDay.main_reading.text} rubyClassName="dg-ruby" />
              </p>
              {toHiragana(wordOfTheDay.main_reading.text) !==
                stripFurigana(wordOfTheDay.main_reading.text) && (
                <p className="dg-word-reading" lang="ja">
                  {toHiragana(wordOfTheDay.main_reading.text)}
                </p>
              )}
              {wordOfTheDay.definitions?.[0]?.meanings?.[0] && (
                <p className="dg-word-gloss">
                  {wordOfTheDay.definitions[0].meanings.slice(0, 2).join('; ')}
                </p>
              )}
              {/* The count is the reason this word is here rather than in a dictionary: it is a
                  word somebody met while reading. */}
              {typeof wordOfTheDay.used_in_vns === 'number' && wordOfTheDay.used_in_vns > 0 && (
                <p className="dg-word-count">
                  Found in{' '}
                  <span className="dg-word-figure">
                    {wordOfTheDay.used_in_vns.toLocaleString()}
                  </span>{' '}
                  {wordOfTheDay.used_in_vns === 1 ? 'title' : 'titles'}
                </p>
              )}
              {sentences.map((sentence, index) => (
                <figure key={index} className="dg-example">
                  <blockquote className="dg-example-text" lang="ja">
                    <FuriganaText text={sentence.text} rubyClassName="dg-ruby" />
                  </blockquote>
                  <WotdSentenceSource sentence={sentence} className="dg-example-source" />
                </figure>
              ))}
              {kanji.length > 0 && (
                <ul className="dg-kanji">
                  {kanji.map((character) => (
                    <li key={character.character} className="dg-kanji-row">
                      <span className="dg-kanji-char" lang="ja">
                        {character.character}
                      </span>
                      <span className="dg-kanji-gloss">
                        {character.meanings.slice(0, 3).join(', ')}
                      </span>
                      {character.jlpt_level != null && (
                        <span className="dg-kanji-level">N{character.jlpt_level}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="wd-credit mt-3">
                Word data from{' '}
                <a href="https://jiten.moe" target="_blank" rel="noopener noreferrer">
                  jiten.moe
                </a>
              </p>
            </Panel>
          )}

          {outNext.length > 0 && (
            <Panel plate="Out next" href="/news/upcoming/" hrefLabel="All upcoming">
              <ul className="dg-list">
                {outNext.map((item) => (
                  <li key={item.id} className="dg-row dg-row--art">
                    <span className="dg-thumb">
                      {item.image_url && (
                        <NSFWImage
                          src={getCoverSrc(item.image_url, 128)}
                          alt={item.title_romaji || item.title}
                          imageSexual={item.image_sexual ?? 0}
                          vnId={item.id}
                          compact
                          className="w-full h-full object-cover object-top"
                          loading="lazy"
                        />
                      )}
                    </span>
                    <span className="dg-stack">
                      <Link href={`/vn/${item.id.replace('v', '')}/`} className="dg-name block">
                        <VNTitle title={item.title} title_jp={item.title_jp} title_romaji={item.title_romaji} />
                      </Link>
                      <span className="dg-sub">{upcomingMeta(item)}</span>
                    </span>
                    <span className="dg-num">{formatReleaseDayBadge(item)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </section>
  );
}
