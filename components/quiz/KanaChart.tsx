'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  hiraganaBasic,
  hiraganaDakuten,
  katakanaBasic,
  katakanaDakuten,
  basicRows,
  dakutenRows,
  allRows,
  type KanaCharacter,
  type KanaRow,
  type QuizSettings,
} from '@/lib/kana-data';

interface KanaChartProps {
  settings: QuizSettings;
  onSettingsChange: (settings: QuizSettings) => void;
}

export function KanaChart({ settings, onSettingsChange }: KanaChartProps) {
  const [isOpen, setIsOpen] = useState(true);
  const noRowsSelected = settings.hiraganaRows.length === 0 && settings.katakanaRows.length === 0;

  // Group kana by row for display
  const groupByRow = (kanaList: KanaCharacter[]) => {
    const groups: Record<KanaRow, KanaCharacter[]> = {} as Record<KanaRow, KanaCharacter[]>;
    kanaList.forEach(char => {
      if (!groups[char.row]) groups[char.row] = [];
      groups[char.row].push(char);
    });
    return groups;
  };

  const hiraganaBasicGroups = groupByRow(hiraganaBasic);
  const hiraganaDakutenGroups = groupByRow(hiraganaDakuten);
  const katakanaBasicGroups = groupByRow(katakanaBasic);
  const katakanaDakutenGroups = groupByRow(katakanaDakuten);

  // Hiragana row handlers
  const handleHiraganaRowToggle = (row: KanaRow) => {
    const newRows = settings.hiraganaRows.includes(row)
      ? settings.hiraganaRows.filter(r => r !== row)
      : [...settings.hiraganaRows, row];
    onSettingsChange({ ...settings, hiraganaRows: newRows });
  };

  const setHiraganaRows = (rows: KanaRow[]) => {
    onSettingsChange({ ...settings, hiraganaRows: rows });
  };

  // Katakana row handlers
  const handleKatakanaRowToggle = (row: KanaRow) => {
    const newRows = settings.katakanaRows.includes(row)
      ? settings.katakanaRows.filter(r => r !== row)
      : [...settings.katakanaRows, row];
    onSettingsChange({ ...settings, katakanaRows: newRows });
  };

  const setKatakanaRows = (rows: KanaRow[]) => {
    onSettingsChange({ ...settings, katakanaRows: rows });
  };

  return (
    <div className="overflow-hidden rounded-xs border border-[color:var(--rule)] bg-[color:var(--surface)]">
      {/* Header - clickable to expand/collapse */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-[color:var(--surface-inset)]"
      >
        <h2 className="font-display text-sm font-bold uppercase tracking-[0.08em] text-[color:var(--ink)]">
          Select Rows &amp; Reference Chart
        </h2>
        {isOpen ? (
          <ChevronUp className="h-5 w-5 text-[color:var(--nezu)]" />
        ) : (
          <ChevronDown className="h-5 w-5 text-[color:var(--nezu)]" />
        )}
      </button>

      {/* Content */}
      {isOpen && (
        <div className="border-t border-[color:var(--rule)] px-5 pb-5">
          {/* Warning when no rows selected */}
          {noRowsSelected && (
            <p className="mt-4 rounded-xs border border-[color:var(--rule)] p-3 text-sm text-[color:var(--beni-text)]">
              No kana selected. Please select at least one row to start the quiz.
            </p>
          )}

          {/* Two columns: Hiragana and Katakana */}
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            {/* Hiragana Column */}
            <KanaSection
              title="Hiragana"
              selectedRows={settings.hiraganaRows}
              basicGroups={hiraganaBasicGroups}
              dakutenGroups={hiraganaDakutenGroups}
              onRowToggle={handleHiraganaRowToggle}
              onSetRows={setHiraganaRows}
            />

            {/* Katakana Column */}
            <KanaSection
              title="Katakana"
              selectedRows={settings.katakanaRows}
              basicGroups={katakanaBasicGroups}
              dakutenGroups={katakanaDakutenGroups}
              onRowToggle={handleKatakanaRowToggle}
              onSetRows={setKatakanaRows}
            />
          </div>
        </div>
      )}
    </div>
  );
}

interface KanaSectionProps {
  title: string;
  selectedRows: KanaRow[];
  basicGroups: Record<KanaRow, KanaCharacter[]>;
  dakutenGroups: Record<KanaRow, KanaCharacter[]>;
  onRowToggle: (row: KanaRow) => void;
  onSetRows: (rows: KanaRow[]) => void;
}

function KanaSection({ title, selectedRows, basicGroups, dakutenGroups, onRowToggle, onSetRows }: KanaSectionProps) {
  return (
    <div>
      {/* Section Header with Quick Buttons */}
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-display text-sm font-bold text-[color:var(--ink)]">{title}</h3>
        <div className="flex gap-2">
          <button onClick={() => onSetRows([...allRows])} className="kana-act">
            All
          </button>
          <span className="kana-act">·</span>
          <button onClick={() => onSetRows([])} className="kana-act">
            None
          </button>
          <span className="kana-act">·</span>
          <button onClick={() => onSetRows([...basicRows])} className="kana-act">
            Basic
          </button>
          <span className="kana-act">·</span>
          <button onClick={() => onSetRows([...dakutenRows])} className="kana-act">
            Dakuten
          </button>
        </div>
      </div>

      {/* Rows */}
      <div className="space-y-3">
        {/* Basic rows */}
        <div className="space-y-1">
          {basicRows.map(row => (
            <KanaRowDisplay
              key={row}
              kana={basicGroups[row] || []}
              isSelected={selectedRows.includes(row)}
              onToggle={() => onRowToggle(row)}
            />
          ))}
        </div>

        {/* Dakuten separator */}
        <div className="border-t border-[color:var(--rule)] pt-2">
          <span className="fig-label">Dakuten</span>
        </div>

        {/* Dakuten rows */}
        <div className="space-y-1">
          {dakutenRows.map(row => (
            <KanaRowDisplay
              key={row}
              kana={dakutenGroups[row] || []}
              isSelected={selectedRows.includes(row)}
              onToggle={() => onRowToggle(row)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface KanaRowDisplayProps {
  kana: KanaCharacter[];
  isSelected: boolean;
  onToggle: () => void;
}

function KanaRowDisplay({ kana, isSelected, onToggle }: KanaRowDisplayProps) {
  if (kana.length === 0) return null;

  return (
    <button
      onClick={onToggle}
      aria-pressed={isSelected}
      aria-label={`Toggle ${kana[0]?.row || 'kana'} row`}
      className={`kana-row ${isSelected ? 'kana-row--on' : ''}`}
    >
      <span className="kana-tick" aria-hidden>
        ✓
      </span>

      <span className="flex flex-wrap gap-0.5">
        {kana.map((char) => (
          <span key={char.kana} className="kana-cell">
            <span className="kana-char">{char.kana}</span>
            <span className="kana-romaji">{char.romaji}</span>
          </span>
        ))}
      </span>
    </button>
  );
}
