import Link from '@/components/Link';
import { NSFWImage } from '@/components/NSFWImage';
import { getCoverSrc, getCoverSrcSet, type ImageWidth } from '@/lib/vndb-image-cache';

import { VNTitle } from '@/components/VNTitle';

import type { CommunityPulse, PulseTitle } from '@/lib/community-pulse';

import { WeeklyChart } from './WeeklyChart';

/**
 * The week, as figures and as titles.
 *
 * Both halves read the same seven days: how much was logged, and which titles the logging
 * moved. Kept apart they are two claims about the same window, and the counts take a screen of
 * their own before the titles are reached; together the counts are the scale the movements
 * happened at.
 *
 * These are VNDB's readers, not this site's members, and the heading says so. Presenting another
 * project's data as a measure of this community would be wrong twice over: it takes credit for
 * the figures and it misdescribes who they count.
 *
 * The figures are counted in seven-day windows ending on the dump's last day, so the newest
 * window is always whole and always reaches the reference date; the label names its first day.
 *
 * Names follow the reader's own script setting, through the one client component the band
 * delegates them to. Choosing per title rather than per reader is what leaves a list looking
 * half translated.
 */

/** Mirrors the `.shelf` grid's column count at each breakpoint. */
const SHELF_IMAGE_SIZES = '(max-width: 640px) 33vw, (max-width: 1024px) 25vw, 16vw';
const SHELF_SRCSET_WIDTHS: readonly ImageWidth[] = [128, 256];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface TheWeekProps {
  pulse: CommunityPulse;
}

interface Figure {
  label: string;
  value: number;
  previous: number | null;
}

/** A week start as a reader would say it, from the ISO date the feed carries. */
function weekLabel(week: string): string {
  const [, month, day] = week.split('-').map(Number);
  const name = MONTHS[month - 1];
  return name ? `${day} ${name}` : week;
}

/** The change as a reader would say it, or nothing when there is no week to compare against. */
function delta(value: number, previous: number | null): string | null {
  if (previous === null || previous <= 0) return null;
  const percent = Math.round(((value - previous) / previous) * 100);
  if (percent === 0) return 'level with last week';
  return `${Math.abs(percent)}% ${percent > 0 ? 'up' : 'down'} on last week`;
}

/** Two decimals, matching how a score is written everywhere else on the site. */
function figure(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toFixed(2) : '';
}

/* Direction is carried by the glyph rather than by colour. A title people rated lower is a fact
   about the week, not a fault. */
function Stat({ label, value, previous }: Figure) {
  const change = delta(value, previous);
  const rising = previous !== null && value > previous;

  return (
    <div>
      <span className="fig-label">{label}</span>
      <span className="fig-value">{value.toLocaleString()}</span>
      {change && (
        <span className="fig-delta">
          {previous !== null && previous > 0 && value !== previous && (
            <span className="fig-arrow" aria-hidden>
              {rising ? '▲' : '▼'}{' '}
            </span>
          )}
          {change}
        </span>
      )}
    </div>
  );
}

/** The figure a title moved by, written the same way under a cover and in the list below it. */
function Movement({ title, direction }: { title: PulseTitle; direction: 'up' | 'down' }) {
  return (
    <span className="shelf-figure">
      <span className="shelf-score">{figure(title.current_score)}</span>
      {title.shift != null && (
        <span className={direction === 'up' ? 'shelf-move--up' : 'shelf-move--down'}>
          {' '}
          <span aria-hidden>{direction === 'up' ? '▲' : '▼'}</span>
          {figure(Math.abs(title.shift))}
        </span>
      )}
      {title.window_votes != null && ` · ${title.window_votes} votes`}
    </span>
  );
}

export function TheWeek({ pulse }: TheWeekProps) {
  const weeks = pulse.weeks ?? [];
  const rising = pulse.rising ?? [];
  const falling = pulse.falling ?? [];

  // The most recent two complete weeks. Anything shorter cannot state a comparison, so the
  // figures are left out rather than shown as bare numbers and the titles carry the band alone.
  const current = weeks[weeks.length - 1];
  const before = weeks[weeks.length - 2];

  // The week the figures cover. The shelves below are measured over a rolling seven days
  // ending on the reference date, so each block names its own window rather than taking one
  // from the section caption.
  const figuresWeek = current && before ? current.week : null;

  const figures: Figure[] =
    current && before
      ? [
          { label: 'Ratings logged', value: current.votes, previous: before.votes },
          { label: 'Readers', value: current.readers, previous: before.readers },
          { label: 'First time here', value: current.new_readers, previous: before.new_readers },
        ]
      : [];

  if (figures.length === 0 && rising.length === 0 && falling.length === 0) return null;

  return (
    <section id="picked-up" aria-labelledby="the-week" className="band scroll-mt-20">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="sec-head">
          <div>
            <h2 id="the-week" className="sec-title">
              This week on VNDB
            </h2>
            <p className="sec-sub">
              Counted from the public vote record rather than from this site.
            </p>
          </div>
          <Link href="/stats/global/" className="sec-more">
            All the VNDB figures
            <span aria-hidden>&rarr;</span>
          </Link>
        </div>

        {figuresWeek && (
          <p className="wk-note mb-4">Seven days from {weekLabel(figuresWeek)}.</p>
        )}

        {figures.length > 0 && (
          <div className="wk">
            <div className="wk-figs">
              {figures.map((entry) => (
                <Stat key={entry.label} {...entry} />
              ))}
            </div>
            <WeeklyChart weeks={weeks} />
          </div>
        )}

        {rising.length > 0 && (
          <div className="wk-titles">
            <div className="wk-head">
              <h3 className="nameplate nameplate--plain">Rated higher</h3>
              <p className="wk-note">
                Each title&apos;s average over the week&apos;s votes, against its own all-time
                average{pulse.reference ? `, to ${weekLabel(pulse.reference)}` : ''}.
              </p>
            </div>
            <ul className="shelf">
              {rising.slice(0, 6).map((title) => (
                <li key={title.id}>
                  <Link href={`${title.href}/`} className="shelf-item block">
                    <span className="shelf-art">
                      <NSFWImage
                        src={getCoverSrc(title.image_url, 256)}
                        srcSet={getCoverSrcSet(title.image_url, SHELF_SRCSET_WIDTHS, { vnId: title.id })}
                        sizes={SHELF_IMAGE_SIZES}
                        alt={title.title}
                        imageSexual={title.image_sexual}
                        vnId={title.id}
                        compact
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </span>
                    <VNTitle
                      className="shelf-name"
                      title={title.title}
                      title_jp={title.title_jp}
                      title_romaji={title.title_romaji}
                    />
                    <Movement title={title} direction="up" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {falling.length > 0 && (
          <div className="tail">
            <div className="wk-head">
              <h3 className="nameplate nameplate--plain">Rated lower</h3>
              {pulse.reference && (
                <p className="wk-note">Seven days to {weekLabel(pulse.reference)}.</p>
              )}
            </div>
            <ul className="tail-list">
              {falling.slice(0, 6).map((title) => (
                <li key={title.id}>
                  <Link href={`${title.href}/`}>
                    <VNTitle title={title.title} title_jp={title.title_jp} title_romaji={title.title_romaji} />
                  </Link>
                  <Movement title={title} direction="down" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
