import { weekEnd, type PulseWeek } from '@/lib/community-pulse';

/**
 * Half a year of reading, drawn.
 *
 * Two series over the same weeks: how many ratings were logged, and how many people logged
 * them. They are plotted on independent scales because the question each answers is about its
 * own shape, not about which number is larger, and a shared axis would flatten the smaller one
 * into a straight line.
 *
 * Drawn as plain SVG on the server. The page this sits on is a server component, and a charting
 * library would put a hydration boundary and a blank frame between the reader and the one thing
 * on the page that changes every week.
 */

interface WeeklyChartProps {
  weeks: PulseWeek[];
  /** Weeks to draw, counting back from the most recent. */
  span?: number;
}

const W = 640;
const H = 168;
const PAD_TOP = 10;
const PAD_BOTTOM = 6;

/** Points normalised into the plot band, each series against its own range. */
function series(values: number[]): { path: string; area: string; last: { x: number; y: number } } | null {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat run would divide by zero and is drawn along the middle rather than skipped.
  const span = max - min || 1;
  const plot = H - PAD_TOP - PAD_BOTTOM;
  const step = W / (values.length - 1);

  const points = values.map((value, i) => ({
    x: i * step,
    y: PAD_TOP + plot - ((value - min) / span) * plot,
  }));

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${path} L${W},${H} L0,${H} Z`;

  return { path, area, last: points[points.length - 1] };
}

/** A date as a reader would say it, from the ISO date the feed carries. */
function monthLabel(week: string): string {
  const [, month, day] = week.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const name = names[Number(month) - 1];
  return name ? `${name} ${Number(day)}` : week;
}

export function WeeklyChart({ weeks, span = 26 }: WeeklyChartProps) {
  const window = weeks.slice(-span);
  if (window.length < 2) return null;

  const votes = series(window.map((w) => w.votes));
  const readers = series(window.map((w) => w.readers));
  if (!votes) return null;

  const first = window[0];
  const last = window[window.length - 1];

  return (
    <div className="fig-chart">
      <p className="fig-chart-legend">
        <span className="fig-key fig-key--votes">Ratings logged</span>
        <span className="fig-key fig-key--readers">Readers</span>
      </p>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Weekly ratings and readers over the last ${window.length} weeks, ending ${weekEnd(last.week)}.`}
      >
        <defs>
          <linearGradient id="fig-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--kohaku)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--kohaku)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={votes.area} fill="url(#fig-fill)" />
        <path
          d={votes.path}
          fill="none"
          stroke="var(--kohaku)"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {readers && (
          <path
            d={readers.path}
            fill="none"
            stroke="var(--ai)"
            strokeWidth="1.25"
            strokeDasharray="3 3"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <circle cx={votes.last.x} cy={votes.last.y} r="3" fill="var(--kohaku)" vectorEffect="non-scaling-stroke" />
      </svg>

      <p className="fig-axis">
        <span>{monthLabel(first.week)}</span>
        <span>{monthLabel(weekEnd(last.week))}</span>
      </p>
    </div>
  );
}
