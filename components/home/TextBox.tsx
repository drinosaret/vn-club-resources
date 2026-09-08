import Image from 'next/image';

import Link from '@/components/Link';

import type { CommunityPulse } from '@/lib/community-pulse';

import { AdvanceMarker } from './AdvanceMarker';
import { PulseLine } from './PulseLine';

/**
 * The hero, arranged the way a visual novel arranges a screen.
 *
 * A quiet ground fills the frame, a panel sits inset over it, a nameplate hangs off the
 * panel's shoulder, the character stands behind its lower lip, and the choices sit underneath. Anyone who reads
 * these will recognise the arrangement before reading a word of it, and anyone who does not
 * still sees a headline, one true sentence and the ways in.
 *
 * The rule the whole thing rests on: the panel only ever says something that is true today and
 * traceable to a live source. No invented dialogue, and the mascot never speaks.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * A day said the way the band below the hero says it, so the same day is not printed two
 * ways on one page. The parts are read off the ISO string rather than through Date, which
 * would shift the day into the viewer's zone.
 */
function referenceLabel(iso: string): string {
  const [, month, day] = iso.split('-').map(Number);
  const name = MONTHS[month - 1];
  return name ? `${day} ${name}` : iso;
}

interface TextBoxProps {
  pulse: CommunityPulse | null;
  /** The section the advance marker moves to. */
  advanceTo: string;
}

export function TextBox({ pulse, advanceTo }: TextBoxProps) {
  return (
    <section className="tb" aria-labelledby="tb-h1">
      <span className="tb-mark" aria-hidden="true">
        魑魅魍魎
      </span>

      {/* She is the largest thing painted above the fold, so she is both preloaded and asked
          for first; the preload alone leaves the fetch at the default priority. */}
      <div className="tb-sprite" aria-hidden="true">
        <Image
          src="/assets/hikaruportrait.webp"
          alt=""
          width={300}
          height={330}
          priority
          fetchPriority="high"
          unoptimized
        />
      </div>

      <div className="tb-inner container mx-auto">
        <div className="panel panel--box on-box tb-box">
          <span className="tb-plates">
            <span className="nameplate">VN Club</span>
            {/* The day the page was built, in UTC like the news pages: a masthead dates
                itself, whatever day the figures beneath it reach. */}
            <span className="nameplate nameplate--quiet">
              {referenceLabel(new Date().toISOString().slice(0, 10))}
            </span>
          </span>

          <h1 id="tb-h1" className="tb-h1">
            Welcome to the club.
          </h1>

          {/* The club's own sentence about itself, and the reason anyone is here. It is set
              larger than body text because it is the proposition, not a caption under it. */}
          <p className="tb-motto">
            A community for those passionate about reading Japanese visual novels in their
            original, untranslated form.
          </p>

          {pulse && (
            <div className="mt-5">
              <PulseLine
                weeks={pulse.weeks}
                votesThisWeek={pulse.votesThisWeek}
                votesLastWeek={pulse.votesLastWeek}
                readersThisWeek={pulse.readersThisWeek}
              />
            </div>
          )}

          <AdvanceMarker targetId={advanceTo} />
        </div>

        <nav className="tb-choices on-box" aria-label="Where to start">
          {[
            { href: '/stats/', label: 'See your own reading, counted', detail: 'Your stats' },
            { href: '/recommendations/', label: 'Get something picked for you', detail: 'Recommendations' },
            { href: '/stats/rankings/', label: 'See where everything places', detail: 'Rankings' },
            { href: '/browse/', label: 'Find something to read', detail: 'Browse' },
            { href: '/guide/', label: 'New to Japanese?', detail: 'Start here' },
          ].map(({ href, label, detail }) => (
            <Link key={href} href={href} className="choice">
              <span className="flex-1 text-[color:var(--ink-box)]">{label}</span>
              <span className="tb-dest">{detail}</span>
            </Link>
          ))}
        </nav>

        {/* The two places a returning member goes that are not part of the site's content. */}
        <div className="tb-aside">
          <Link href="/join/" className="tb-aside-link">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
            </svg>
            Join the club on Discord
          </Link>
          <Link href="/changelog/" className="tb-aside-link">
            What&apos;s new
          </Link>
        </div>
      </div>
    </section>
  );
}
