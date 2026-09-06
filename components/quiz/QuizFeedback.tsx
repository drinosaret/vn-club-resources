'use client';

interface QuizFeedbackProps {
  isCorrect: boolean | null;
  correctAnswer?: string;
  show: boolean;
}

export function QuizFeedback({ isCorrect, correctAnswer, show }: QuizFeedbackProps) {
  if (!show || isCorrect === null) return null;

  return (
    <div className={`quiz-veil ${isCorrect ? 'quiz-veil--yes' : 'quiz-veil--no'}`}>
      <div className="text-center">
        {/* The mark, not an icon: the verdict has to read at a glance and survive being
            seen without colour. */}
        <span className="quiz-mark" aria-hidden>
          {isCorrect ? '○' : '×'}
        </span>
        <span className="quiz-verdict">{isCorrect ? 'Correct' : 'Incorrect'}</span>
        {!isCorrect && correctAnswer && <span className="quiz-answer">{correctAnswer}</span>}
      </div>
    </div>
  );
}
