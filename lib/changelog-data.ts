// Changelog entries, newest first. Major user-facing changes only.

export type ChangelogProject = 'site' | 'hikaru' | 'muramasa' | 'ichijou';

export interface ChangelogLink {
  label: string;
  href: string; // internal path or external URL
}

export interface ChangelogEntry {
  date: string; // YYYY-MM-DD
  project: ChangelogProject;
  title: string;
  description: string;
  links?: ChangelogLink[];
}

export interface ProjectMeta {
  label: string;
  blurb: string;
  chip: string;
}

export const CHANGELOG_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Dates are sliced as strings: new Date('YYYY-MM-DD') parses as UTC and can
// shift the displayed day depending on the timezone.
export function formatChangelogDay(date: string): string {
  return `${CHANGELOG_MONTHS[Number(date.slice(5, 7)) - 1].slice(0, 3)} ${Number(date.slice(8, 10))}`;
}

export const PROJECT_META: Record<ChangelogProject, ProjectMeta> = {
  site: {
    label: 'vnclub.org',
    blurb: 'The website',
    chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  },
  hikaru: {
    label: 'Hikaru',
    blurb: 'Cross-server reading club bot',
    chip: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200',
  },
  muramasa: {
    label: 'Muramasa',
    blurb: 'VNCR server bot',
    chip: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
  },
  ichijou: {
    label: 'Ichijou',
    blurb: 'vnclub.org Discord bot',
    chip: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  },
};

