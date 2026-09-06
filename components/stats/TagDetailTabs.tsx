'use client';

export type TagTabId = 'summary' | 'novels' | 'similar-tags' | 'similar-traits';

interface Tab {
  id: TagTabId;
  label: string;
  count?: number;
}

interface TagDetailTabsProps {
  activeTab: TagTabId;
  onTabChange: (tab: TagTabId) => void;
  counts?: {
    novels?: number;
    similarTags?: number;
    traits?: number;
  };
  hideTabs?: TagTabId[];
}

export function TagDetailTabs({ activeTab, onTabChange, counts, hideTabs = [] }: TagDetailTabsProps) {
  const allTabs: Tab[] = [
    {
      id: 'summary',
      label: 'Summary',
    },
    {
      id: 'novels',
      label: 'Novels',
      count: counts?.novels,
    },
    {
      id: 'similar-tags',
      label: 'Similar Tags',
      count: counts?.similarTags,
    },
    {
      id: 'similar-traits',
      label: 'Similar Traits',
      count: counts?.traits,
    },
  ];

  const tabs = allTabs.filter(tab => !hideTabs.includes(tab.id));

  return (
    <div className="mb-6">
      <nav className="tabs sm:flex-nowrap sm:overflow-x-auto" aria-label="Tabs">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`tab ${isActive ? 'tab--on' : ''}`}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="tab-count">{tab.count.toLocaleString()}</span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
