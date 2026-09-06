'use client';

import { Fragment, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ChevronDown, Plus, Minus, Search, X } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  /** Options sharing a group are listed under one heading, in the order given. */
  group?: string;
}

/**
 * Above this many options the list gains a search box. Below it, scanning is faster than
 * typing; above it, the platform list runs to nearly fifty and scrolling is not scanning.
 */
const SEARCHABLE_FROM = 15;

export interface SelectedValue {
  value: string;
  mode: 'include' | 'exclude';
}

interface DropdownSelectProps {
  label: string;
  options: SelectOption[];
  selected: SelectedValue[];
  onChange: (selected: SelectedValue[]) => void;
  placeholder?: string;
  /** Allow exclude mode (click twice to exclude) */
  allowExclude?: boolean;
  /** Compact mode: hide label, smaller padding, use label as placeholder */
  compact?: boolean;
}

export function DropdownSelect({
  label,
  options,
  selected,
  onChange,
  placeholder = 'Any',
  allowExclude = true,
  compact = false,
}: DropdownSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [query, setQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const searchable = options.length >= SEARCHABLE_FROM;

  // Everything index-based below walks this rather than `options`: with a filter applied
  // the two differ, and keyboard focus has to follow what is actually on screen.
  const visibleOptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        option.value.toLowerCase().includes(needle),
    );
  }, [options, query]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset focused index when opening
  useEffect(() => {
    if (isOpen) {
      // Account for clear button at index -1 when there's a selection
      setFocusedIndex(selected.length > 0 ? -1 : 0);
    }
  }, [isOpen, selected.length]);

  // Scroll focused item into view. Located by index attribute rather than by position
  // among the children, which the search box and group headings would otherwise shift.
  useEffect(() => {
    if (isOpen && focusedIndex >= 0 && listRef.current) {
      listRef.current
        .querySelector<HTMLElement>(`[data-option-index="${focusedIndex}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }, [isOpen, focusedIndex]);

  // A stale filter would hide most of the list the next time it opens.
  useEffect(() => {
    if (!isOpen) setQuery('');
    else if (searchable) searchRef.current?.focus();
  }, [isOpen, searchable]);

  // Focus moves back to the top whenever the filter changes what is on screen.
  useEffect(() => {
    setFocusedIndex(query ? 0 : -1);
  }, [query]);

  const getSelectionState = (value: string): 'none' | 'include' | 'exclude' => {
    const found = selected.find(s => s.value === value);
    return found?.mode || 'none';
  };

  const handleOptionClick = (value: string) => {
    const currentState = getSelectionState(value);

    if (currentState === 'none') {
      // Add as include
      onChange([...selected, { value, mode: 'include' }]);
    } else if (currentState === 'include' && allowExclude) {
      // Change to exclude
      onChange(selected.map(s => s.value === value ? { ...s, mode: 'exclude' } : s));
    } else {
      // Remove
      onChange(selected.filter(s => s.value !== value));
    }
  };

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex(prev => {
          const min = selected.length > 0 ? -1 : 0;
          return prev < visibleOptions.length - 1 ? prev + 1 : min;
        });
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(prev => {
          const min = selected.length > 0 ? -1 : 0;
          return prev > min ? prev - 1 : visibleOptions.length - 1;
        });
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusedIndex === -1 && selected.length > 0) {
          onChange([]);
          setIsOpen(false);
        } else if (focusedIndex >= 0 && focusedIndex < visibleOptions.length) {
          handleOptionClick(visibleOptions[focusedIndex].value);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
        break;
      case 'Home':
        e.preventDefault();
        setFocusedIndex(selected.length > 0 ? -1 : 0);
        break;
      case 'End':
        e.preventDefault();
        setFocusedIndex(visibleOptions.length - 1);
        break;
    }
  }, [isOpen, focusedIndex, visibleOptions, selected, onChange, handleOptionClick]);

  // Escape is answered by the innermost control that owns a popup and marked as handled, so a
  // panel enclosing this one does not close on the same key. Focus returns to the trigger,
  // since the element holding it goes away with the list.
  const handleMenuKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  // A text field keeps the keys that edit its value. The shared handler reads Space as select
  // and Home/End as jumps to the ends of the list, which is right on the trigger only.
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Home' || e.key === 'End') return;
    handleKeyDown(e);
  }, [handleKeyDown]);

  // Display text for the button
  const getDisplayText = () => {
    if (selected.length === 0) return compact ? label : placeholder;

    const includeCount = selected.filter(s => s.mode === 'include').length;
    const excludeCount = selected.filter(s => s.mode === 'exclude').length;

    if (selected.length === 1) {
      const item = selected[0];
      const option = options.find(o => o.value === item.value);
      const prefix = item.mode === 'exclude' ? 'Not ' : '';
      return prefix + (option?.label || item.value);
    }

    if (excludeCount === 0) {
      return `${includeCount} selected`;
    }
    return `${includeCount} incl, ${excludeCount} excl`;
  };

  const hasSelection = selected.length > 0;
  const hasExcludes = selected.some(s => s.mode === 'exclude');

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Label */}
      {!compact && (
        <label className="bw-label block mb-1">
          {label}
        </label>
      )}

      {/* Dropdown Button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`
          bw-select w-full flex items-center justify-between gap-2
          ${compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm'}
          ${hasSelection ? (hasExcludes ? 'bw-select--off' : 'bw-select--on') : ''}
        `}
      >
        <span className="truncate">{getDisplayText()}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          ref={listRef}
          role="listbox"
          aria-multiselectable="true"
          onKeyDown={handleMenuKeyDown}
          className="bw-menu absolute z-50 mt-1 w-full sm:min-w-[180px] max-h-64 overflow-y-auto"
        >
          {/* Clear button if has selection */}
          {hasSelection && (
            <button
              type="button"
              onClick={() => {
                onChange([]);
                setIsOpen(false);
              }}
              className={`bw-opt w-full px-3 py-2 text-left text-sm border-b border-[color:var(--rule)] flex items-center gap-2 ${focusedIndex === -1 ? 'bw-opt--focus' : ''}`}
            >
              <X className="w-3 h-3" />
              Clear selection
            </button>
          )}

          {searchable && (
            <div className="sticky top-0 z-10 p-1.5 bg-[color:var(--surface)] border-b border-[color:var(--rule)]">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[color:var(--text-faint)]" />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={`Search ${label.toLowerCase()}`}
                  aria-label={`Search ${label.toLowerCase()}`}
                  className="bw-field w-full pl-7 pr-2 py-1.5 text-sm"
                />
              </div>
            </div>
          )}

          {visibleOptions.length === 0 && (
            <p className="px-3 py-4 text-sm text-center text-[color:var(--nezu)]">
              Nothing matches &ldquo;{query}&rdquo;.
            </p>
          )}

          {visibleOptions.map((option, index) => {
            const state = getSelectionState(option.value);
            const isFocused = index === focusedIndex;
            const startsGroup =
              !!option.group && option.group !== visibleOptions[index - 1]?.group;

            return (
              <Fragment key={option.value}>
              {startsGroup && (
                <div
                  role="presentation"
                  className="bw-menu-head px-3 pt-2 pb-1"
                >
                  {option.group}
                </div>
              )}
              <button
                data-option-index={index}
                type="button"
                role="option"
                aria-selected={state !== 'none'}
                onClick={() => handleOptionClick(option.value)}
                onMouseEnter={() => setFocusedIndex(index)}
                className={`
                  bw-opt w-full px-3 py-2 text-left text-sm flex items-center gap-2
                  ${state === 'include'
                    ? 'bw-opt--on'
                    : state === 'exclude'
                      ? 'bw-opt--off'
                      : isFocused
                        ? 'bw-opt--focus'
                        : ''
                  }
                  ${isFocused && state !== 'none' ? 'ring-1 ring-inset ring-[color:var(--kohaku)]' : ''}
                `}
              >
                {/* State indicator */}
                <span className="w-4 shrink-0">
                  {state === 'include' && <Plus className="w-4 h-4" />}
                  {state === 'exclude' && <Minus className="w-4 h-4" />}
                </span>

                {/* Label */}
                <span className={state === 'exclude' ? 'line-through' : ''}>
                  {option.label}
                </span>
              </button>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
