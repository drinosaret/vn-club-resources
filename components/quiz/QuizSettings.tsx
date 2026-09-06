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
    <div className="panel p-5 pt-7">
      <h2 className="nameplate dg-plate">Settings</h2>

      {/* Quick Presets */}
      <div className="mb-5">
        <label className="fig-label mb-2">Quick Presets</label>
        <div className="tabs">
          <ToggleButton active={bothHaveBasic} onClick={selectBasicPreset}>
            Basic <span className="tab-count">46</span>
          </ToggleButton>
          <ToggleButton active={bothHaveDakuten} onClick={selectDakutenPreset}>
            Dakuten <span className="tab-count">25</span>
          </ToggleButton>
          <ToggleButton active={bothHaveAll} onClick={selectAllPreset}>
            All
          </ToggleButton>
        </div>
      </div>

      {/* Include Combos */}
      <div>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={settings.includeCombo}
            onChange={handleComboToggle}
            className="h-3.5 w-3.5 cursor-pointer rounded-xs border-[color:var(--rule)] accent-[color:var(--ai)]"
          />
          <span className="text-sm text-[color:var(--text-secondary)]">
            Include combo characters (kya, sha, cha...)
          </span>
        </label>
      </div>

      {/* Warning message */}
      {noRowsSelected && (
        <p className="mt-3 text-xs text-[color:var(--beni-text)]">Select at least one row below</p>
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
      className={`tab ${active ? 'tab--on' : ''} ${disabled ? 'opacity-50' : ''}`}
    >
      {children}
    </button>
  );
}
