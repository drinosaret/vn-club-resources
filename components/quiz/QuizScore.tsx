'use client';

import { Flame, Target, TrendingUp } from 'lucide-react';

interface QuizScoreProps {
  correct: number;
  total: number;
  streak: number;
}

export function QuizScore({ correct, total, streak }: QuizScoreProps) {
  const percentage = total > 0 ? Math.round((correct / total) * 100) : 0;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Score</h3>

      <div className="grid grid-cols-3 gap-4">
        {/* Correct / Total */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 mb-2">
            <Target className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {correct}<span className="text-gray-400 dark:text-gray-500">/{total}</span>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Correct</div>
        </div>

        {/* Percentage */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 mb-2">
            <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {percentage}%
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Accuracy</div>
        </div>

        {/* Streak */}
        <div className="text-center">
          <div className={`inline-flex items-center justify-center w-10 h-10 rounded-full mb-2 ${
            streak >= 5
              ? 'bg-orange-100 dark:bg-orange-900/30'
              : 'bg-gray-100 dark:bg-gray-700'
          }`}>
            <Flame className={`w-5 h-5 ${
              streak >= 5
                ? 'text-orange-500 dark:text-orange-400'
                : 'text-gray-400 dark:text-gray-500'
            }`} />
          </div>
          <div className={`text-2xl font-bold ${
            streak >= 5
              ? 'text-orange-500 dark:text-orange-400'
              : 'text-gray-900 dark:text-white'
          }`}>
            {streak}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Streak</div>
        </div>
      </div>
    </div>
  );
}