export const changelogEntries: ChangelogEntry[] = [
  {
    date: '2026-06-14',
    project: 'muramasa',
    title: 'Role menu',
    description: 'Pick your own roles from a self-serve menu in the server.',
  },
  {
    date: '2026-06-10',
    project: 'site',
    title: 'Changelog',
    description: 'Added this page: one place to follow major updates across the site and the club bots.',
  },
  {
    date: '2026-06-10',
    project: 'site',
    title: 'Higher or Lower game',
    description: 'Guess which of two visual novels ranks higher by VNDB votes, rating, or release year, and build a streak.',
    links: [{ label: 'Higher or Lower', href: '/higher-or-lower/' }],
  },
  {
    date: '2026-06-09',
    project: 'site',
    title: 'Events calendar',
    description: 'New calendar page showing VN of the Month and Season, Movie Night, and other club events.',
    links: [{ label: 'Events', href: '/events/' }],
  },
  {
    date: '2026-06-09',
    project: 'ichijou',
    title: 'Movie Night',
    description: 'Nominate films and vote any time, right in Discord. Winners are announced and published to the events calendar.',
  },
  {
    date: '2026-05-31',
    project: 'muramasa',
    title: 'Jiten.moe on VN logs',
    description: 'VN log embeds now link to jiten.moe and use its covers when the VN is on jiten.',
  },
  {
    date: '2026-05-20',
    project: 'muramasa',
    title: 'VN of the Month moved to Hikaru',
    description: 'The legacy monthly commands were retired, including the pool, completions, and leaderboard. The feature now runs on Hikaru as part of the reading club overhaul.',
  },
  {
    date: '2026-05-12',
    project: 'hikaru',
    title: 'Reading club overhaul',
    description: 'Voting cycles with nominations, image-rendered banner, profile, club stats, badges, and season overview cards, per-guild scoping with manager grants, and deeper jiten.moe and VNDB integration.',
  },
  {
    date: '2026-05-01',
    project: 'muramasa',
    title: 'Monthly banner',
    description: 'VN of the Month announcements now include a rendered banner image with covers and reading stats.',
  },
  {
    date: '2026-04-25',
    project: 'muramasa',
    title: 'Kizuna auto-logging',
    description: 'Reading sessions from the Kizuna texthooker are logged automatically as VN reads.',
  },
  {
    date: '2026-04-14',
    project: 'site',
    title: 'FAQ page',
    description: 'Answers to common questions about learning Japanese with visual novels.',
    links: [{ label: 'FAQ', href: '/faq/' }],
  },
  {
    date: '2026-04-09',
    project: 'site',
    title: 'Word of the Day',
    description: 'A daily Japanese word with VN example sentences, on the site and posted to Discord by Ichijou.',
    links: [{ label: 'Word of the Day', href: '/word-of-the-day/' }],
  },
  {
    date: '2026-03-17',
    project: 'site',
    title: 'Roulette',
    description: 'Add VNs to a wheel and spin to pick your next read, with a group mode for club picks.',
    links: [{ label: 'Roulette', href: '/roulette/' }],
  },
  {
    date: '2026-03-13',
    project: 'site',
    title: 'Level 1 vocabulary page',
    description: 'Vocabulary practice for absolute beginners, alongside the kana quiz.',
    links: [{ label: 'Level 1', href: '/level1/' }],
  },
  {
    date: '2026-03-07',
    project: 'site',
    title: '3x3 Maker, Tier List, and Beginner VNs',
    description: 'Build VN cover collages and tier lists you can share with a link, and browse a curated list of beginner-friendly VNs.',
    links: [
      { label: '3x3 Maker', href: '/3x3-maker/' },
      { label: 'Tier List', href: '/tierlist/' },
      { label: 'Beginner VNs', href: '/beginner-vns/' },
    ],
  },
  {
    date: '2026-02-25',
    project: 'site',
    title: 'NSFW uncensor setting',
    description: 'A new settings-menu option shows NSFW covers uncensored site-wide, remembered across visits; click-to-reveal stays the default.',
  },
  {
    date: '2026-02-23',
    project: 'site',
    title: 'VN of the Day and Random page',
    description: 'A daily featured VN and a filterable random VN picker.',
    links: [{ label: 'Random', href: '/random/' }],
  },
  {
    date: '2026-02-23',
    project: 'ichijou',
    title: 'Daily Discord posts',
    description: 'Ichijou posts the daily featured VN and a summary of the day\'s VN news to Discord.',
  },
  {
    date: '2026-02-19',
    project: 'site',
    title: 'Public API',
    description: 'The backend API behind the stats browser is documented and open for third-party use.',
  },
  {
    date: '2026-02-19',
    project: 'site',
    title: 'Safer browsing defaults',
    description: 'Sexual tags and traits are hidden by default on VN and character pages.',
  },
  {
    date: '2026-02-18',
    project: 'site',
    title: 'External links on VN pages',
    description: 'VN pages now show official site and store links in the sidebar, pulled from VNDB release data.',
  },
  {
    date: '2026-02-16',
    project: 'site',
    title: 'Site-wide VN search',
    description: 'The top search bar now returns VN results directly.',
  },
  {
    date: '2026-02-15',
    project: 'site',
    title: 'VN language stats tab',
    description: 'VN detail pages gained a language stats tab.',
  },
  {
    date: '2026-02-13',
    project: 'site',
    title: 'VN stats tab and jiten links',
    description: 'VN pages gained a stats tab with rating insights and comparisons, plus links to jiten.moe. Browse pages added a random button.',
  },
  {
    date: '2026-02-08',
    project: 'site',
    title: 'Stats browser launch',
    description: 'Browse VNs, Recommendations, VNDB Stats, VN News, and the Kana Quiz, plus a homepage redesign. Powered by a new backend fed by daily VNDB data dumps.',
    links: [
      { label: 'Browse', href: '/browse/' },
      { label: 'Stats', href: '/stats/' },
      { label: 'Recommendations', href: '/recommendations/' },
      { label: 'News', href: '/news/' },
      { label: 'Kana Quiz', href: '/quiz/' },
    ],
  },
  {
    date: '2026-02-08',
    project: 'ichijou',
    title: 'Ichijou launched',
    description: 'A new Discord bot for vnclub.org, launched alongside the stats backend.',
  },
  {
    date: '2026-02-08',
    project: 'site',
    title: 'Yomitan and Bottles guides',
    description: 'Two new guides shipped alongside the stats browser launch: the Yomitan pop-up dictionary, and playing VNs on Linux with Bottles.',
    links: [
      { label: 'Yomitan Guide', href: '/yomitan-guide/' },
      { label: 'Bottles Guide', href: '/bottles-guide/' },
    ],
  },
  {
    date: '2026-02-03',
    project: 'muramasa',
    title: 'VN news feed retired',
    description: 'The in-server VN and eroge news feed was removed. News coverage moved to the vnclub.org news page.',
    links: [{ label: 'News', href: '/news/' }],
  },
  {
    date: '2026-01-09',
    project: 'muramasa',
    title: 'Per-title log totals',
    description: 'Log views now show per-title totals: total time, characters, and log counts.',
  },
  {
    date: '2025-12-20',
    project: 'site',
    title: 'Android play guides',
    description: 'New guides for reading VNs on Android: GameHub Lite, Kirikiroid2, and a mobile texthooker setup.',
    links: [
      { label: 'GameHub Lite Guide', href: '/gamehub-lite-guide/' },
      { label: 'Kirikiroid2 Guide', href: '/kirikiroid-guide/' },
    ],
  },
  {
    date: '2025-12-14',
    project: 'site',
    title: 'Site redesign on Next.js',
    description: 'The site was rebuilt from the ground up on Next.js with a new design and navigation. Five new guides launched with it, covering Anki, Meikipop, Magpie, NP2, and ShaderGlass.',
    links: [
      { label: 'Anki Guide', href: '/anki-guide/' },
      { label: 'Meikipop Guide', href: '/meikipop-guide/' },
      { label: 'Magpie Guide', href: '/magpie-guide/' },
      { label: 'NP2 Guide', href: '/np2-guide/' },
      { label: 'ShaderGlass Guide', href: '/shaderglass-guide/' },
    ],
  },
  {
    date: '2025-12-10',
    project: 'hikaru',
    title: 'Logging quality of life',
    description: 'Title autocomplete with VNDB IDs, a log update command, and improved undo.',
  },
  {
    date: '2025-12-05',
    project: 'muramasa',
    title: 'Quiz verification on Sakura',
    description: 'Sakura, the anime sub-bot for LJTA, now supports quiz verification.',
  },
  {
    date: '2025-12-01',
    project: 'muramasa',
    title: 'Log overview',
    description: 'A new log overview command with server-wide and global immersion stats: activity timelines, media breakdowns, and top readers and titles.',
  },
  {
    date: '2025-11-30',
    project: 'muramasa',
    title: 'VN news feed',
    description: 'A VN and eroge news feed channel for the server.',
  },
  {
    date: '2025-11-25',
    project: 'muramasa',
    title: 'Character counts on profiles',
    description: 'Profile cards show total characters read alongside time stats, and use your server avatar when you have one set.',
  },
  {
    date: '2025-11-11',
    project: 'muramasa',
    title: 'Log library and heatmap',
    description: 'Added a log library view and reading heatmap, and improved log stats and profiles.',
  },
  {
    date: '2025-11-06',
    project: 'muramasa',
    title: 'Pin by ping',
    description: 'Pin a message in a thread by replying to it and pinging the bot.',
  },
  {
    date: '2025-10-26',
    project: 'muramasa',
    title: 'Logging overhaul',
    description: 'Game logging, comments on logs, detailed log views, an undo button, sticky messages, and tighter date handling.',
  },
  {
    date: '2025-10-13',
    project: 'muramasa',
    title: 'Multi-server logging and Sakura',
    description: 'Logging now works across servers, and Sakura launched as an anime-focused sub-bot for the LJTA server.',
  },
  {
    date: '2025-10-10',
    project: 'muramasa',
    title: 'Highlights channel',
    description: 'Messages with enough unique reactions are reposted to a highlights channel.',
  },
  {
    date: '2025-10-03',
    project: 'muramasa',
    title: 'Immersion tracking',
    description: 'Time-based immersion logging with a reader role and level system.',
  },
  {
    date: '2025-09-22',
    project: 'hikaru',
    title: 'Profiles and pagination',
    description: 'Added user profiles, paginated leaderboards, and a help command.',
  },
  {
    date: '2025-08-30',
    project: 'site',
    title: 'The Guide released',
    description: 'The core guide to learning Japanese with visual novels, plus a community page.',
    links: [
      { label: 'The Guide', href: '/guide/' },
      { label: 'Community', href: '/join/' },
    ],
  },
  {
    date: '2025-08-22',
    project: 'muramasa',
    title: 'Verification quiz levels',
    description: 'Member verification now uses leveled quizzes.',
  },
  {
    date: '2025-08-16',
    project: 'site',
    title: 'OwOCR guide',
    description: 'A guide to OwOCR for extracting text from VNs that regular texthookers cannot hook.',
    links: [{ label: 'OwOCR Guide', href: '/owocr-guide/' }],
  },
  {
    date: '2025-07-31',
    project: 'muramasa',
    title: 'VN of the Month',
    description: 'Monthly VN feature for VNCR: suggestions, monthly picks, completions, and a points leaderboard.',
  },
  {
    date: '2025-07-28',
    project: 'hikaru',
    title: 'Hikaru launched',
    description: 'Adopted as our reading club bot, with VN logging, ratings, server leaderboards, and role rewards. Hikaru started from the open source VN_Club_Bot project, which we took over.',
    links: [{ label: 'Original project', href: 'https://github.com/friedrich-de/VN_Club_Bot' }],
  },
  {
    date: '2025-07-21',
    project: 'site',
    title: 'More tool guides',
    description: 'New guides for the Agent texthooker, JDownloader, and a VN time tracker, one week after the guides section opened.',
    links: [
      { label: 'Agent Guide', href: '/agent-guide/' },
      { label: 'JDownloader Guide', href: '/jdownloader-guide/' },
      { label: 'Time Tracker Guide', href: '/timetracker-guide/' },
    ],
  },
  {
    date: '2025-07-14',
    project: 'site',
    title: 'First setup guides',
    description: 'The guides section opened with JL and text hooking guides.',
    links: [
      { label: 'JL Guide', href: '/jl-guide/' },
      { label: 'Textractor Guide', href: '/textractor-guide/' },
    ],
  },
  {
    date: '2025-07-09',
    project: 'site',
    title: 'vnclub.org launched',
    description: 'The site began as a resource collection: where to get VNs, discovery tools, and utilities.',
    links: [
      { label: 'Where to Get VNs', href: '/sources/' },
      { label: 'Discovery', href: '/find/' },
      { label: 'Tools', href: '/tools/' },
    ],
  },
  {
    date: '2025-06-22',
    project: 'muramasa',
    title: 'Muramasa launched',
    description: 'VNCR\'s server bot went live with welcome messages, a guide command, Confirmed Reader role management, and Anki leaderboard info.',
  },
];
