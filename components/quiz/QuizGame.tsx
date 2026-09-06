'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
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

  // Focus input when feedback is dismissed (next question appears)
  useEffect(() => {
    if (!feedback.show && inputRef.current) {
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
  }, [feedback.show, nextQuestion]);

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
      <div className="grid gap-6 md:grid-cols-3">
        {/* Settings Panel */}
        <div className="space-y-4 md:col-span-1">
          <QuizSettings settings={settings} onSettingsChange={setSettings} />
          <QuizScore correct={score.correct} total={score.total} streak={streak} />

          {/* Reset Button */}
          <button onClick={handleReset} className="toy-btn toy-btn--wide">
            Reset Score
          </button>
        </div>

        {/* Quiz Display */}
        <div className="md:col-span-2">
          <div className="panel quiz-stage">
            {hasValidPool && currentKana ? (
              <>
                {/* Kana Display */}
                <div className="mb-8 text-center">
                  <span className="quiz-kana" lang="ja">
                    {currentKana.kana}
                  </span>
                  <span className="fig-label mt-3">Type the romaji reading</span>
                </div>

                {/* Answer Input */}
                <form
                  className="w-full max-w-xs"
                  onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
                >
                  <input
                    ref={inputRef}
                    type="text"
                    value={userAnswer}
                    onChange={(e) => { if (!feedback.show) setUserAnswer(e.target.value); }}
                    onKeyDown={handleKeyDown}
                    enterKeyHint="go"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="Type romaji..."
                    aria-label="Type the romaji reading for the displayed kana character"
                    className={`quiz-input ${feedback.show ? 'opacity-50' : ''}`}
                  />
                  <button
                    type="submit"
                    disabled={!userAnswer.trim() || feedback.show}
                    onMouseDown={(e) => e.preventDefault()}
                    className="toy-btn toy-btn--go toy-btn--wide mt-3"
                  >
                    Check Answer
                  </button>
                </form>

                {/* Feedback Overlay */}
                <QuizFeedback
                  isCorrect={feedback.isCorrect}
                  correctAnswer={feedback.correctAnswer}
                  show={feedback.show}
                />
              </>
            ) : hasValidPool ? (
              // The first character is drawn after mount, so the stage is empty in the
              // server-rendered markup even when the pool is full. A placeholder holds the
              // layout rather than asking for settings that are already correct.
              <div aria-hidden className="flex w-full flex-col items-center">
                <div className="image-placeholder h-24 w-28 rounded-xs" />
                <div className="image-placeholder mt-3 h-3 w-40 rounded-xs" />
                <div className="image-placeholder mt-8 h-11 w-full max-w-xs rounded-xs" />
                <div className="image-placeholder mt-3 h-10 w-full max-w-xs rounded-xs" />
              </div>
            ) : (
              <div className="text-center">
                <p className="font-display text-lg font-bold text-[color:var(--ink)]">
                  No kana selected
                </p>
                <p className="mt-2 text-sm text-[color:var(--nezu)]">
                  Enable at least one kana type and character set in the settings
                </p>
              </div>
            )}
          </div>

          {/* Pool info */}
          {hasValidPool && (
            <p className="mt-3 text-center font-mono text-xs tabular-nums text-[color:var(--nezu)]">
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
