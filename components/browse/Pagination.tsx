'use client';

import { useRef, useEffect, useState, memo, useCallback, type RefObject } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

/**
 * Skeleton placeholder for pagination that matches the real Pagination layout.
 * Used during initial load to reserve space and prevent layout jump.
 */
export function PaginationSkeleton() {
  return (
    <div className="flex flex-col items-center gap-2 my-4">
      <div className="flex items-center justify-center gap-1">
        {/* First page button */}
        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg image-placeholder" />
        {/* Skip buttons -20, -10, -5 - hidden on mobile */}
        <div className="hidden sm:flex items-center gap-1">
          <div className="w-8 h-8 rounded-md image-placeholder" />
          <div className="w-8 h-8 rounded-md image-placeholder" />
          <div className="w-8 h-8 rounded-md image-placeholder" />
        </div>
        {/* Previous button */}
        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg image-placeholder" />
        {/* Page indicator */}
        <div className="w-24 h-8 sm:h-9 rounded-lg image-placeholder" />
        {/* Next button */}
        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg image-placeholder" />
        {/* Skip buttons +5, +10, +20 - hidden on mobile */}
        <div className="hidden sm:flex items-center gap-1">
          <div className="w-8 h-8 rounded-md image-placeholder" />
          <div className="w-8 h-8 rounded-md image-placeholder" />
          <div className="w-8 h-8 rounded-md image-placeholder" />
        </div>
        {/* Last page button */}
        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg image-placeholder" />
      </div>
      {/* "Showing X-Y of Z" skeleton */}
      <div className="w-44 h-4 rounded image-placeholder" />
    </div>
  );
}

const skipButtonClass = `
  px-2 h-8 text-xs font-medium rounded-md tabular-nums
  text-gray-500 dark:text-gray-400
  hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200
  disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent
  transition-colors duration-150
`;

function SkipButton({ delta, currentPage, totalPages, onPageChange, onPrefetchPage }: {
  delta: number;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPrefetchPage?: (page: number) => void;
}) {
  const targetPage = Math.max(1, Math.min(totalPages, currentPage + delta));
  const disabled = currentPage + delta < 1 || currentPage + delta > totalPages;
  return (
    <button
      onClick={() => onPageChange(targetPage)}
      onMouseEnter={() => !disabled && onPrefetchPage?.(targetPage)}
      disabled={disabled}
      className={skipButtonClass}
      title={delta > 0 ? `Forward ${delta} pages` : `Back ${Math.abs(delta)} pages`}
    >
      {delta > 0 ? `+${delta}` : delta}
    </button>
  );
}

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPrefetchPage?: (page: number) => void;
  totalItems?: number;
  itemsPerPage?: number;
  /** If true, scrolls to top of page on page change */
  scrollToTop?: boolean;
  /** If provided, scrolls this element into view on page change */
  scrollTargetRef?: RefObject<HTMLElement | null>;
}

