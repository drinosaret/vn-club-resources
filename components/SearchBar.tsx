'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, FileText, Newspaper, X } from 'lucide-react';
import { searchContent, SearchResult } from '@/lib/search';

interface SearchBarProps {
  className?: string;
  onClose?: () => void;
  isMobile?: boolean;
}

export default function SearchBar({ className = '', onClose, isMobile = false }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setIsLoading(true);
      try {
        const searchResults = await searchContent(query);
        setResults(searchResults);
        setIsOpen(true);
        setSelectedIndex(-1);
      } catch (error) {
        console.error('Search error:', error);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [query]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navigateToResult = useCallback((result: SearchResult) => {
    router.push(`/${result.slug}`);
    setQuery('');
    setIsOpen(false);
    setResults([]);
    onClose?.();
  }, [router, onClose]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev < results.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : results.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < results.length) {
          navigateToResult(results[selectedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setSelectedIndex(-1);
        inputRef.current?.blur();
        break;
    }
  }, [isOpen, results, selectedIndex, navigateToResult]);

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const highlightMatch = (text: string, query: string) => {
    if (!query.trim()) return text;

    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 text-inherit rounded px-0.5">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => query.trim() && results.length > 0 && setIsOpen(true)}
          placeholder="Search..."
          className={`
            w-full pl-9 pr-8 py-2
            bg-gray-100 dark:bg-gray-800
            border border-gray-200 dark:border-gray-700
            rounded-lg
            text-sm text-gray-900 dark:text-gray-100
            placeholder-gray-500 dark:placeholder-gray-400
            focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:border-transparent
            transition-colors
            ${isMobile ? 'text-base' : ''}
          `}
          aria-label="Search"
          aria-expanded={isOpen}
          aria-controls="search-results"
          role="combobox"
          aria-autocomplete="list"
        />
        {query && (
          <button
            onClick={clearSearch}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Results dropdown */}
      {isOpen && (
        <div
          id="search-results"
          role="listbox"
          className={`
            absolute z-50 mt-2 w-full
            bg-white dark:bg-gray-900
            border border-gray-200 dark:border-gray-700
            rounded-lg shadow-lg
            max-h-96 overflow-y-auto
            ${isMobile ? 'left-0 right-0' : 'min-w-80'}
          `}
        >
          {isLoading ? (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400">
              <div className="inline-block w-4 h-4 border-2 border-gray-300 border-t-indigo-500 rounded-full animate-spin mr-2" />
              Searching...
            </div>
          ) : results.length === 0 ? (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400">
              No results found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            <ul className="py-2">
              {results.map((result, index) => (
                <li key={result.id}>
                  <button
                    onClick={() => navigateToResult(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    role="option"
                    aria-selected={index === selectedIndex}
                    className={`
                      w-full px-4 py-3 text-left
                      hover:bg-gray-100 dark:hover:bg-gray-800
                      focus:outline-none focus:bg-gray-100 dark:focus:bg-gray-800
                      border-b border-gray-100 dark:border-gray-800 last:border-b-0
                      ${index === selectedIndex ? 'bg-gray-100 dark:bg-gray-800' : ''}
                    `}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 mt-0.5">
                        {result.type === 'guide' ? (
                          <FileText className="w-4 h-4 text-indigo-500" />
                        ) : (
                          <Newspaper className="w-4 h-4 text-purple-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                          {highlightMatch(result.title, query)}
                        </div>
                        {result.section && (
                          <div className="text-xs text-indigo-600 dark:text-indigo-400 mt-0.5">
                            in section: {result.section}
                          </div>
                        )}
                        <div className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                          {highlightMatch(result.excerpt, query)}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
