'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, TrendingUp, BarChart3 } from 'lucide-react';

export function StatsSearchPreview() {
  const router = useRouter();
  const [username, setUsername] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = username.trim();
    if (trimmed) {
      // Use window.location for reliable navigation from inside a Link
      window.location.href = `/stats/${encodeURIComponent(trimmed)}`;
    }
  };

  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()}>
        <div className="relative">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder="Enter VNDB username..."
            className="w-full px-4 py-2.5 pr-12 rounded-lg bg-white/80 dark:bg-gray-800/80
                       border border-gray-200 dark:border-gray-700 text-sm
                       text-gray-900 dark:text-white
                       placeholder:text-gray-400 dark:placeholder:text-gray-500
                       focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
                       transition-all duration-200"
          />
          <button
            type="submit"
            onClick={(e) => e.stopPropagation()}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5
                       rounded-md bg-primary-500 text-white hover:bg-primary-600
                       transition-colors duration-200"
          >
            <Search className="w-4 h-4" />
          </button>
        </div>
      </form>
      <div className="flex items-center gap-3 p-3 rounded-lg bg-white/50 dark:bg-gray-800/50">
        <TrendingUp className="w-5 h-5 text-primary-600 dark:text-primary-400" />
        <div>
          <div className="text-sm font-medium text-gray-900 dark:text-white">Score Distribution</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">View your rating patterns</div>
        </div>
      </div>
      <div className="flex items-center gap-3 p-3 rounded-lg bg-white/50 dark:bg-gray-800/50">
        <BarChart3 className="w-5 h-5 text-primary-600 dark:text-primary-400" />
        <div>
          <div className="text-sm font-medium text-gray-900 dark:text-white">Recommendations</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Personalized suggestions</div>
        </div>
      </div>
    </div>
  );
}
