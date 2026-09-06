// Does the site still render.
//
// The typechecker cannot see a page that throws while rendering, a server component that
// reaches for something absent, or a fetch that never resolves. This asks the running dev
// server for the routes that matter and checks that each one answers and still contains the
// thing that makes it that page.
//
// It needs `npm run dev` up. Without it every route fails at once, which the summary says
// plainly rather than reporting twelve separate failures.
//
//   node scripts/smoke.mjs
//   node scripts/smoke.mjs --base http://localhost:3000

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const BASE = flag('base', 'http://localhost:3000').replace(/\/$/, '');
const TIMEOUT_MS = 90_000;

// A page is not merely a 200. Each route names something that only appears when the page
// actually rendered, so an error boundary or an empty shell reads as a failure.
const ROUTES = [
  { path: '/', expect: 'Japanese Visual Novels' },
  { path: '/browse/', expect: 'Browse' },
  { path: '/recommendations/', expect: 'Recommendations' },
  { path: '/stats/', expect: 'Stats' },
  { path: '/stats/global/', expect: 'Global' },
  { path: '/stats/rankings/', expect: 'Rankings' },
  { path: '/stats/trends/', expect: 'Trends' },
  { path: '/events/', expect: 'Events' },
  { path: '/events/history/', expect: 'Past Club Picks' },
  { path: '/news/upcoming/', expect: 'Upcoming Visual Novel Releases' },
  { path: '/guide/', expect: 'Japanese' },
  { path: '/guides/', expect: 'Guides' },
  { path: '/beginner-vns/', expect: 'Beginner' },
  { path: '/word-of-the-day/', expect: 'Word' },
  { path: '/changelog/', expect: 'Changelog' },
  { path: '/vn/17/', expect: 'Ever17' },
  { path: '/quiz/', expect: 'Quiz' },
  { path: '/join/', expect: 'Discord' },
];

async function check({ path: route, expect }) {
  const url = `${BASE}${route}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    const body = await res.text();
    if (!res.ok) return { route, ok: false, why: `HTTP ${res.status}` };
    if (expect && !body.includes(expect)) {
      return { route, ok: false, why: `rendered without "${expect}"` };
    }
    // A page that rendered its error boundary still answers 200.
    if (/Application error|something went wrong/i.test(body)) {
      return { route, ok: false, why: 'rendered an error boundary' };
    }
    return { route, ok: true, bytes: body.length };
  } catch (err) {
    return { route, ok: false, why: err.name === 'AbortError' ? 'timed out' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

// Sequential on purpose: the dev server compiles each route on first request, and asking for
// sixteen at once makes them all look slow and can exhaust its worker pool.
const results = [];
for (const route of ROUTES) {
  const r = await check(route);
  results.push(r);
  console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.route}${r.ok ? '' : `  (${r.why})`}`);
}

const failures = results.filter((r) => !r.ok);
if (failures.length === results.length) {
  console.log(`\nsmoke: every route failed, so the server at ${BASE} is probably not running`);
  process.exit(1);
}
console.log(failures.length === 0 ? '\nsmoke: green' : `\nsmoke: ${failures.length}/${results.length} route(s) failed`);
process.exit(failures.length === 0 ? 0 : 1);
