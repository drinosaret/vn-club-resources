'use client';

import { useReducer, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Dices, Users, User, RotateCcw, Trash2, Globe, Rows3, Grid3X3 } from 'lucide-react';
import { useTitlePreference } from '@/lib/title-preference';
import { useLocale } from '@/lib/i18n/locale-context';
import { rouletteStrings } from '@/lib/i18n/translations/roulette';
import { RouletteWheel } from './RouletteWheel';
import { VNSearchAdd } from './VNSearchAdd';
import { RouletteResult } from './RouletteResult';
import { AssignmentHistory } from './AssignmentHistory';

// ── Types ──

export interface WheelEntry {
  id: string;
  title: string;
  title_jp?: string;
  title_romaji?: string;
  imageUrl?: string | null;
  imageSexual?: number | null;
  rating?: number | null;
}

export interface Assignment {
  player: string;
  vn: WheelEntry;
  round: number;
}

export type SpinState = 'idle' | 'spinning' | 'result';

interface RouletteState {
  mode: 'solo' | 'users';
  entries: WheelEntry[];
  players: string[];
  remainingPlayers: string[];
  currentPlayer: string | null;
  spinState: SpinState;
  winnerIndex: number | null;
  result: WheelEntry | null;
  assignments: Assignment[];
  round: number;
  removeOnPick: boolean;
  playerOrder: 'random' | 'sequential';
}

// ── Reducer ──

type Action =
  | { type: 'ADD_ENTRY'; entry: WheelEntry }
  | { type: 'REMOVE_ENTRY'; id: string }
  | { type: 'ADD_PLAYER'; name: string }
  | { type: 'REMOVE_PLAYER'; name: string }
  | { type: 'SET_MODE'; mode: 'solo' | 'users' }
  | { type: 'START_SPIN' }
  | { type: 'FINISH_SPIN' }
  | { type: 'DISMISS_RESULT' }
  | { type: 'RESET_ASSIGNMENTS' }
  | { type: 'CLEAR_ENTRIES' }
  | { type: 'TOGGLE_REMOVE_ON_PICK' }
  | { type: 'TOGGLE_PLAYER_ORDER' };

const MAX_ENTRIES = 15;
const MAX_PLAYERS = 15;
const STORAGE_KEY = 'vn-roulette-state';

function reducer(state: RouletteState, action: Action): RouletteState {
  switch (action.type) {
    case 'ADD_ENTRY': {
      if (state.entries.length >= MAX_ENTRIES) return state;
      if (state.entries.some(e => e.id === action.entry.id)) return state;
      return { ...state, entries: [...state.entries, action.entry] };
    }
    case 'REMOVE_ENTRY': {
      return { ...state, entries: state.entries.filter(e => e.id !== action.id) };
    }
    case 'ADD_PLAYER': {
      const name = action.name.trim();
      if (!name || state.players.length >= MAX_PLAYERS) return state;
      if (state.players.some(p => p.toLowerCase() === name.toLowerCase())) return state;
      return {
        ...state,
        players: [...state.players, name],
        remainingPlayers: [...state.remainingPlayers, name],
      };
    }
    case 'REMOVE_PLAYER': {
      return {
        ...state,
        players: state.players.filter(p => p !== action.name),
        remainingPlayers: state.remainingPlayers.filter(p => p !== action.name),
      };
    }
    case 'SET_MODE': {
      return {
        ...state,
        mode: action.mode,
        spinState: 'idle',
        result: null,
        winnerIndex: null,
        currentPlayer: null,
      };
    }
    case 'START_SPIN': {
      const winnerIndex = Math.floor(Math.random() * state.entries.length);
      let currentPlayer: string | null = null;
      if (state.mode === 'users' && state.remainingPlayers.length > 0) {
        if (state.playerOrder === 'sequential') {
          currentPlayer = state.remainingPlayers[0];
        } else {
          const playerIndex = Math.floor(Math.random() * state.remainingPlayers.length);
          currentPlayer = state.remainingPlayers[playerIndex];
        }
      }
      return {
        ...state,
        spinState: 'spinning',
        winnerIndex,
        currentPlayer,
        result: null,
      };
    }
    case 'FINISH_SPIN': {
      if (state.winnerIndex === null) return state;
      const result = state.entries[state.winnerIndex];
      const newAssignments = state.mode === 'users' && state.currentPlayer
        ? [...state.assignments, { player: state.currentPlayer, vn: result, round: state.round + 1 }]
        : state.assignments;
      const newRemaining = state.mode === 'users' && state.currentPlayer
        ? state.remainingPlayers.filter(p => p !== state.currentPlayer)
        : state.remainingPlayers;
      const newEntries = state.removeOnPick
        ? state.entries.filter(e => e.id !== result.id)
        : state.entries;
      return {
        ...state,
        entries: newEntries,
        spinState: 'result',
        result,
        assignments: newAssignments,
        remainingPlayers: newRemaining,
        round: state.mode === 'users' ? state.round + 1 : state.round,
      };
    }
    case 'DISMISS_RESULT': {
      return {
        ...state,
        spinState: 'idle',
        result: null,
        winnerIndex: null,
        currentPlayer: null,
      };
    }
    case 'RESET_ASSIGNMENTS': {
      return {
        ...state,
        assignments: [],
        remainingPlayers: [...state.players],
        round: 0,
        spinState: 'idle',
        result: null,
        winnerIndex: null,
        currentPlayer: null,
      };
    }
    case 'CLEAR_ENTRIES': {
      return {
        ...state,
        entries: [],
        spinState: 'idle',
        result: null,
        winnerIndex: null,
      };
    }
    case 'TOGGLE_REMOVE_ON_PICK': {
      return { ...state, removeOnPick: !state.removeOnPick };
    }
    case 'TOGGLE_PLAYER_ORDER': {
      return { ...state, playerOrder: state.playerOrder === 'random' ? 'sequential' : 'random' };
    }
    default:
      return state;
  }
}

