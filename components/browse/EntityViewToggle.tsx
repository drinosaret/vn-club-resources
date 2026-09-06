'use client';

import { LayoutGrid, List } from 'lucide-react';

export type ViewMode = 'table' | 'cards';

export function EntityViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <div className="tabs">
      <button
        onClick={() => onChange('table')}
        className={`tab${mode === 'table' ? ' tab--on' : ''}`}
        title="Table view"
      >
        <List className="w-4 h-4" />
      </button>
      <button
        onClick={() => onChange('cards')}
        className={`tab${mode === 'cards' ? ' tab--on' : ''}`}
        title="Card view"
      >
        <LayoutGrid className="w-4 h-4" />
      </button>
    </div>
  );
}
