'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Shuffle, Loader2 } from 'lucide-react';
import { vndbStatsApi } from '@/lib/vndb-stats-api';

type EntityType = 'vn' | 'tags' | 'traits' | 'staff' | 'seiyuu' | 'producers';

const LINK_MAP: Record<EntityType, (id: string) => string> = {
  vn: (id) => `/vn/${id}/`,
  tags: (id) => `/stats/tag/${id}/`,
  traits: (id) => `/stats/trait/i${id}/`,
  staff: (id) => `/stats/staff/${id}/`,
  seiyuu: (id) => `/stats/seiyuu/${id}/`,
  producers: (id) => `/stats/producer/${id}/`,
};

export function RandomButton({ entityType }: { entityType: EntityType }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(async () => {
    setLoading(true);
    try {
      const id = entityType === 'vn'
        ? await vndbStatsApi.getRandomVN()
        : await vndbStatsApi.getRandomEntity(entityType);
      if (id) {
        router.push(LINK_MAP[entityType](id));
        // Don't reset loading — component unmounts on navigation,
        // keeping the spinner visible until the page transitions
        return;
      }
    } catch {
      // fall through to reset
    }
    setLoading(false);
  }, [entityType, router]);

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
      title="Random"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shuffle className="w-4 h-4" />}
    </button>
  );
}
