// Single source of truth for site navigation
// Used by PageNavigation, PrevNextNavigation, Header, and SiteDirectory

export interface NavItem {
  title: string;
  slug: string;
  description?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

// Helper to convert navigation to header format
export function getHeaderNavigation() {
  const resources = navigation.find(s => s.title === 'Resources');
  const guides = navigation.find(s => s.title === 'Guides');

  return {
    mobile: [
      { name: 'Home', href: '/' },
      { name: 'Start Here', href: '/guide' },
      {
        name: 'Resources',
        items: resources?.items.map(item => ({ name: item.title, href: `/${item.slug}` })) ?? [],
      },
      {
        name: 'Guides',
        items: guides?.items.map(item => ({ name: item.title, href: `/${item.slug}` })) ?? [],
      },
      { name: 'Join Discord', href: '/join' },
    ],
    desktop: [
      { name: 'Home', href: '/' },
      { name: 'Start Here', href: '/guide' },
      { name: 'Resources', href: '/find' },
      { name: 'Guides', href: '/anki-guide' },
      { name: 'Other', href: '/join' },
    ],
  };
}

// Helper to get sections for SiteDirectory
export function getSiteDirectorySections() {
  const startHere = navigation.find(s => s.title === 'Start Here');
  const resources = navigation.find(s => s.title === 'Resources');
  const community = navigation.find(s => s.title === 'Community');
  const guides = navigation.find(s => s.title === 'Guides');

  return {
    mainSections: [
      { key: 'start-here', title: 'Start Here', items: startHere?.items ?? [] },
      { key: 'resources', title: 'Resources', items: resources?.items ?? [] },
      { key: 'community', title: 'Community', items: community?.items ?? [] },
    ],
    guides: guides?.items ?? [],
  };
}

export const navigation: NavSection[] = [
  {
    title: 'Home',
    items: [{ title: 'Home', slug: '' }],
  },
  {
    title: 'Start Here',
    items: [{ title: 'The Guide', slug: 'guide' }],
  },
  {
    title: 'Resources',
    items: [
      { title: 'Recommendations', slug: 'find', description: 'Databases, trackers, and where to discover VNs' },
      { title: 'Where to Get VNs', slug: 'sources', description: 'Digital storefronts and download sources' },
      { title: 'Tools', slug: 'tools', description: 'Text hookers, dictionaries, and utilities' },
    ],
  },
  {
    title: 'Guides',
    items: [
      // Learning & Dictionary
      { title: 'Anki', slug: 'anki-guide', description: 'Flashcard setup and vocabulary mining' },
      { title: 'JL', slug: 'jl-guide', description: 'Popup dictionary for visual novels' },
      // Text Extraction
      { title: 'Textractor', slug: 'textractor-guide', description: 'Text hooking from VN engines' },
      { title: 'Agent', slug: 'agent-guide', description: 'Script-based text extraction' },
      { title: 'OwOCR', slug: 'owocr-guide', description: 'Optical character recognition' },
      { title: 'Meikipop', slug: 'meikipop-guide', description: 'OCR popup dictionary' },
      // Visual Enhancement
      { title: 'Magpie', slug: 'magpie-guide', description: 'Window upscaling for VNs' },
      { title: 'ShaderGlass', slug: 'shaderglass-guide', description: 'CRT shaders and overlays' },
      // Platform & Emulation
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
    items: [{ title: 'Join', slug: 'join', description: 'Discord server and community' }],
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
