'use client';

export type TraitTabId = 'summary' | 'characters' | 'novels' | 'similar-traits' | 'related-tags';

interface Tab {
  id: TraitTabId;
  label: string;
  count?: number;
}

interface TraitDetailTabsProps {
  activeTab: TraitTabId;
  onTabChange: (tab: TraitTabId) => void;
  counts?: {
    characters?: number;
    novels?: number;
    similarTraits?: number;
    relatedTags?: number;
  };
}

export function TraitDetailTabs({ activeTab, onTabChange, counts }: TraitDetailTabsProps) {
  const tabs: Tab[] = [
    {
      id: 'summary',
      label: 'Summary',
    },
    {
      id: 'characters',
      label: 'Characters',
      count: counts?.characters,
    },
    {
      id: 'novels',
      label: 'Novels',
      count: counts?.novels,
    },
    {
      id: 'similar-traits',
      label: 'Similar Traits',
      count: counts?.similarTraits,
    },
    {
      id: 'related-tags',
      label: 'Related Tags',
      count: counts?.relatedTags,
    },
  ];

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
