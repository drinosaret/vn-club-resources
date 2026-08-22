'use client';

import { useEffect, useState } from 'react';
import Link from '@/components/Link';
import { ArrowLeft, ArrowRight, Flame } from 'lucide-react';

import { FadeIn } from '@/components/FadeIn';
import { HotNow } from '@/components/stats/trends/HotNow';
import { MonthExplorer } from '@/components/stats/trends/MonthExplorer';
import { ReceptionShift } from '@/components/stats/trends/ReceptionShift';
import { TrendsUnavailable } from '@/components/stats/trends/TrendsUnavailable';
import {
  AnticipatedList,
  CommunityPulse,
  FinishingList,
  NewReleasesList,
} from '@/components/stats/trends/TrendFeedSections';
import { YearExplorer } from '@/components/stats/trends/YearExplorer';
import { StatsCrossLinks } from '@/components/stats/StatsCrossLinks';
import { LanguageFilter } from '@/components/stats/LanguageFilter';
import type { LanguageFilterValue } from '@/components/stats/LanguageFilter';
import { vndbStatsApi } from '@/lib/vndb-stats-api';
import type { TrendFeed } from '@/lib/vndb-stats-api';

/**
 * What is moving, and which way.
 *
 * The line this page holds against the global dashboard: nothing here can be answered once
 * and left. Every figure is either a window compared against the window before it, or a list
 * that turns over on its own as titles ship, dates pass and weeks roll off. A figure that is
 * fixed the moment it is computed belongs with the rest of the database's shape, however
 * interesting it is.
 *
 * The one exception is offered deliberately and labelled where it appears: the all-time tab on
 * reception movement, which is there because "always drifting, or only lately" is the question
 * the windowed tabs raise and cannot answer on their own.
 */

interface SectionProps {
  title: string;
  blurb: string;
  children: React.ReactNode;
  delay?: number;
}

function Section({ title, blurb, children, delay = 0 }: SectionProps) {
  return (
    <FadeIn delay={delay}>
      <section className="mb-12">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">{title}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 max-w-2xl">{blurb}</p>
        {children}
      </section>
    </FadeIn>
  );
}

export default function TrendsClient() {
  // Japanese-original by default, matching the board pages: the site is about reading
  // Japanese, and one control governs every display on the page rather than each carrying
  // its own and drifting out of step with the others.
  const [language, setLanguage] = useState<LanguageFilterValue>('ja');
  const [feed, setFeed] = useState<TrendFeed | null>(null);
  // Distinguishes "not back yet" from "did not come back". Both leave `feed` null, and
  // showing a loading shape for a request that already failed waits for nothing.
  const [feedFailed, setFeedFailed] = useState(false);

  // The service answers a missing cache with the feed's empty shape rather than an
  // error, and that shape carries no reference date. It is the only thing separating
  // a section with nothing in it from one whose figures have not been derived yet.
  const built = feed?.reference != null;

  useEffect(() => {
    let cancelled = false;
    setFeed(null);
    setFeedFailed(false);
    vndbStatsApi.getTrendFeed(language).then((result) => {
      if (cancelled) return;
      setFeed(result);
      setFeedFailed(result === null);
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <Link
        href="/stats/"
        className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Stats
      </Link>

      <header className="mt-4 mb-8">
        <div className="flex items-center gap-3 mb-3">
          <span className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-orange-100 dark:bg-orange-900/30">
            <Flame className="w-5 h-5 text-orange-600 dark:text-orange-400" />
          </span>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">
            Trends
          </h1>
        </div>
        <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl">
          What the community is reading right now, and what is climbing. Every figure here is
          measured against the period before it, so the page reads as movement rather than as a
          standing.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <LanguageFilter value={language} onChange={setLanguage} />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {language === 'ja'
              ? 'Every figure below counts votes on titles originally written in Japanese.'
              : 'Figures below count votes on titles in any original language. Still to come is the one exception: it keeps to upcoming Japanese releases, because a release in another language is usually a new edition of a title that already exists rather than something new.'}
          </p>
        </div>
      </header>

      <FadeIn>
        <section className="mb-12">
          <HotNow language={language} />
        </section>
      </FadeIn>

      <Section
        title="Reception on the move"
        blurb="Not which titles are rated highest, but which are being rated differently than usual. Pick the window: the week is where something happening right now shows up, the longer windows are steadier."
        delay={50}
      >
        {feed ? (
          <ReceptionShift periods={feed.shifting} />
        ) : feedFailed ? (
          <TrendsUnavailable what="Reception movement" />
        ) : (
          // Every placeholder on the page is sized to the card it stands in for, so the page
          // does not grow under a reader who scrolls while it loads.
          <div className="h-[57rem] sm:h-[29rem] rounded-xl image-placeholder" />
        )}
      </Section>

      <Section
        title="Arriving, finishing, still to come"
        blurb="Three lists that turn over without anything about the titles changing: one ages out, one counts an event with a date on it, and one empties as release dates pass."
        delay={100}
      >
        {feed ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="min-w-0">
              <NewReleasesList entries={feed.new_releases} built={built} />
            </div>
            <div className="min-w-0">
              <FinishingList entries={feed.finishing} built={built} />
            </div>
            <div className="min-w-0">
              <AnticipatedList entries={feed.anticipated} built={built} />
            </div>
          </div>
        ) : feedFailed ? (
          <TrendsUnavailable what="These three lists" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[28rem] lg:h-[29rem] rounded-xl image-placeholder" />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Month by month"
        blurb="The same two lenses as the top of the page, one month at a time. The right column is where a release, a translation or a sudden rediscovery shows up."
        delay={150}
      >
        <MonthExplorer language={language} />
      </Section>

      <Section
        title="Every year, from both sides"
        blurb="What came out in a year is not what people were reading in it. Both columns change as votes keep arriving, so a year reads differently a year from now."
        delay={200}
      >
        <YearExplorer language={language} />
      </Section>

      <Section
        title="The community itself"
        blurb="Whether the room measured above is growing or shrinking, week by week, and how much of it is arriving for the first time."
        delay={250}
      >
        {feed ? (
          <CommunityPulse weeks={feed.pulse} />
        ) : feedFailed ? (
          <TrendsUnavailable what="The community's own activity" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="h-[23rem] lg:h-[22.5rem] rounded-xl image-placeholder" />
            <div className="h-[23rem] lg:h-[22.5rem] rounded-xl image-placeholder" />
          </div>
        )}
      </Section>

      <FadeIn delay={300}>
        <section className="mb-12 rounded-xl border border-gray-200/60 dark:border-gray-700/80 bg-white dark:bg-gray-800 p-4 sm:p-5">
          <h2 className="font-semibold text-gray-900 dark:text-white">
            Looking for the long view?
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 max-w-2xl">
            How far back people read, which era they read, what was published each year and how
            the database itself was built are all on the global page. Those describe thirty
            years rather than this week.
          </p>
          <Link
            href="/stats/global/"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
          >
            Global stats
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </section>
      </FadeIn>

      <StatsCrossLinks current="trends" />
    </div>
  );
}
