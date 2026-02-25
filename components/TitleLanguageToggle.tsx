'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Languages, ChevronDown, Check, Settings2, Eye } from 'lucide-react';
import { useTitlePreference, TitlePreference } from '@/lib/title-preference';
import { useNSFWRevealContext } from '@/lib/nsfw-reveal';


const OPTIONS: { value: TitlePreference; label: string; description: string }[] = [
  { value: 'romaji', label: 'EN', description: 'Romaji / English' },
  { value: 'japanese', label: 'JP', description: 'Japanese (日本語)' },
];

type DebugFlag = 'motion' | 'filters' | 'contain-main' | 'contain-grid' | 'text' | 'cover-hover' | 'grid-fade' | 'nostt' | 'paint' | 'noclamp' | 'sysfont' | 'textlayer' | 'noclip' | 'gpulayer';

const DEBUG_OPTIONS: { key: DebugFlag; label: string }[] = [
  { key: 'motion', label: 'Disable motion' },
  { key: 'filters', label: 'Disable filters' },
  { key: 'contain-main', label: 'Disable main contain' },
  { key: 'contain-grid', label: 'Disable grid contain' },
  { key: 'cover-hover', label: 'Disable cover hover effects' },
  { key: 'grid-fade', label: 'Disable grid fade effects' },
  { key: 'text', label: 'Text rendering profile' },
  { key: 'nostt', label: 'Disable scroll-restore hide' },
  { key: 'paint', label: 'Paint diagnostic (red bg)' },
  { key: 'noclamp', label: 'Disable line-clamp' },
  { key: 'sysfont', label: 'Force system font' },
  { key: 'textlayer', label: 'Force text layer' },
  { key: 'noclip', label: 'Disable card clipping' },
  { key: 'gpulayer', label: 'GPU layer containers' },
];

const DEBUG_CLASS_MAP: Record<DebugFlag, string> = {
  motion: 'ffdbg-motion',
  filters: 'ffdbg-filters',
  'contain-main': 'ffdbg-contain-main',
  'contain-grid': 'ffdbg-contain-grid',
  text: 'ffdbg-text',
  'cover-hover': 'ffdbg-cover-hover',
  'grid-fade': 'ffdbg-grid-fade',
  nostt: 'ffdbg-nostt',
  paint: 'ffdbg-paint',
  noclamp: 'ffdbg-noclamp',
  sysfont: 'ffdbg-sysfont',
  textlayer: 'ffdbg-textlayer',
  noclip: 'ffdbg-noclip',
  gpulayer: 'ffdbg-gpulayer',
};

function applyRootDebugClasses(flags: DebugFlag[]) {
  const root = document.documentElement;
  root.classList.remove(
    'ffdbg-motion',
    'ffdbg-filters',
    'ffdbg-contain-main',
    'ffdbg-contain-grid',
    'ffdbg-text',
    'ffdbg-cover-hover',
    'ffdbg-grid-fade',
    'ffdbg-nostt',
    'ffdbg-paint',
    'ffdbg-noclamp',
    'ffdbg-sysfont',
    'ffdbg-textlayer',
    'ffdbg-noclip',
    'ffdbg-gpulayer'
  );
  for (const flag of flags) {
    root.classList.add(DEBUG_CLASS_MAP[flag]);
  }
}

