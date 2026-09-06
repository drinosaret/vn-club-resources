'use client';

export type BrowseTab = 'novels' | 'tags' | 'traits' | 'staff' | 'seiyuu' | 'producers';

const TABS: { id: BrowseTab; label: string }[] = [
  { id: 'novels', label: 'Visual Novels' },
  { id: 'tags', label: 'Tags' },
  { id: 'traits', label: 'Traits' },
  { id: 'staff', label: 'Staff' },
  { id: 'seiyuu', label: 'Seiyuu' },
  { id: 'producers', label: 'Producers' },
];

interface BrowseTabsProps {
  activeTab: BrowseTab;
  onTabChange: (tab: BrowseTab) => void;
  onTabHover?: (tab: BrowseTab) => void;
}

export function BrowseTabs({ activeTab, onTabChange, onTabHover }: BrowseTabsProps) {
  return (
    <nav className="tabs justify-center mb-6" aria-label="Browse tabs">
      {TABS.map(({ id, label }) => {
        const isActive = activeTab === id;
        return (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            onMouseEnter={() => onTabHover?.(id)}
            className={`browse-tab-button tab${isActive ? ' tab--on' : ''}`}
            aria-current={isActive ? 'page' : undefined}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}
