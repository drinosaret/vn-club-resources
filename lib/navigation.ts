// Single source of truth for site navigation
// Used by Header, PageNavigation, PrevNextNavigation and NavigationPrefetch

export interface NavItem {
  title: string;
  slug: string;
  description?: string;
  href?: string; // Optional external URL (overrides slug-based path)
  external?: boolean; // Opens in new tab if true
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/**
 * The "More" menu, grouped by intent.
 *
 * A flat list in build order tells a visitor nothing about which entry they want. The
 * groups are the reasons anyone opens this menu: to see what is new today, to find
 * something to read, to look at what the community is doing, or to play with the data.
 *
 * What changes every day leads, since it is the only entry whose value expires.
 */
const MORE_MENU = [
  { name: 'Word of the Day', href: '/word-of-the-day', group: 'Daily' },

  { name: 'Discovery', href: '/find', group: 'Find a VN' },
  { name: 'Recommendations', href: '/recommendations', group: 'Find a VN' },
  { name: 'Random', href: '/random', group: 'Find a VN' },
  { name: 'Roulette', href: '/roulette', group: 'Find a VN' },

  { name: 'Global Stats', href: '/stats/global', group: 'Community' },
  { name: 'Rankings', href: '/stats/rankings', group: 'Community' },
  { name: 'Trends', href: '/stats/trends', group: 'Community' },
  { name: 'Compare', href: '/stats/compare', group: 'Community' },
  { name: 'Events', href: '/events', group: 'Community' },
  { name: 'Past Club Picks', href: '/events/history', group: 'Community' },

  { name: 'Tier List', href: '/tierlist', group: 'Make & play' },
  { name: '3x3 Maker', href: '/3x3-maker', group: 'Make & play' },
  { name: 'Higher or Lower', href: '/higher-or-lower', group: 'Make & play' },
  { name: 'Kana Quiz', href: '/quiz', group: 'Make & play' },
];

// Helper to convert navigation to header format
export function getHeaderNavigation() {
  const startHere = navigation.find(s => s.title === 'Start Here');
  const resources = navigation.find(s => s.title === 'Resources');
  const guides = navigation.find(s => s.title === 'Guides');

  return {
    mobile: [
      { name: 'Home', href: '/' },
      {
        name: 'Start Here',
        items: startHere?.items.map(item => ({ name: item.title, href: `/${item.slug}` })) ?? [],
      },
      {
        name: 'Resources',
        items: resources?.items.map(item => ({ name: item.title, href: `/${item.slug}` })) ?? [],
      },
      {
        name: 'Guides',
        // The hub leads its own group: on a phone there is no sidebar to reach it from.
        items: [
          { name: 'All guides', href: '/guides' },
          ...(guides?.items.map(item => ({ name: item.title, href: `/${item.slug}` })) ?? []),
        ],
      },
      // Features shown directly (not collapsed) since they're main site features
      { name: 'Browse', href: '/browse' },
      { name: 'Stats', href: '/stats' },
      { name: 'News', href: '/news' },
      {
        name: 'More',
        items: MORE_MENU,
      },
    ],
    desktop: [
      { name: 'Home', href: '/' },
      // The walkthrough, not the index. Every guide page carries the full list in its sidebar,
      // so an index is a page the reader passes through rather than one they wanted. The index
      // is still reached from the footer, from the home page's guides band, and from the
      // breadcrumb on every guide.
      { name: 'Guides', href: '/guide' },
      { name: 'Browse', href: '/browse' },
      { name: 'Stats', href: '/stats' },
      { name: 'News', href: '/news' },
      {
        name: 'More',
        items: MORE_MENU,
      },
    ],
  };
}

/**
 * The sections the site directory is built from, in the order it renders them, plus the
 * guides section it renders as its own column.
 *
 * Naming them once here is what keeps the directory honest: a section renamed in
 * `navigation` fails loudly on the next build instead of silently rendering one column
 * fewer than the site has.
 */
const DIRECTORY_SECTION_TITLES = ['Start Here', 'Resources', 'Features', 'Community'] as const;
const DIRECTORY_GUIDES_TITLE = 'Guides';

export interface DirectoryLink {
  name: string;
  href: string;
}

export interface DirectorySection {
  key: string;
  title: string;
  items: DirectoryLink[];
}

export interface SiteDirectory {
  mainSections: DirectorySection[];
  guides: NavItem[];
}

function requireSection(title: string): NavSection {
  const section = navigation.find((s) => s.title === title);
  if (!section) {
    throw new Error(`Navigation has no "${title}" section, which the site directory is built from`);
  }
  return section;
}

function toDirectoryLink(item: NavItem): DirectoryLink {
  return { name: item.title, href: item.href ?? `/${item.slug}/` };
}

/**
 * Every destination the navigation knows about, grouped for a full directory listing.
 *
 * Guides come back as nav items rather than links because a directory renders them under
 * one heading, where the trailing "Guide" in each title is redundant.
 */
export function getSiteDirectorySections(): SiteDirectory {
  return {
    mainSections: DIRECTORY_SECTION_TITLES.map((title) => ({
      key: title.toLowerCase().replace(/\s+/g, '-'),
      title,
      items: requireSection(title).items.map(toDirectoryLink),
    })),
    guides: requireSection(DIRECTORY_GUIDES_TITLE).items,
  };
}

export const navigation: NavSection[] = [
  {
    title: 'Home',
    items: [{ title: 'Home', slug: '' }],
  },
  {
    title: 'Start Here',
    items: [
      { title: 'The Guide', slug: 'guide', description: 'From kana to reading a visual novel in Japanese, start to finish' },
      { title: 'FAQ', slug: 'faq', description: 'Common questions about reading visual novels in the original' },
    ],
  },
  {
    title: 'Resources',
    items: [
      { title: 'Discovery', slug: 'find', description: 'Databases, trackers, and where to discover VNs' },
      { title: 'Where to Get VNs', slug: 'sources', description: 'Digital storefronts and download sources' },
      { title: 'Tools', slug: 'tools', description: 'Text hookers, dictionaries, and utilities' },
    ],
  },
  {
    title: 'Features',
    items: [
      { title: 'Beginner VNs', slug: 'beginner-vns', description: 'Handpicked starter titles and the easiest VNs to read in Japanese' },
      { title: 'Browse', slug: 'browse', description: 'The whole VNDB catalogue, filtered by tag, length, year and language' },
      { title: 'Stats', slug: 'stats', description: 'Any VNDB list as charts: scores, release years, reading activity' },
      { title: 'Global Stats', slug: 'stats/global', description: 'The shape of the whole database: what is rated highest, read most, and released when' },
      { title: 'Rankings', slug: 'stats/rankings', description: 'Community leaderboards across VNDB' },
      { title: 'Trends', slug: 'stats/trends', description: 'How reading and publishing shifted over time' },
      { title: 'Compare Lists', slug: 'stats/compare', description: 'Two VNDB lists side by side: shared titles and where the scores part' },
      { title: 'Recommendations', slug: 'recommendations', description: 'Titles matched to your VNDB ratings by tag, staff and similar readers' },
      { title: 'Tier List', slug: 'tierlist', description: 'Rank your visual novels' },
      { title: '3x3 Maker', slug: '3x3-maker', description: 'Create a VN cover collage' },
      { title: 'Roulette', slug: 'roulette', description: 'Spin the wheel to pick a VN' },
      { title: 'Higher or Lower', slug: 'higher-or-lower', description: 'Guess which VN ranks higher' },
      { title: 'News', slug: 'news', description: 'Japanese releases, announcements and industry news, gathered daily' },
      { title: 'Upcoming Releases', slug: 'news/upcoming', description: 'Visual novels with a release date still ahead' },
      { title: 'Word of the Day', slug: 'word-of-the-day', description: 'A Japanese word a day, with example sentences drawn from visual novels' },
      { title: 'Events', slug: 'events', description: 'Club calendar: VN of the Month and Season, Movie Night, Roudoku' },
      { title: 'Past Club Picks', slug: 'events/history', description: 'Everything the club has picked together, newest first' },
      { title: 'Random Picker', slug: 'random', description: 'Roll for a title, with filters for tag, length, rating and language' },
      { title: 'Quiz', slug: 'quiz', description: 'Kana practice quiz' },
    ],
  },
  {
    title: 'Guides',
    items: [
      // Learning & Dictionary
      { title: 'Anki', slug: 'anki-guide', description: 'Flashcard setup and vocabulary mining' },
      { title: 'JL', slug: 'jl-guide', description: 'Popup dictionary for visual novels' },
      { title: 'Yomitan', slug: 'yomitan-guide', description: 'Browser dictionary extension' },
      // Text Extraction
      { title: 'Textractor', slug: 'textractor-guide', description: 'Text hooking from VN engines' },
      { title: 'Agent', slug: 'agent-guide', description: 'Script-based text extraction' },
      { title: 'OwOCR', slug: 'owocr-guide', description: 'Optical character recognition' },
      { title: 'Meikipop', slug: 'meikipop-guide', description: 'OCR popup dictionary' },
      // Visual Enhancement
      { title: 'Magpie', slug: 'magpie-guide', description: 'Window upscaling for VNs' },
      { title: 'ShaderGlass', slug: 'shaderglass-guide', description: 'CRT shaders and overlays' },
      // Platform & Emulation
      { title: 'Bottles (Linux)', slug: 'bottles-guide', description: 'Running VNs on Linux' },
      { title: 'NP2 (PC-98)', slug: 'np2-guide', description: 'Retro VN emulation' },
      { title: 'Kirikiroid2', slug: 'kirikiroid-guide', description: 'Kirikiri VNs on Android' },
      { title: 'GameHub Lite', slug: 'gamehub-lite-guide', description: 'Windows emulation on Android' },
      // Utilities
      { title: 'JDownloader', slug: 'jdownloader-guide', description: 'Download manager setup' },
      { title: 'VNTimeTracker', slug: 'timetracker-guide', description: 'Track your reading time' },
    ],
  },
  {
    title: 'Community',
    items: [
      { title: 'Discord', slug: 'join', description: 'The club Discord: group reads, setup help, untranslated titles' },
      { title: 'Level 1 Vocabulary', slug: 'level1', description: 'The hundred words the Discord entry quiz is drawn from, with readings and meanings' },
      { title: 'Changelog', slug: 'changelog', description: 'Major updates across the site and bots' },
    ],
  },
];

// Flat list of all pages in order for prev/next navigation
export const pageOrder: NavItem[] = navigation.flatMap((section) => section.items);

// Get page by slug
export function getPageBySlug(slug: string): NavItem | undefined {
  return pageOrder.find((page) => page.slug === slug);
}

// Get prev/next pages for a given slug
export function getPrevNextPages(slug: string): { prev: NavItem | null; next: NavItem | null } {
  const index = pageOrder.findIndex((page) => page.slug === slug);
  if (index === -1) {
    return { prev: null, next: null };
  }
  return {
    prev: index > 0 ? pageOrder[index - 1] : null,
    next: index < pageOrder.length - 1 ? pageOrder[index + 1] : null,
  };
}
