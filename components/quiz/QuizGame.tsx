'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  type KanaCharacter,
  type QuizSettings as QuizSettingsType,
  defaultQuizSettings,
  getQuizPool,
  getRandomKana,
  isCorrectAnswer,
} from '@/lib/kana-data';
import { QuizSettings } from './QuizSettings';
import { QuizScore } from './QuizScore';
import { QuizFeedback } from './QuizFeedback';
import { KanaChart } from './KanaChart';

export function QuizGame() {
  const [settings, setSettings] = useState<QuizSettingsType>(defaultQuizSettings);
  const [currentKana, setCurrentKana] = useState<KanaCharacter | null>(null);
  const [userAnswer, setUserAnswer] = useState('');
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [streak, setStreak] = useState(0);
  const [feedback, setFeedback] = useState<{ show: boolean; isCorrect: boolean | null; correctAnswer?: string }>({
    show: false,
    isCorrect: null,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const autoAdvanceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSubmittingRef = useRef(false); // Prevent double-submit race condition

  // Get next question
  const nextQuestion = useCallback(() => {
    // Clear any pending auto-advance timeout to prevent memory leaks
    if (autoAdvanceTimeoutRef.current) {
      clearTimeout(autoAdvanceTimeoutRef.current);
      autoAdvanceTimeoutRef.current = null;
    }
    isSubmittingRef.current = false; // Reset submission lock

    const pool = getQuizPool(settings);
    const kana = getRandomKana(pool, settings);
    setCurrentKana(kana);
    setUserAnswer('');
    setFeedback({ show: false, isCorrect: null });
  }, [settings]);

  // Initialize on mount and when settings change
  useEffect(() => {
    nextQuestion();
  }, [nextQuestion]);

  // Cleanup auto-advance timeout on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceTimeoutRef.current) {
        clearTimeout(autoAdvanceTimeoutRef.current);
        autoAdvanceTimeoutRef.current = null;
      }
    };
  }, []); // Empty deps - only cleanup on unmount (nextQuestion handles settings changes)

  // Focus input on initial mount (delayed to avoid mobile keyboard issues)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (inputRef.current && document.activeElement !== inputRef.current) {
        inputRef.current.focus();
      }
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Focus input when feedback is dismissed (input becomes enabled again)
  useEffect(() => {
    if (!feedback.show && inputRef.current) {
      // Only focus if not already focused, to prevent keyboard flickering on mobile
      if (document.activeElement !== inputRef.current) {
        inputRef.current.focus();
      }
    }
  }, [feedback.show]);

  // Handle answer submission
  const handleSubmit = useCallback(() => {
    // Lock submission immediately to prevent race condition from rapid double-clicks
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    if (!currentKana || !userAnswer.trim() || feedback.show) {
      isSubmittingRef.current = false;
      return;
    }

    const correct = isCorrectAnswer(currentKana, userAnswer);

    setScore(prev => ({
      correct: prev.correct + (correct ? 1 : 0),
      total: prev.total + 1,
    }));

    if (correct) {
      setStreak(prev => prev + 1);
    } else {
      setStreak(0);
    }

    setFeedback({
      show: true,
      isCorrect: correct,
      correctAnswer: currentKana.romaji,
    });

    // Clear any pending auto-advance timeout
    if (autoAdvanceTimeoutRef.current) {
      clearTimeout(autoAdvanceTimeoutRef.current);
      autoAdvanceTimeoutRef.current = null;
    }

    // Auto-advance after delay
    autoAdvanceTimeoutRef.current = setTimeout(() => {
      nextQuestion();
    }, correct ? 400 : 1000);
  }, [currentKana, userAnswer, feedback.show, nextQuestion]);

  // Handle key press
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && feedback.show) {
      // Clear any pending auto-advance timeout
      if (autoAdvanceTimeoutRef.current) {
        clearTimeout(autoAdvanceTimeoutRef.current);
        autoAdvanceTimeoutRef.current = null;
      }
      nextQuestion();
      return;
    }
    if (e.key === 'Enter') {
      handleSubmit();
    }
  }, [handleSubmit, feedback.show, nextQuestion]);

  // Reset quiz
  const handleReset = useCallback(() => {
    setScore({ correct: 0, total: 0 });
    setStreak(0);
    nextQuestion();
  }, [nextQuestion]);

  const pool = useMemo(() => getQuizPool(settings), [settings]);
  const hasValidPool = pool.length > 0;

  return (
    <div className="space-y-6">
      {/* Main Quiz Area */}
      <div className="grid md:grid-cols-3 gap-6">
        {/* Settings Panel */}
        <div className="md:col-span-1 space-y-4">
          <QuizSettings settings={settings} onSettingsChange={setSettings} />
          <QuizScore correct={score.correct} total={score.total} streak={streak} />

          {/* Reset Button */}
          <button
            onClick={handleReset}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Reset Score
          </button>
        </div>

        {/* Quiz Display */}
        <div className="md:col-span-2">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 relative overflow-hidden min-h-[320px] flex flex-col items-center justify-center">
            {hasValidPool && currentKana ? (
              <>
                {/* Kana Display */}
                <div className="text-center mb-8">
                  <div className="text-8xl sm:text-9xl font-medium text-gray-900 dark:text-white mb-2 select-none">
                    {currentKana.kana}
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Type the romaji reading
                  </p>
                </div>

                {/* Answer Input */}
                <div className="w-full max-w-xs">
                  <input
                    ref={inputRef}
                    type="text"
                    value={userAnswer}
                    onChange={(e) => setUserAnswer(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={feedback.show}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="Type romaji..."
                    aria-label="Type the romaji reading for the displayed kana character"
                    className="w-full text-center text-2xl px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <button
                    onClick={handleSubmit}
                    disabled={!userAnswer.trim() || feedback.show}
                    className="w-full mt-3 px-4 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Check Answer
                  </button>
                </div>

                {/* Feedback Overlay */}
                <QuizFeedback
                  isCorrect={feedback.isCorrect}
                  correctAnswer={feedback.correctAnswer}
                  show={feedback.show}
                />
              </>
            ) : (
              <div className="text-center text-gray-500 dark:text-gray-400">
                <p className="text-lg mb-2">No kana selected</p>
                <p className="text-sm">
                  Enable at least one kana type and character set in the settings
                </p>
              </div>
            )}
          </div>

          {/* Pool info */}
          {hasValidPool && (
            <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-3">
              {pool.length} characters in current quiz pool
            </p>
          )}
        </div>
      </div>

      {/* Kana Chart with Row Selection at bottom */}
      <KanaChart settings={settings} onSettingsChange={setSettings} />
    </div>
  );
}
