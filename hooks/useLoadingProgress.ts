'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { LoadingStageDefinition } from '@/lib/loading-stages';

export type LoadingStageStatus = 'pending' | 'active' | 'completed' | 'error';

export interface LoadingStage extends LoadingStageDefinition {
  status: LoadingStageStatus;
  detail?: string;
  error?: string;
}

export interface UseLoadingProgressOptions {
  /** Auto-start the first stage on mount */
  autoStart?: boolean;
  /** Callback when all stages complete */
  onComplete?: () => void;
  /** Callback on error */
  onError?: (error: string, stageId: string) => void;
}

export interface UseLoadingProgressReturn {
  /** Current stage index (0-based) */
  currentStage: number;
  /** All stages with their current status */
  stages: LoadingStage[];
  /** Elapsed time in milliseconds */
  elapsedTime: number;
  /** Whether loading is in progress */
  isLoading: boolean;
  /** Whether loading completed successfully */
  isComplete: boolean;
  /** Whether an error occurred */
  hasError: boolean;
  /** Start or restart the loading process */
  start: () => void;
  /** Advance to the next stage, optionally with a detail message */
  advance: (detail?: string) => void;
  /** Set a specific stage as active by ID */
  setStage: (stageId: string, detail?: string) => void;
  /** Mark current stage as error */
  setError: (error: string) => void;
  /** Mark all stages as complete */
  complete: () => void;
  /** Reset to initial state */
  reset: () => void;
  /** Update detail for current stage */
  updateDetail: (detail: string) => void;
}

export function useLoadingProgress(
  stageDefinitions: LoadingStageDefinition[],
  options: UseLoadingProgressOptions = {}
): UseLoadingProgressReturn {
  const { autoStart = false, onComplete, onError } = options;

  const [currentStage, setCurrentStage] = useState(-1);
  const [stageDetails, setStageDetails] = useState<Record<string, string>>({});
  const [stageErrors, setStageErrors] = useState<Record<string, string>>({});
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [hasError, setHasError] = useState(false);

  const startTimeRef = useRef<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Build stages array with current status
  const stages: LoadingStage[] = stageDefinitions.map((def, index) => {
    let status: LoadingStageStatus;
    if (hasError && stageErrors[def.id]) {
      status = 'error';
    } else if (isComplete || index < currentStage) {
      status = 'completed';
    } else if (index === currentStage) {
      status = 'active';
    } else {
      status = 'pending';
    }

    return {
      ...def,
      status,
      detail: stageDetails[def.id],
      error: stageErrors[def.id],
    };
  });

  // Start/stop elapsed time timer
  useEffect(() => {
    if (isLoading && !isComplete && !hasError) {
      startTimeRef.current = startTimeRef.current ?? Date.now();
      timerRef.current = setInterval(() => {
        if (startTimeRef.current) {
          setElapsedTime(Date.now() - startTimeRef.current);
        }
      }, 100);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isLoading, isComplete, hasError]);

  // Auto-start if enabled
  useEffect(() => {
    if (autoStart && !isLoading && currentStage === -1) {
      start();
    }
  }, [autoStart]);

  const start = useCallback(() => {
    setCurrentStage(0);
    setStageDetails({});
    setStageErrors({});
    setElapsedTime(0);
    setIsLoading(true);
    setIsComplete(false);
    setHasError(false);
    startTimeRef.current = Date.now();
  }, []);

  const advance = useCallback((detail?: string) => {
    setCurrentStage((prev) => {
      const next = prev + 1;
      if (next >= stageDefinitions.length) {
        // All stages complete
        setIsComplete(true);
        setIsLoading(false);
        onComplete?.();
        return prev;
      }
      if (detail) {
        setStageDetails((d) => ({ ...d, [stageDefinitions[next].id]: detail }));
      }
      return next;
    });
  }, [stageDefinitions, onComplete]);

  const setStage = useCallback((stageId: string, detail?: string) => {
    const index = stageDefinitions.findIndex((s) => s.id === stageId);
    if (index >= 0) {
      setCurrentStage(index);
      if (detail) {
        setStageDetails((d) => ({ ...d, [stageId]: detail }));
      }
    }
  }, [stageDefinitions]);

  const setErrorState = useCallback((error: string) => {
    const currentId = stageDefinitions[currentStage]?.id;
    if (currentId) {
      setStageErrors((e) => ({ ...e, [currentId]: error }));
      setHasError(true);
      setIsLoading(false);
      onError?.(error, currentId);
    }
  }, [currentStage, stageDefinitions, onError]);

  const complete = useCallback(() => {
    setCurrentStage(stageDefinitions.length);
    setIsComplete(true);
    setIsLoading(false);
    onComplete?.();
  }, [stageDefinitions.length, onComplete]);

  const reset = useCallback(() => {
    setCurrentStage(-1);
    setStageDetails({});
    setStageErrors({});
    setElapsedTime(0);
    setIsLoading(false);
    setIsComplete(false);
    setHasError(false);
    startTimeRef.current = null;
  }, []);

  const updateDetail = useCallback((detail: string) => {
    const currentId = stageDefinitions[currentStage]?.id;
    if (currentId) {
      setStageDetails((d) => ({ ...d, [currentId]: detail }));
    }
  }, [currentStage, stageDefinitions]);

  return {
    currentStage,
    stages,
    elapsedTime,
    isLoading,
    isComplete,
    hasError,
    start,
    advance,
    setStage,
    setError: setErrorState,
    complete,
    reset,
    updateDetail,
  };
}
