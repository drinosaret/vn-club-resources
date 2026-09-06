import Link from '@/components/Link';

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
  /** Set when the request did not come back, which is not the same as matching nothing. */
  failed?: boolean;
}

// Pure component, no hooks. SWR's keepPreviousData handles stale data display.
export function EntityTable<T>({
  items,
  columns,
  getKey,
  getLink,
  isLoading,
  emptyMessage = 'No results found.',
  failed,
}: EntityTableProps<T>) {
  // Ahead of both the skeleton and the empty state: an unanswered request would otherwise
  // wait for data that is not coming, or read as a confident "nothing matched".
  if (failed) {
    return (
      <div
        role="status"
        className="bw-panel bw-empty"
      >
        These results could not be loaded. The stats service did not answer, which is usually
        brief.
      </div>
    );
  }

  // Show skeleton only during true initial load (no items yet)
  if (isLoading && items.length === 0) {
    return (
      <div className="bw-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="bw-table w-full">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`px-4 py-3 text-left ${col.className || ''}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
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
      <div className="bw-panel bw-empty">
        {emptyMessage}
      </div>
    );
  }

  // Show content: data swaps instantly when SWR receives new page
  return (
    <div className="bw-panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="bw-table w-full">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-left ${col.className || ''}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const link = getLink?.(item);
              return (
                <tr key={getKey(item)}>
                  {columns.map((col, colIdx) => (
                    <td key={col.key} className={`px-4 py-3 text-sm ${col.className || ''}`}>
                      {colIdx === 0 && link ? (
                        <Link href={link} className="text-[color:var(--ai)] hover:underline">
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
      <span className="text-[color:var(--ink)]">{displayName}</span>
      {altName && altName !== displayName && (
        <span className="block text-xs text-[color:var(--nezu)]">{altName}</span>
      )}
    </div>
  );
}

export function BadgeCell({ value }: { value: string }) {
  return <span className="bw-badge">{value}</span>;
}

export function CountCell({ count }: { count: number }) {
  return (
    <span className="bw-num text-[color:var(--text-secondary)]">
      {count.toLocaleString()}
    </span>
  );
}

export function RoleBadges({ roles }: { roles: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((role) => (
        <span key={role} className="bw-badge">
          {role}
        </span>
      ))}
    </div>
  );
}
