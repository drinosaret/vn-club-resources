'use client';

interface QuizScoreProps {
  correct: number;
  total: number;
  streak: number;
}

// Above this a streak is worth remarking on rather than merely counting.
const RUN = 5;

export function QuizScore({ correct, total, streak }: QuizScoreProps) {
  const percentage = total > 0 ? Math.round((correct / total) * 100) : 0;

  return (
    <div className="panel p-5 pt-7">
      <h2 className="nameplate dg-plate">Score</h2>

      <div className="quiz-figures">
        <div>
          <span className="fig-label">Correct</span>
          <span className="fig-value">
            {correct}
            <span className="text-[color:var(--text-faint)]">/{total}</span>
          </span>
        </div>

        <div>
          <span className="fig-label">Accuracy</span>
          <span className="fig-value">{percentage}%</span>
        </div>

        <div>
          <span className="fig-label">Streak</span>
          <span className="fig-value">
            {streak >= RUN && (
              <span className="fig-arrow" aria-hidden>
                ▲
              </span>
            )}
            {streak}
          </span>
        </div>
      </div>
    </div>
  );
}
