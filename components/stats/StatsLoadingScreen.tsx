'use client';

import { useState, useEffect, useRef } from 'react';
import { CheckCircle2, Circle, Loader2, AlertCircle } from 'lucide-react';
import type { LoadingStage } from '@/hooks/useLoadingProgress';

interface StatsLoadingScreenProps {
  /** Title to display at the top */
  title?: string;
  /** Username being loaded (if known) */
  username?: string;
  /** Current loading stages with their status */
  stages: LoadingStage[];
  /** Current stage index (0-based) */
  currentStage: number;
  /** Elapsed time in milliseconds */
  elapsedTime: number;
  /** Whether an error occurred */
  hasError?: boolean;
  /** Help text shown at the bottom */
  helpText?: string;
}

function formatElapsedTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Why the screen reserves more than a viewport, and why it does not centre in it.
 *
 * A loading state stands in for a page, so it has to occupy roughly what the page will. Held
 * to its own content, it leaves the footer sitting at the fold, and the footer then travels
 * the height of the loaded page the moment the data lands. The extra band keeps the footer
 * below the fold until there is a page to put above it.
 *
 * The band is taller than the viewport, so its middle is past the fold: centring inside it
 * would put the thing the reader is waiting on somewhere they cannot see. The content sits
 * near the top of the band instead, and the rest of the band is empty on purpose.
 */
export function StatsLoadingScreen({
  title,
  username,
  stages,
  currentStage,
  elapsedTime,
  hasError = false,
  helpText = 'Large collections may take up to 30 seconds',
}: StatsLoadingScreenProps) {
  const displayTitle = title || (username ? `Loading Stats for ${username}` : 'Loading Stats');

  return (
    <div className="flex flex-col items-center justify-start min-h-[calc(100vh+8rem)] p-8 pt-[12vh]">
      {/* Title */}
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        {displayTitle}
      </h2>

      {/* Subtitle with elapsed time */}
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
        Elapsed: {formatElapsedTime(elapsedTime)}
      </p>

      {/* Progress stages */}
      <div className="w-full max-w-md space-y-1 mb-8">
        {stages.map((stage, index) => {
          const isCompleted = stage.status === 'completed';
          const isActive = stage.status === 'active';
          const isError = stage.status === 'error';
          const isPending = stage.status === 'pending';

          return (
            <div
              key={stage.id}
              className={`
                flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all
                ${isActive ? 'bg-primary-50 dark:bg-primary-900/20' : ''}
                ${isError ? 'bg-red-50 dark:bg-red-900/20' : ''}
                ${isCompleted ? 'opacity-60' : ''}
              `}
            >
              {/* Status icon */}
              <div className="shrink-0">
                {isCompleted ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                ) : isActive ? (
                  <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
                ) : isError ? (
                  <AlertCircle className="w-5 h-5 text-red-500" />
                ) : (
                  <Circle className="w-5 h-5 text-gray-300 dark:text-gray-600" />
                )}
              </div>

              {/* Stage name and detail */}
              <div className="flex-1 min-w-0">
                <span
                  className={`
                    text-sm font-medium
                    ${isActive ? 'text-primary-700 dark:text-primary-300' : ''}
                    ${isError ? 'text-red-700 dark:text-red-300' : ''}
                    ${isCompleted ? 'text-gray-500 dark:text-gray-400' : ''}
                    ${isPending ? 'text-gray-400 dark:text-gray-500' : ''}
                  `}
                >
                  {stage.name}
                </span>
                {stage.detail && (
                  <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">
                    {stage.detail}
                  </span>
                )}
                {stage.error && (
                  <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">
                    {stage.error}
                  </p>
                )}
              </div>

              {/* Step counter */}
              <div className="shrink-0">
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {index + 1}/{stages.length}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Help text */}
      {!hasError && (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center max-w-sm">
          {helpText}
        </p>
      )}

      {/* Error retry hint */}
      {hasError && (
        <p className="text-sm text-red-500 dark:text-red-400 text-center max-w-sm">
          An error occurred. Please try refreshing the page.
        </p>
      )}
    </div>
  );
}

/**
 * A simpler loading screen for when we don't have detailed stage info,
 * but want to show elapsed time and a message.
 */
export function SimpleLoadingScreen({
  title = 'Loading...',
  subtitle,
  showElapsedTime = true,
}: {
  title?: string;
  subtitle?: string;
  showElapsedTime?: boolean;
}) {
  const [elapsedTime, setElapsedTime] = useState(0);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!showElapsedTime) return;

    // Set here rather than as the ref's initial value: the clock belongs to the mounted
    // component, and a render can happen without one following it.
    startTimeRef.current = Date.now();
    const interval = setInterval(() => {
      setElapsedTime(Date.now() - (startTimeRef.current ?? Date.now()));
    }, 100);

    return () => clearInterval(interval);
  }, [showElapsedTime]);

  return (
    <div className="flex flex-col items-center justify-start min-h-[calc(100vh+8rem)] p-8 pt-[12vh]">
      <Loader2 className="w-10 h-10 text-primary-500 animate-spin mb-4" />
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        {title}
      </h2>
      {subtitle && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          {subtitle}
        </p>
      )}
      {showElapsedTime && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Elapsed: {formatElapsedTime(elapsedTime)}
        </p>
      )}
    </div>
  );
}

