'use client';

import type { QuizSettings as QuizSettingsType } from '@/lib/kana-data';
import { basicRows, dakutenRows, allRows } from '@/lib/kana-data';

interface QuizSettingsProps {
  settings: QuizSettingsType;
  onSettingsChange: (settings: QuizSettingsType) => void;
}

export function QuizSettings({ settings, onSettingsChange }: QuizSettingsProps) {
  const handleComboToggle = () => {
    onSettingsChange({
      ...settings,
      includeCombo: !settings.includeCombo,
    });
  };

  // Preset buttons - set both hiragana and katakana rows
  const selectBasicPreset = () => {
    onSettingsChange({
      ...settings,
      hiraganaRows: [...basicRows],
      katakanaRows: [...basicRows],
      includeCombo: false,
    });
  };

  const selectDakutenPreset = () => {
    onSettingsChange({
      ...settings,
      hiraganaRows: [...dakutenRows],
      katakanaRows: [...dakutenRows],
      includeCombo: false,
    });
  };

  const selectAllPreset = () => {
    onSettingsChange({
      ...settings,
      hiraganaRows: [...allRows],
      katakanaRows: [...allRows],
    });
  };

  const noRowsSelected = settings.hiraganaRows.length === 0 && settings.katakanaRows.length === 0;

  // Determine which preset is active (both scripts have same rows)
  const bothHaveBasic = settings.hiraganaRows.length === basicRows.length &&
    basicRows.every(r => settings.hiraganaRows.includes(r)) &&
    settings.katakanaRows.length === basicRows.length &&
    basicRows.every(r => settings.katakanaRows.includes(r)) &&
    !settings.includeCombo;
  const bothHaveDakuten = settings.hiraganaRows.length === dakutenRows.length &&
    dakutenRows.every(r => settings.hiraganaRows.includes(r)) &&
    settings.katakanaRows.length === dakutenRows.length &&
    dakutenRows.every(r => settings.katakanaRows.includes(r)) &&
    !settings.includeCombo;
  const bothHaveAll = settings.hiraganaRows.length === allRows.length &&
    allRows.every(r => settings.hiraganaRows.includes(r)) &&
    settings.katakanaRows.length === allRows.length &&
    allRows.every(r => settings.katakanaRows.includes(r));

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Quiz Settings</h3>

      {/* Quick Presets */}
      <div className="mb-5">
        <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2 block">
          Quick Presets
        </label>
        <div className="flex flex-wrap gap-2">
          <ToggleButton
            active={bothHaveBasic}
            onClick={selectBasicPreset}
          >
            Basic (46)
          </ToggleButton>
          <ToggleButton
            active={bothHaveDakuten}
            onClick={selectDakutenPreset}
          >
            Dakuten (25)
          </ToggleButton>
          <ToggleButton
            active={bothHaveAll}
            onClick={selectAllPreset}
          >
            All
          </ToggleButton>
        </div>
      </div>

      {/* Include Combos */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer group">
          <input
            type="checkbox"
            checked={settings.includeCombo}
            onChange={handleComboToggle}
            className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-emerald-600 focus:ring-emerald-500 dark:bg-gray-700 cursor-pointer"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white">
            Include combo characters (kya, sha, cha..)
          </span>
        </label>
      </div>

      {/* Warning message */}
      {noRowsSelected && (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
          Select at least one row below
        </p>
      )}
    </div>
  );
}

interface ToggleButtonProps {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

function ToggleButton({ active, onClick, disabled, children }: ToggleButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
        ${active
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200 ring-2 ring-emerald-500/50'
          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      {children}
    </button>
  );
}
