'use client';

import { Check, X } from 'lucide-react';

interface QuizFeedbackProps {
  isCorrect: boolean | null;
  correctAnswer?: string;
  show: boolean;
}

export function QuizFeedback({ isCorrect, correctAnswer, show }: QuizFeedbackProps) {
  if (!show || isCorrect === null) return null;

  return (
    <div
      className={`
        absolute inset-0 flex items-center justify-center rounded-xl pointer-events-none
        transition-opacity duration-300
        ${show ? 'opacity-100' : 'opacity-0'}
        ${isCorrect
          ? 'bg-emerald-500/20 dark:bg-emerald-500/30'
          : 'bg-red-500/20 dark:bg-red-500/30'
        }
      `}
    >
      <div className="text-center">
        <div
          className={`
            inline-flex items-center justify-center w-16 h-16 rounded-full mb-2
            ${isCorrect
              ? 'bg-emerald-100 dark:bg-emerald-900/50'
              : 'bg-red-100 dark:bg-red-900/50'
            }
          `}
        >
          {isCorrect ? (
            <Check className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <X className="w-8 h-8 text-red-600 dark:text-red-400" />
          )}
        </div>
        <p
          className={`text-lg font-semibold ${
            isCorrect
              ? 'text-emerald-700 dark:text-emerald-300'
              : 'text-red-700 dark:text-red-300'
          }`}
        >
          {isCorrect ? 'Correct!' : 'Incorrect'}
        </p>
        {!isCorrect && correctAnswer && (
          <p className="text-xl text-red-600 dark:text-red-400 mt-1">
            Answer: <span className="font-bold text-3xl">{correctAnswer}</span>
          </p>
        )}
      </div>
    </div>
  );
}
