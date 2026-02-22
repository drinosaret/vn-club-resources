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
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header - clickable to expand/collapse */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
      >
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          Select Rows & Reference Chart
        </h3>
        {isOpen ? (
          <ChevronUp className="w-5 h-5 text-gray-400" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-400" />
        )}
      </button>

      {/* Content */}
      {isOpen && (
        <div className="px-5 pb-5 border-t border-gray-200 dark:border-gray-700">
          {/* Warning when no rows selected */}
          {noRowsSelected && (
            <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <p className="text-sm text-amber-700 dark:text-amber-300">
                No kana selected. Please select at least one row to start the quiz.
              </p>
            </div>
          )}

          {/* Two columns: Hiragana and Katakana */}
          <div className="grid md:grid-cols-2 gap-6 mt-4">
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
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h4>
        <div className="flex gap-2 text-xs">
          <button
            onClick={() => onSetRows([...allRows])}
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            All
          </button>
          <span className="text-gray-400">·</span>
          <button
            onClick={() => onSetRows([])}
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            None
          </button>
          <span className="text-gray-400">·</span>
          <button
            onClick={() => onSetRows([...basicRows])}
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Basic
          </button>
          <span className="text-gray-400">·</span>
          <button
            onClick={() => onSetRows([...dakutenRows])}
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
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
        <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
          <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
            Dakuten
          </span>
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
      className={`w-full flex items-center gap-2 p-1.5 rounded-lg transition-all focus:outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800 ${
        isSelected
          ? 'bg-emerald-50 dark:bg-emerald-900/20 ring-1 ring-emerald-500/50'
          : 'bg-gray-50 dark:bg-gray-700/30 opacity-50 hover:opacity-75'
      }`}
    >
      {/* Checkbox */}
      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
        isSelected
          ? 'bg-emerald-500 border-emerald-500'
          : 'border-gray-300 dark:border-gray-600'
      }`}>
        {isSelected && (
          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        )}
      </div>

      {/* Kana characters */}
      <div className="flex gap-0.5 flex-wrap">
        {kana.map((char) => (
          <div
            key={char.kana}
            className={`w-7 h-7 sm:w-8 sm:h-8 flex flex-col items-center justify-center rounded transition-colors ${
              isSelected
                ? 'bg-white dark:bg-gray-800'
                : 'bg-gray-100 dark:bg-gray-700'
            }`}
          >
            <span className={`text-xs sm:text-sm font-medium leading-none ${
              isSelected
                ? 'text-gray-900 dark:text-white'
                : 'text-gray-400 dark:text-gray-500'
            }`}>
              {char.kana}
            </span>
            <span className="text-[6px] sm:text-[7px] text-gray-400 dark:text-gray-500 leading-none">
              {char.romaji}
            </span>
          </div>
        ))}
      </div>
    </button>
  );
}
