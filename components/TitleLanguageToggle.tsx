'use client';

import { useState, useRef, useEffect } from 'react';
import { Languages, ChevronDown, Check } from 'lucide-react';
import { useTitlePreference, TitlePreference } from '@/lib/title-preference';

const OPTIONS: { value: TitlePreference; label: string; description: string }[] = [
  { value: 'romaji', label: 'EN', description: 'Romaji / English' },
  { value: 'japanese', label: 'JP', description: 'Japanese (日本語)' },
];

export function TitleLanguageToggle() {
  const { preference, setPreference } = useTitlePreference();
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Track hydration to prevent flash
  useEffect(() => {
    setMounted(true);
  }, []);

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

  const currentOption = OPTIONS.find(o => o.value === preference) || OPTIONS[0];

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-1 sm:py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm"
        aria-label="Change title language"
        title="Title display language"
      >
        <Languages className="w-4 h-4 text-gray-600 dark:text-gray-400" />
        <span className="font-medium text-gray-700 dark:text-gray-300 w-5 text-center">{mounted ? currentOption.label : ''}</span>
        <ChevronDown className={`w-3 h-3 text-gray-500 transition-transform hidden sm:block ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1 w-44 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                setPreference(option.value);
                setIsOpen(false);
              }}
              className={`w-full px-3 py-2 text-left flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                preference === option.value ? 'bg-gray-50 dark:bg-gray-700/50' : ''
              }`}
            >
              <div>
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  {option.description}
                </div>
              </div>
              {preference === option.value && (
                <Check className="w-4 h-4 text-primary-600 dark:text-primary-400" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
