'use client';

export type VNTabId = 'summary' | 'tags' | 'traits' | 'characters' | 'stats';

interface VNTabsProps {
  activeTab: VNTabId;
  onTabChange: (tab: VNTabId) => void;
  tagCount?: number;
  traitCount?: number;
  characterCount?: number;
}

export function VNTabs({ activeTab, onTabChange, tagCount, traitCount, characterCount }: VNTabsProps) {
  const tabs: Array<{ id: VNTabId; label: string; count?: number }> = [
    { id: 'summary', label: 'Summary' },
    { id: 'stats', label: 'Stats' },
    { id: 'tags', label: 'Tags', count: tagCount },
    { id: 'traits', label: 'Traits', count: traitCount },
    { id: 'characters', label: 'Characters', count: characterCount },
  ];

  return (
    <div className="border-b border-gray-200 dark:border-gray-700">
      <nav className="flex gap-4 overflow-x-auto" aria-label="VN tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`relative py-3 px-1 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-primary-600 dark:text-primary-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <span className="flex items-center gap-1.5">
              {tab.label}
              {tab.id !== 'summary' && tab.id !== 'stats' && (
                <span
                  suppressHydrationWarning
                  className={`text-xs px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center transition-all duration-300 ${
                    tab.count !== undefined
                      ? activeTab === tab.id
                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 opacity-100'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 opacity-100'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 opacity-60'
                  }`}
                >
                  {tab.count !== undefined ? tab.count : '·'}
                </span>
              )}
            </span>
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600 dark:bg-primary-400" />
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
