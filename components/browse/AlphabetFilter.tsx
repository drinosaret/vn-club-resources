'use client';

const LETTERS = ['ALL', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '#'];

interface AlphabetFilterProps {
  activeChar: string | null;
  onSelect: (char: string | null) => void;
  compact?: boolean;
  /** Horizontal scrollable single-row strip mode */
  strip?: boolean;
}

export function AlphabetFilter({ activeChar, onSelect, compact = false, strip = false }: AlphabetFilterProps) {
  if (strip) {
    return (
      <div className="relative">
        <div className="absolute left-0 top-0 bottom-0 w-3 bg-gradient-to-r from-white dark:from-gray-800 to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-3 bg-gradient-to-l from-white dark:from-gray-800 to-transparent z-10 pointer-events-none" />
        <div className="flex gap-0.5 overflow-x-auto scrollbar-none px-1">
          {LETTERS.map((letter) => {
            const isActive = letter === 'ALL' ? !activeChar : activeChar === letter;
            return (
              <button
                key={letter}
                onClick={() => onSelect(letter === 'ALL' ? null : letter)}
                aria-pressed={isActive}
                className={`px-1.5 py-0.5 text-[10px] font-medium rounded whitespace-nowrap flex-shrink-0 transition-colors ${
                  isActive
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                {letter}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={compact
      ? 'flex flex-wrap justify-center gap-0.5'
      : 'flex flex-wrap justify-center gap-0.5 sm:gap-1 p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'
    }>
      {LETTERS.map((letter) => {
        const isActive = letter === 'ALL' ? !activeChar : activeChar === letter;
        return (
          <button
            key={letter}
            onClick={() => onSelect(letter === 'ALL' ? null : letter)}
            aria-pressed={isActive}
            className={`${compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-1.5 py-0.5 text-xs sm:px-2 sm:py-1 sm:text-sm'} font-medium rounded transition-colors ${
              isActive
                ? 'bg-primary-600 text-white'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            {letter}
          </button>
        );
      })}
    </div>
  );
}