export const Pagination = memo(function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  onPrefetchPage,
  totalItems,
  itemsPerPage = 50,
  scrollToTop = false,
  scrollTargetRef,
}: PaginationProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState('');
  const [openUpward, setOpenUpward] = useState(false);
  const [jumpError, setJumpError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const handleCloseDropdown = useCallback(() => {
    setIsDropdownOpen(false);
  }, []);

  const handleToggleDropdown = useCallback(() => {
    if (!isDropdownOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUpward(spaceBelow < 120);
    }
    setIsDropdownOpen((prev) => !prev);
  }, [isDropdownOpen]);

  // Wrapper that handles scrolling on page change
  const handlePageChangeWithScroll = useCallback((page: number) => {
    onPageChange(page);
    if (scrollTargetRef?.current) {
      scrollTargetRef.current.scrollIntoView({ behavior: 'instant', block: 'start' });
    } else if (scrollToTop) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [onPageChange, scrollToTop, scrollTargetRef]);

  const handleJump = useCallback(() => {
    const page = parseInt(jumpValue, 10);
    if (!isNaN(page) && page >= 1 && page <= totalPages) {
      handlePageChangeWithScroll(page);
      handleCloseDropdown();
      setJumpValue('');
    } else {
      setJumpError(true);
      setTimeout(() => setJumpError(false), 1500);
    }
  }, [jumpValue, totalPages, handlePageChangeWithScroll, handleCloseDropdown]);

  // Focus input when opened
  useEffect(() => {
    if (isDropdownOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isDropdownOpen]);

  // Reset jump value when closed
  useEffect(() => {
    if (!isDropdownOpen) {
      setJumpValue('');
      setJumpError(false);
    }
  }, [isDropdownOpen]);

  // Clear error when user edits the jump value
  useEffect(() => {
    if (jumpError) setJumpError(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpValue]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCloseDropdown();
      }
    };
    if (isDropdownOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isDropdownOpen, handleCloseDropdown]);

  // Navigation button styles
  const navButtonClass = `
    w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg
    text-gray-500 dark:text-gray-400
    hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200
    disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent
    transition-colors duration-150
  `;

  // Calculate range for progress indicator
  const startItem = totalItems ? ((currentPage - 1) * itemsPerPage) + 1 : 0;
  const endItem = totalItems ? Math.min(currentPage * itemsPerPage, totalItems) : 0;

  return (
    <div className="flex flex-col items-center gap-2 my-4">
      <div className="flex items-center justify-center gap-1">
      {/* First page button */}
      <button
        onClick={() => handlePageChangeWithScroll(1)}
        onMouseEnter={() => currentPage !== 1 && onPrefetchPage?.(1)}
        disabled={currentPage === 1}
        className={navButtonClass}
        aria-label="First page"
        title="First page"
      >
        <ChevronsLeft className="w-4 h-4" />
      </button>

      {/* Back skip buttons - hidden on mobile */}
      <div className="hidden sm:flex items-center gap-1">
        <SkipButton delta={-20} currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChangeWithScroll} onPrefetchPage={onPrefetchPage} />
        <SkipButton delta={-10} currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChangeWithScroll} onPrefetchPage={onPrefetchPage} />
        <SkipButton delta={-5} currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChangeWithScroll} onPrefetchPage={onPrefetchPage} />
      </div>

      {/* Previous page button */}
      <button
        onClick={() => handlePageChangeWithScroll(currentPage - 1)}
        onMouseEnter={() => currentPage > 1 && onPrefetchPage?.(currentPage - 1)}
        disabled={currentPage === 1}
        className={navButtonClass}
        aria-label="Previous page"
        title="Previous page"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      {/* Page indicator / dropdown trigger */}
      <div className="relative">
        <button
          ref={triggerRef}
          onClick={handleToggleDropdown}
          className={`
            px-3 h-9 flex items-center gap-1 rounded-lg
            bg-gray-100 dark:bg-gray-800
            text-sm font-medium text-gray-700 dark:text-gray-300
            hover:bg-gray-200 dark:hover:bg-gray-700
            transition-colors duration-150
          `}
          aria-expanded={isDropdownOpen}
          aria-haspopup="dialog"
          aria-label={`Page ${currentPage} of ${totalPages}. Click to jump to a specific page.`}
        >
          <span className="tabular-nums">{currentPage.toLocaleString()}</span>
          <span className="text-gray-400 dark:text-gray-500">/</span>
          <span className="tabular-nums">{totalPages.toLocaleString()}</span>
        </button>

        {/* Dropdown - just the page jump input */}
        {isDropdownOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-[99]"
              onClick={handleCloseDropdown}
              aria-hidden="true"
            />

            {/* Dropdown menu */}
            <div
              className={`absolute left-1/2 -translate-x-1/2 z-[100] w-48 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden ${
                openUpward ? 'bottom-full mb-2' : 'top-full mt-2'
              }`}
              role="dialog"
            >
              <div className="p-3">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">
                  Go to page:
                </label>
                <div className="flex gap-2">
                  <input
                    ref={inputRef}
                    type="number"
                    min={1}
                    max={totalPages}
                    value={jumpValue}
                    onChange={(e) => setJumpValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleJump();
                    }}
                    placeholder={String(currentPage)}
                    className={`flex-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border rounded-lg focus:outline-none focus:ring-2 focus:border-transparent transition-colors ${
                      jumpError
                        ? 'border-red-500 dark:border-red-500 focus:ring-red-500'
                        : 'border-gray-200 dark:border-gray-600 focus:ring-primary-500'
                    }`}
                  />
                  <button
                    onClick={handleJump}
                    className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
                  >
                    Go
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Next page button */}
      <button
        onClick={() => handlePageChangeWithScroll(currentPage + 1)}
        onMouseEnter={() => currentPage < totalPages && onPrefetchPage?.(currentPage + 1)}
        disabled={currentPage === totalPages}
        className={navButtonClass}
        aria-label="Next page"
        title="Next page"
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      {/* Forward skip buttons - hidden on mobile */}
      <div className="hidden sm:flex items-center gap-1">
        <SkipButton delta={5} currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChangeWithScroll} onPrefetchPage={onPrefetchPage} />
        <SkipButton delta={10} currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChangeWithScroll} onPrefetchPage={onPrefetchPage} />
        <SkipButton delta={20} currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChangeWithScroll} onPrefetchPage={onPrefetchPage} />
      </div>

      {/* Last page button */}
      <button
        onClick={() => handlePageChangeWithScroll(totalPages)}
        onMouseEnter={() => currentPage !== totalPages && onPrefetchPage?.(totalPages)}
        disabled={currentPage === totalPages}
        className={navButtonClass}
        aria-label="Last page"
        title="Last page"
      >
        <ChevronsRight className="w-4 h-4" />
      </button>
      </div>

      {/* Progress indicator */}
      {totalItems !== undefined && totalItems > 0 && (
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Showing {startItem.toLocaleString()}–{endItem.toLocaleString()} of {totalItems.toLocaleString()}
        </span>
      )}
    </div>
  );
});