export function TitleLanguageToggle() {
  const { preference, setPreference } = useTitlePreference();
  const nsfwContext = useNSFWRevealContext();
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isFirefox, setIsFirefox] = useState(false);
  const [debugFlags, setDebugFlags] = useState<DebugFlag[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Track hydration to prevent flash
  useEffect(() => {
    setMounted(true);
    setIsFirefox(/firefox/i.test(navigator.userAgent));

    try {
      const raw = (sessionStorage.getItem('ffdbg') || '').toLowerCase();
      if (raw) {
        const parsed = raw.split(',').map(s => s.trim()).filter(Boolean) as DebugFlag[];
        const valid = parsed.filter(flag => DEBUG_OPTIONS.some(opt => opt.key === flag));
        setDebugFlags(valid);
        applyRootDebugClasses(valid);
      }
    } catch {
      setDebugFlags([]);
    }

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

  const debugValue = useMemo(() => {
    if (debugFlags.length === 0) return '';
    return debugFlags.join(',');
  }, [debugFlags]);

  const writeDebugFlags = (nextFlags: DebugFlag[]) => {
    const normalized = Array.from(new Set(nextFlags)).filter(flag => DEBUG_OPTIONS.some(opt => opt.key === flag));
    setDebugFlags(normalized);

    try {
      if (normalized.length > 0) {
        const raw = normalized.join(',');
        sessionStorage.setItem('ffdbg', raw);
      } else {
        sessionStorage.removeItem('ffdbg');
      }
      applyRootDebugClasses(normalized);
    } catch {
      // ignore storage/history failures
    }
  };

  const toggleDebugFlag = (flag: DebugFlag) => {
    if (!isFirefox) return;
    if (debugFlags.includes(flag)) {
      writeDebugFlags(debugFlags.filter(f => f !== flag));
    } else {
      writeDebugFlags([...debugFlags, flag]);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-1 sm:py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm"
        aria-label="Open settings"
        title="Display settings"
      >
        <Settings2 className="w-4 h-4 text-gray-600 dark:text-gray-400" />
        <span className="title-language-label font-medium text-gray-700 dark:text-gray-300 w-5 text-center">{mounted ? currentOption.label : ''}</span>
        <ChevronDown className={`w-3 h-3 text-gray-500 transition-transform hidden sm:block ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1.5 z-50">
          <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Display
          </div>
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setPreference(option.value)}
              className={`w-full px-3 py-2 text-left flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                preference === option.value ? 'bg-gray-50 dark:bg-gray-700/50' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <Languages className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  {option.description}
                </div>
              </div>
              {preference === option.value && (
                <Check className="w-4 h-4 text-primary-600 dark:text-primary-400" />
              )}
            </button>
          ))}

          <div className="mx-3 my-1 h-px bg-gray-200 dark:bg-gray-700" />

          <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Content
          </div>
          <button
            onClick={() => nsfwContext?.setAllRevealed(!nsfwContext.allRevealed)}
            className={`w-full px-3 py-2 text-left flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
              nsfwContext?.allRevealed ? 'bg-gray-50 dark:bg-gray-700/50' : ''
            }`}
          >
            <div className="flex items-center gap-2">
              <Eye className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                Show NSFW uncensored
              </div>
            </div>
            {nsfwContext?.allRevealed && (
              <Check className="w-4 h-4 text-primary-600 dark:text-primary-400" />
            )}
          </button>

          {process.env.NODE_ENV === 'development' && (
            <>
              <div className="mx-3 my-1 h-px bg-gray-200 dark:bg-gray-700" />

              <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 flex items-center justify-between">
                <span>Debug Settings</span>
                {isFirefox ? (
                  <button
                    onClick={() => writeDebugFlags([])}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                  >
                    Clear
                  </button>
                ) : (
                  <span className="text-[10px] normal-case tracking-normal text-gray-400 dark:text-gray-500">Firefox only</span>
                )}
              </div>

              {DEBUG_OPTIONS.map((option) => {
                const active = debugFlags.includes(option.key);
                return (
                  <button
                    key={option.key}
                    onClick={() => toggleDebugFlag(option.key)}
                    disabled={!isFirefox}
                    className={`w-full px-3 py-2 text-left flex items-center justify-between transition-colors ${
                      isFirefox
                        ? 'hover:bg-gray-100 dark:hover:bg-gray-700'
                        : 'opacity-50 cursor-not-allowed'
                    } ${active ? 'bg-gray-50 dark:bg-gray-700/50' : ''}`}
                  >
                    <div className="text-sm font-medium text-gray-900 dark:text-white">{option.label}</div>
                    {active && <Check className="w-4 h-4 text-primary-600 dark:text-primary-400" />}
                  </button>
                );
              })}

              {isFirefox && debugValue && (
                <div className="px-3 pt-1 pb-1 text-[11px] text-gray-500 dark:text-gray-400 truncate" title={debugValue}>
                  Active: {debugValue}
                </div>
              )}

            </>
          )}
        </div>
      )}
    </div>
  );
}