const initialState: RouletteState = {
  mode: 'solo',
  entries: [],
  players: [],
  remainingPlayers: [],
  currentPlayer: null,
  spinState: 'idle',
  winnerIndex: null,
  result: null,
  assignments: [],
  round: 0,
  removeOnPick: false,
  playerOrder: 'random',
};

// ── Component ──

function getInitialState(): RouletteState {
  if (typeof window === 'undefined') return initialState;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...initialState,
        mode: parsed.mode || 'solo',
        entries: parsed.entries || [],
        players: parsed.players || [],
        remainingPlayers: parsed.remainingPlayers || parsed.players || [],
        assignments: parsed.assignments || [],
        round: parsed.round || 0,
        removeOnPick: parsed.removeOnPick || false,
        playerOrder: parsed.playerOrder || 'random',
      };
    }
  } catch { /* ignore */ }
  return initialState;
}

export default function RoulettePageClient() {
  const [state, dispatch] = useReducer(reducer, initialState, getInitialState);
  const { preference, setPreference } = useTitlePreference();
  const locale = useLocale();
  const s = rouletteStrings[locale];
  const [isHydrated, setIsHydrated] = useState(false);
  const playerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setIsHydrated(true); }, []);

  // Persist to localStorage
  useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        mode: state.mode,
        entries: state.entries,
        players: state.players,
        remainingPlayers: state.remainingPlayers,
        assignments: state.assignments,
        round: state.round,
        removeOnPick: state.removeOnPick,
        playerOrder: state.playerOrder,
      }));
    } catch { /* ignore */ }
  }, [isHydrated, state.mode, state.entries, state.players, state.remainingPlayers, state.assignments, state.round, state.removeOnPick, state.playerOrder]);

  const handleAddEntry = useCallback((entry: WheelEntry) => {
    dispatch({ type: 'ADD_ENTRY', entry });
  }, []);

  const handleRemoveEntry = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_ENTRY', id });
  }, []);

  const handleSpin = useCallback(() => {
    if (state.entries.length < 2) return;
    if (state.spinState === 'spinning') return;
    if (state.mode === 'users' && state.remainingPlayers.length === 0) return;
    dispatch({ type: 'START_SPIN' });
  }, [state.entries.length, state.spinState, state.mode, state.remainingPlayers.length]);

  const handleSpinComplete = useCallback(() => {
    dispatch({ type: 'FINISH_SPIN' });
  }, []);

  const handleDismissResult = useCallback(() => {
    dispatch({ type: 'DISMISS_RESULT' });
  }, []);

  const handleAddPlayer = useCallback((name: string) => {
    dispatch({ type: 'ADD_PLAYER', name });
  }, []);

  const handleRemovePlayer = useCallback((name: string) => {
    dispatch({ type: 'REMOVE_PLAYER', name });
  }, []);

  const handlePlayerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const input = playerInputRef.current;
      if (input && input.value.trim()) {
        handleAddPlayer(input.value);
        input.value = '';
      }
    }
  };

  const handleAddPlayerClick = () => {
    const input = playerInputRef.current;
    if (input && input.value.trim()) {
      handleAddPlayer(input.value);
      input.value = '';
      input.focus();
    }
  };

  // Auto-assign when exactly 1 player and 1 entry remain in group mode
  const lastPairAutoAssign = state.mode === 'users'
    && state.remainingPlayers.length === 1
    && state.entries.length === 1
    && state.spinState === 'idle';

  const handleAutoAssign = useCallback(() => {
    if (!lastPairAutoAssign) return;
    dispatch({ type: 'START_SPIN' });
    // Immediately finish since the outcome is predetermined
    setTimeout(() => dispatch({ type: 'FINISH_SPIN' }), 0);
  }, [lastPairAutoAssign]);

  const canSpin = state.entries.length >= 2
    && state.spinState !== 'spinning'
    && (state.mode === 'solo' || state.remainingPlayers.length > 0);

  const allAssigned = state.mode === 'users' && state.remainingPlayers.length === 0 && state.players.length > 0;

  return (
    <div className="min-h-[80vh] px-4 py-8 md:py-12">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-violet-100 dark:bg-violet-900/30 mb-4">
            <Dices className="w-8 h-8 text-violet-600 dark:text-violet-400" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            {s['page.title']}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            {s['page.subtitle']}
          </p>
          <Link
            href={locale === 'en' ? '/ja/roulette/' : '/roulette/'}
            className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            onClick={() => setPreference(locale === 'en' ? 'japanese' : 'romaji')}
          >
            <Globe className="w-3.5 h-3.5" />
            {locale === 'en' ? '日本語' : 'English'}
          </Link>

          {/* Mode toggle */}
          <div className="flex items-center justify-center gap-1 mt-4 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit mx-auto">
            <button
              onClick={() => dispatch({ type: 'SET_MODE', mode: 'solo' })}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                state.mode === 'solo'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              {s['mode.solo']}
            </button>
            <button
              onClick={() => dispatch({ type: 'SET_MODE', mode: 'users' })}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                state.mode === 'users'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              {s['mode.group']}
            </button>
          </div>

          <div className="flex flex-col items-center gap-1.5 mt-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={state.removeOnPick}
                onChange={() => dispatch({ type: 'TOGGLE_REMOVE_ON_PICK' })}
                className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-violet-600 focus:ring-violet-500"
              />
              <span className="text-xs text-gray-500 dark:text-gray-400">{s['settings.removeOnPick']}</span>
            </label>
            {state.mode === 'users' && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={state.playerOrder === 'sequential'}
                  onChange={() => dispatch({ type: 'TOGGLE_PLAYER_ORDER' })}
                  className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-violet-600 focus:ring-violet-500"
                />
                <span className="text-xs text-gray-500 dark:text-gray-400">{s['settings.playerOrder']}</span>
              </label>
            )}
          </div>
        </div>

        {/* Main content */}
        <div className="flex max-lg:flex-col lg:flex-row gap-4 lg:gap-5">
          {/* Left sidebar */}
          <div className="max-lg:w-full lg:w-56 shrink-0 space-y-3">
            {/* VN Search */}
            <div>
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                {s['sidebar.vnCount'].replace('{count}', String(state.entries.length)).replace('{max}', String(MAX_ENTRIES))}
              </h2>
              <VNSearchAdd
                onAdd={handleAddEntry}
                isItemInList={useCallback((id: string) => state.entries.some(e => e.id === id), [state.entries])}
                isAtCapacity={state.entries.length >= MAX_ENTRIES}
                disabled={state.spinState === 'spinning'}
                placeholder={state.entries.length >= MAX_ENTRIES ? s['sidebar.searchCapacity'] : s['sidebar.searchPlaceholder']}
                addedLabel={s['sidebar.added']}
                errorMessage={s['sidebar.searchError']}
              />
            </div>

            {/* Entry list */}
            {state.entries.length > 0 && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 overflow-hidden">
                <div className="max-h-64 overflow-y-auto">
                  {state.entries.map((entry, i) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      index={i}
                      onRemove={handleRemoveEntry}
                      disabled={state.spinState === 'spinning'}
                      preference={preference}
                    />
                  ))}
                </div>
                {state.entries.length > 0 && (
                  <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-1.5">
                    <button
                      onClick={() => dispatch({ type: 'CLEAR_ENTRIES' })}
                      disabled={state.spinState === 'spinning'}
                      className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                    >
                      {s['sidebar.clearAll']}
                    </button>
                  </div>
                )}
              </div>
            )}

            {state.entries.length === 0 && (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
                {s['sidebar.emptyHint']}
              </p>
            )}
          </div>

          {/* Center: Wheel */}
          <div className="flex-1 flex flex-col items-center">
            <div className="relative w-full flex flex-col items-center">
              <RouletteWheel
                entries={state.entries}
                spinState={state.spinState}
                winnerIndex={state.winnerIndex}
                onSpinComplete={handleSpinComplete}
                titlePreference={preference}
                emptyText={s['wheel.emptyText']}
              />

              {/* Result overlay on top of wheel */}
              {state.spinState === 'result' && state.result && (
                <div className="absolute inset-0 flex items-center justify-center z-10">
                  <RouletteResult
                    result={state.result}
                    currentPlayer={state.currentPlayer}
                    mode={state.mode}
                    onDismiss={handleDismissResult}
                    hasMorePlayers={state.remainingPlayers.length > 0}
                    allAssigned={allAssigned}
                  />
                </div>
              )}
            </div>

            {/* Current player indicator (users mode, during spin) */}
            {state.mode === 'users' && state.currentPlayer && state.spinState === 'spinning' && (
              <div className="mt-4 text-center animate-fade-in">
                <span className="text-sm text-gray-500 dark:text-gray-400">{s['spin.spinningFor']} </span>
                <span className="font-semibold text-violet-600 dark:text-violet-400">{state.currentPlayer}</span>
              </div>
            )}

            {/* Spin button or auto-assign */}
            {state.spinState !== 'result' && (
              lastPairAutoAssign ? (
                <button
                  onClick={handleAutoAssign}
                  className="mt-6 px-8 py-3 text-lg font-semibold rounded-xl bg-violet-600 text-white hover:bg-violet-700 active:bg-violet-800 transition-colors shadow-lg shadow-violet-600/20 hover:shadow-violet-600/30"
                >
                  {s['spin.assignLast']}
                </button>
              ) : (
                <button
                  onClick={handleSpin}
                  disabled={!canSpin}
                  className="mt-6 px-8 py-3 text-lg font-semibold rounded-xl bg-violet-600 text-white hover:bg-violet-700 active:bg-violet-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-violet-600/20 hover:shadow-violet-600/30"
                >
                  {state.spinState === 'spinning' ? s['spin.spinning'] : s['spin.button']}
                </button>
              )
            )}

            {/* All assigned message */}
            {allAssigned && state.spinState === 'idle' && (
              <div className="mt-6 text-center">
                <p className="text-green-600 dark:text-green-400 font-medium mb-2">{s['result.allAssigned']}</p>
                <button
                  onClick={() => dispatch({ type: 'RESET_ASSIGNMENTS' })}
                  className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-violet-600 dark:text-gray-400 dark:hover:text-violet-400 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {s['result.resetAndGoAgain']}
                </button>
              </div>
            )}
          </div>

          {/* Right sidebar: Player queue (users mode only) */}
          {state.mode === 'users' && (
            <div className="max-lg:w-full lg:w-52 shrink-0">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                {s['players.title'].replace('{remaining}', String(state.remainingPlayers.length)).replace('{total}', String(state.players.length))}
              </h2>

              {/* Add player input */}
              <div className="flex gap-2 mb-3">
                <input
                  ref={playerInputRef}
                  type="text"
                  placeholder={s['players.addPlaceholder']}
                  onKeyDown={handlePlayerKeyDown}
                  disabled={state.spinState === 'spinning' || state.players.length >= MAX_PLAYERS}
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-violet-500 focus:border-violet-500 disabled:opacity-50"
                />
                <button
                  onClick={handleAddPlayerClick}
                  disabled={state.spinState === 'spinning' || state.players.length >= MAX_PLAYERS}
                  className="px-3 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-40 whitespace-nowrap"
                >
                  {s['players.addButton']}
                </button>
              </div>

              {/* Player list */}
              {state.players.length > 0 && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 overflow-hidden">
                  <div className="max-h-64 overflow-y-auto">
                    {state.players.map(player => {
                      const isRemaining = state.remainingPlayers.includes(player);
                      const isCurrent = state.currentPlayer === player;
                      return (
                        <div
                          key={player}
                          className={`flex items-center gap-2 px-3 py-2 text-sm border-b border-gray-100 dark:border-gray-700/50 last:border-0 ${
                            isCurrent
                              ? 'bg-violet-50 dark:bg-violet-900/20'
                              : !isRemaining
                                ? 'opacity-50'
                                : ''
                          }`}
                        >
                          <div className={`w-2 h-2 rounded-full shrink-0 ${
                            isCurrent ? 'bg-violet-500' : isRemaining ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                          }`} />
                          <span className={`flex-1 min-w-0 truncate ${
                            !isRemaining ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-white'
                          }`}>
                            {player}
                          </span>
                          <button
                            onClick={() => handleRemovePlayer(player)}
                            disabled={state.spinState === 'spinning'}
                            className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors disabled:opacity-50 shrink-0"
                            aria-label={`Remove ${player}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {state.assignments.length > 0 && (
                    <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-1.5">
                      <button
                        onClick={() => dispatch({ type: 'RESET_ASSIGNMENTS' })}
                        disabled={state.spinState === 'spinning'}
                        className="text-xs text-gray-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors disabled:opacity-50"
                      >
                        {s['players.resetAssignments']}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {state.players.length === 0 && (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
                  {s['players.emptyHint']}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Assignment history */}
        {state.mode === 'users' && state.assignments.length > 0 && (
          <AssignmentHistory
            assignments={state.assignments}
            onReset={() => dispatch({ type: 'RESET_ASSIGNMENTS' })}
            titlePreference={preference}
          />
        )}

        <div className="mt-6 flex justify-center gap-4">
          <Link
            href={locale === 'ja' ? '/ja/tierlist/' : '/tierlist/'}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
          >
            <Rows3 className="w-4 h-4" />
            {s['crosslink.tryTierList']}
          </Link>
          <Link
            href={locale === 'ja' ? '/ja/3x3-maker/' : '/3x3-maker/'}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
          >
            <Grid3X3 className="w-4 h-4" />
            {s['crosslink.try3x3']}
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Entry row ──

import { getDisplayTitle, type TitlePreference } from '@/lib/title-preference';
import { getTinySrc } from '@/lib/vndb-image-cache';
import { NSFW_THRESHOLD } from '@/lib/nsfw-reveal';

const WHEEL_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7',
];

function EntryRow({ entry, index, onRemove, disabled, preference }: {
  entry: WheelEntry;
  index: number;
  onRemove: (id: string) => void;
  disabled: boolean;
  preference: TitlePreference;
}) {
  const color = WHEEL_COLORS[index % WHEEL_COLORS.length];
  const title = getDisplayTitle(entry, preference);
  const isNsfw = entry.imageSexual != null && entry.imageSexual >= NSFW_THRESHOLD;
  const coverSrc = entry.imageUrl ? (isNsfw ? getTinySrc(entry.imageUrl) : entry.imageUrl) : null;

  return (
    <div className="flex items-start gap-2 px-3 py-1.5 text-sm border-b border-gray-100 dark:border-gray-700/50 last:border-0">
      <div className="w-1 h-6 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: color }} />
      {coverSrc && (
        <div className="w-6 h-8 shrink-0 rounded overflow-hidden bg-gray-100 dark:bg-gray-700">
          <img src={coverSrc} alt="" className="w-full h-full object-cover" style={isNsfw ? { imageRendering: 'pixelated' } : undefined} />
        </div>
      )}
      <span className="flex-1 min-w-0 text-gray-900 dark:text-white break-words">
        {title}
      </span>
      <button
        onClick={() => onRemove(entry.id)}
        disabled={disabled}
        className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors disabled:opacity-50 shrink-0"
        aria-label={`Remove ${title}`}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
