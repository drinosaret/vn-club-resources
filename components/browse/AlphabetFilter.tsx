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
        <div className="absolute left-0 top-0 bottom-0 w-3 bg-linear-to-r from-[color:var(--surface)] to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-3 bg-linear-to-l from-[color:var(--surface)] to-transparent z-10 pointer-events-none" />
        <div className="flex gap-0.5 overflow-x-auto scrollbar-none px-1">
          {LETTERS.map((letter) => {
            const isActive = letter === 'ALL' ? !activeChar : activeChar === letter;
            return (
              <button
                key={letter}
                onClick={() => onSelect(letter === 'ALL' ? null : letter)}
                aria-pressed={isActive}
                className={`bw-alpha whitespace-nowrap shrink-0${isActive ? ' bw-alpha--on' : ''}`}
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
      : 'bw-panel flex flex-wrap justify-center gap-0.5 sm:gap-1 p-2'
    }>
      {LETTERS.map((letter) => {
        const isActive = letter === 'ALL' ? !activeChar : activeChar === letter;
        return (
          <button
            key={letter}
            onClick={() => onSelect(letter === 'ALL' ? null : letter)}
            aria-pressed={isActive}
            className={`bw-alpha${isActive ? ' bw-alpha--on' : ''}`}
          >
            {letter}
          </button>
        );
      })}
    </div>
  );
}
