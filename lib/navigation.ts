// Single source of truth for site navigation
// Used by PageNavigation, PrevNextNavigation, and SiteDirectory

export interface NavItem {
  title: string;
  slug: string;
  description?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
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
      { title: 'Anki', slug: 'anki-guide', description: 'Flashcard setup and vocabulary mining' },
      { title: 'JL', slug: 'jl-guide', description: 'Popup dictionary for visual novels' },
      { title: 'Textractor', slug: 'textractor-guide', description: 'Text hooking from VN engines' },
      { title: 'Agent', slug: 'agent-guide', description: 'Script-based text extraction' },
      { title: 'OwOCR', slug: 'owocr-guide', description: 'Optical character recognition' },
      { title: 'Meikipop', slug: 'meikipop-guide', description: 'OCR popup dictionary' },
      { title: 'Magpie', slug: 'magpie-guide', description: 'Window upscaling for VNs' },
      { title: 'ShaderGlass', slug: 'shaderglass-guide', description: 'CRT shaders and overlays' },
      { title: 'VNTimeTracker', slug: 'timetracker-guide', description: 'Track your reading time' },
      { title: 'JDownloader', slug: 'jdownloader-guide', description: 'Download manager setup' },
      { title: 'NP2 (PC-98)', slug: 'np2-guide', description: 'Retro VN emulation' },
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
