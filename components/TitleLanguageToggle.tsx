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
        className="sw-icon gap-0.5 sm:gap-1"
        aria-label="Open settings"
        title="Display settings"
      >
        <Settings2 className="w-4 h-4" />
        <span className="title-language-label font-mono w-5 text-center">{mounted ? currentOption.label : ''}</span>
        <ChevronDown className={`w-3 h-3 transition-transform hidden sm:block ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="sw-menu absolute right-0 mt-1 w-64 py-1.5 z-50">
          <div className="sw-plate px-3 pt-1 pb-1.5">
            Title Language
          </div>
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setPreference(option.value)}
              className={`sw-opt justify-between ${preference === option.value ? 'sw-opt--on' : ''}`}
            >
              <span className="flex items-center gap-2">
                <Languages className="w-3.5 h-3.5 shrink-0" />
                {option.description}
              </span>
              {preference === option.value && (
                <Check className="w-4 h-4 shrink-0 sw-tick" />
              )}
            </button>
          ))}

          <div className="sw-sep mx-3 my-1" />

          <div className="sw-plate px-3 pt-1 pb-1.5">
            Content
          </div>
          <button
            onClick={() => nsfwContext?.setAllRevealed(!nsfwContext.allRevealed)}
            className={`sw-opt justify-between ${nsfwContext?.allRevealed ? 'sw-opt--on' : ''}`}
          >
            <span className="flex items-center gap-2">
              <Eye className="w-3.5 h-3.5 shrink-0" />
              Show NSFW uncensored
            </span>
            {nsfwContext?.allRevealed && (
              <Check className="w-4 h-4 shrink-0 sw-tick" />
            )}
          </button>

          {process.env.NODE_ENV === 'development' && (
            <>
              <div className="sw-sep mx-3 my-1" />

              <div className="sw-plate px-3 pt-1 pb-1.5 flex items-center justify-between">
                <span>Debug Settings</span>
                {isFirefox ? (
                  <button onClick={() => writeDebugFlags([])} className="sw-act">
                    Clear
                  </button>
                ) : (
                  <span className="normal-case tracking-normal text-[color:var(--text-faint)]">Firefox only</span>
                )}
              </div>

              {DEBUG_OPTIONS.map((option) => {
                const active = debugFlags.includes(option.key);
                return (
                  <button
                    key={option.key}
                    onClick={() => toggleDebugFlag(option.key)}
                    disabled={!isFirefox}
                    className={`sw-opt justify-between ${active ? 'sw-opt--on' : ''}`}
                  >
                    <span>{option.label}</span>
                    {active && <Check className="w-4 h-4 shrink-0 sw-tick" />}
                  </button>
                );
              })}

              {isFirefox && debugValue && (
                <div className="px-3 pt-1 pb-1 text-[11px] text-[color:var(--nezu)] truncate" title={debugValue}>
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
