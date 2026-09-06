'use client';

/**
 * How many titles the reader has hidden on this page, with the way back.
 *
 * Undo names the last title hidden because a slip on a small button is the common case;
 * showing every hidden title is the rarer one and is a toggle rather than a list.
 */
export function HiddenTitlesBar({
  count,
  showing,
  onToggleShow,
  lastHiddenTitle,
  onUndo,
  onClear,
}: {
  count: number;
  showing: boolean;
  onToggleShow: () => void;
  lastHiddenTitle: string | null;
  onUndo: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <p role="status" className="rc-why flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
      <span>
        <span className="rc-num">{count}</span> hidden on this page
      </span>
      {lastHiddenTitle && (
        <button type="button" onClick={onUndo} className="rc-btn min-w-0 max-w-full">
          <span className="min-w-0 truncate">Undo: {lastHiddenTitle}</span>
        </button>
      )}
      <button type="button" onClick={onToggleShow} className="rc-btn">
        {showing ? 'Hide them again' : 'Show hidden'}
      </button>
      <button type="button" onClick={onClear} className="rc-btn">
        Forget every hidden title
      </button>
    </p>
  );
}
