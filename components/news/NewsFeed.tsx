'use client';

import { useState, useEffect } from 'react';
import { Newspaper, RefreshCw } from 'lucide-react';
import { NewsCard } from './NewsCard';
import { DigestCard } from './DigestCard';
import { NewsFilter } from './NewsFilter';
import {
  fetchNews,
  type NewsSource,
  type NewsListItem,
} from '@/lib/sample-news-data';

export function NewsFeed() {
  const [activeSource, setActiveSource] = useState<NewsSource | 'all'>('all');
  const [newsItems, setNewsItems] = useState<NewsListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const loadNews = async (source?: NewsSource | 'all', pageNum: number = 1) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchNews({
        page: pageNum,
        limit: 20,
        source: source === 'all' ? undefined : source,
      });

      if (response.error) {
        setError(response.error);
        setNewsItems([]);
        setTotalPages(1);
        return;
      }

      setNewsItems(response.items);
      setTotalPages(response.pages);
    } catch {
      setError('Unable to load news right now. Please try again later.');
      setNewsItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNews(activeSource, 1);
    setPage(1);
  }, [activeSource]);

  const handleSourceChange = (source: NewsSource | 'all') => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    setActiveSource(source);
  };

  const handleRefresh = () => {
    loadNews(activeSource, page);
  };

  const handlePageChange = (newPage: number) => {
    // Scroll first with 'instant' — smooth scroll gets cancelled by the layout
    // shift when React swaps content to skeleton cards mid-animation
    window.scrollTo({ top: 0, behavior: 'instant' });
    setPage(newPage);
    loadNews(activeSource, newPage);
  };

  return (
    <div>
      {/* Filter with refresh button */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <NewsFilter activeSource={activeSource} onSourceChange={handleSourceChange} />
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          title="Refresh news"
          aria-label="Refresh news"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 text-sm">
          {error}
        </div>
      )}

      {/* Loading state - show skeleton grid */}
      {loading ? (
        <div className="flex flex-wrap justify-center gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="w-full md:w-[calc(50%-0.5rem)] lg:w-[calc(33.333%-0.6667rem)]">
              <NewsCardSkeleton />
            </div>
          ))}
        </div>
      ) : newsItems.length > 0 ? (
        <>
          {/* News Grid — flex wrap so the last row centers naturally */}
          <div className="flex flex-wrap justify-center gap-4">
            {newsItems.map((item) => (
              <div key={item.id} className="w-full md:w-[calc(50%-0.5rem)] lg:w-[calc(33.333%-0.6667rem)]">
                {item.type === 'digest' ? (
                  <DigestCard item={item} />
                ) : (
                  <NewsCard item={item} />
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <nav aria-label="News pagination" className="flex items-center justify-center gap-2 mt-8">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1}
                className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages}
                className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </nav>
          )}
        </>
      ) : (
        <div className="text-center py-12">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 mb-4">
            <Newspaper className="w-8 h-8 text-gray-400" />
          </div>
          <p className="text-gray-500 dark:text-gray-400">No news items found for this filter</p>
        </div>
      )}
    </div>
  );
}

function NewsCardSkeleton() {
  return (
    <div className="flex flex-col bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden h-full">
      {/* Image placeholder */}
      <div className="w-full h-40 image-placeholder" />
      <div className="p-4 flex flex-col flex-grow space-y-3">
        {/* Source badge + time */}
        <div className="flex items-center gap-2">
          <div className="w-20 h-5 rounded image-placeholder" />
          <div className="w-12 h-4 rounded image-placeholder" />
        </div>
        {/* Title */}
        <div className="h-5 w-full rounded image-placeholder" />
        <div className="h-5 w-3/4 rounded image-placeholder" />
        {/* Summary */}
        <div className="flex-grow space-y-2">
          <div className="h-4 w-full rounded image-placeholder" />
          <div className="h-4 w-5/6 rounded image-placeholder" />
          <div className="h-4 w-2/3 rounded image-placeholder" />
        </div>
      </div>
    </div>
  );
}
