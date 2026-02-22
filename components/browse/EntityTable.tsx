import Link from 'next/link';

export interface EntityColumn<T> {
  key: string;
  label: string;
  className?: string;
  render: (item: T) => React.ReactNode;
}

interface EntityTableProps<T> {
  items: T[];
  columns: EntityColumn<T>[];
  getKey: (item: T) => string | number;
  getLink?: (item: T) => string;
  isLoading?: boolean;
  emptyMessage?: string;
}

// Pure component — no hooks. SWR's keepPreviousData handles stale data display.
export function EntityTable<T>({
  items,
  columns,
  getKey,
  getLink,
  isLoading,
  emptyMessage = 'No results found.',
}: EntityTableProps<T>) {
  // Show skeleton only during true initial load (no items yet)
  if (isLoading && items.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider ${col.className || ''}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {[...Array(10)].map((_, i) => (
                <tr key={i}>
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3">
                      <div className="h-4 rounded-sm w-3/4 image-placeholder" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Show empty state when not loading and truly empty
  if (items.length === 0 && !isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-500 dark:text-gray-400">
        {emptyMessage}
      </div>
    );
  }

  // Show content — data swaps instantly when SWR receives new page
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider ${col.className || ''}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {items.map((item) => {
              const link = getLink?.(item);
              return (
                <tr
                  key={getKey(item)}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  {columns.map((col, colIdx) => (
                    <td key={col.key} className={`px-4 py-3 text-sm ${col.className || ''}`}>
                      {colIdx === 0 && link ? (
                        <Link href={link} className="text-primary-600 dark:text-primary-400 hover:underline">
                          {col.render(item)}
                        </Link>
                      ) : (
                        col.render(item)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============ Reusable Cell Components ============

export function NameCell({ name, original, preference }: { name: string; original: string | null; preference: 'japanese' | 'romaji' }) {
  // For staff/seiyuu/producers: name = original script (JP), original = romanized
  const displayName = preference === 'romaji' && original ? original : name;
  const altName = preference === 'romaji' && original ? name : original;

  return (
    <div>
      <span className="font-medium text-gray-900 dark:text-white">{displayName}</span>
      {altName && altName !== displayName && (
        <span className="block text-xs text-gray-500 dark:text-gray-400">{altName}</span>
      )}
    </div>
  );
}

export function BadgeCell({ value, colorClass }: { value: string; colorClass?: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${
      colorClass || 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
    }`}>
      {value}
    </span>
  );
}

export function CountCell({ count }: { count: number }) {
  return (
    <span className="text-gray-700 dark:text-gray-300 tabular-nums">
      {count.toLocaleString()}
    </span>
  );
}

export function RoleBadges({ roles }: { roles: string[] }) {
  const roleColors: Record<string, string> = {
    scenario: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    art: 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-400',
    music: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
    songs: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
    director: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
    staff: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
  };

  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((role) => (
        <span
          key={role}
          className={`inline-block px-1.5 py-0.5 text-[11px] font-medium rounded ${
            roleColors[role] || roleColors.staff
          }`}
        >
          {role}
        </span>
      ))}
    </div>
  );
}
