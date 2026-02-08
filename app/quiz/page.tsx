import type { Metadata } from 'next';
import { Languages } from 'lucide-react';
import { QuizGame } from '@/components/quiz';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify } from '@/lib/metadata-utils';

export const metadata: Metadata = generatePageMetadata({
  title: 'Kana Quiz: Practice Hiragana & Katakana',
  description: 'Practice hiragana and katakana recognition with our interactive quiz. Build reading speed for Japanese visual novels with instant feedback and streak tracking.',
  path: '/quiz',
});

// JSON-LD for educational quiz
const quizJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Quiz',
  name: 'Kana Quiz',
  description: 'Practice hiragana and katakana recognition for Japanese learners',
  educationalLevel: 'Beginner',
  learningResourceType: 'Quiz',
  about: {
    '@type': 'Thing',
    name: 'Japanese Writing System',
  },
  url: `${SITE_URL}/quiz`,
};

export default function QuizPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(quizJsonLd) }}
      />
      <div className="min-h-[80vh] px-4 py-12">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 mb-4">
            <Languages className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-3">
            Kana Quiz
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-xl mx-auto">
            Practice hiragana and katakana recognition. Type the romaji reading for each character.
          </p>
        </div>

        {/* Quiz Game */}
        <QuizGame />

        {/* Tips */}
        <div className="mt-8 p-5 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Tips</h3>
          <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
            <li>
              <strong className="text-gray-900 dark:text-white">Multiple romanizations:</strong> Both &quot;shi&quot; and &quot;si&quot; are accepted for し, &quot;chi&quot; and &quot;ti&quot; for ち, etc.
            </li>
            <li>
              <strong className="text-gray-900 dark:text-white">Press Enter:</strong> Submit your answer quickly by pressing Enter.
            </li>
            <li>
              <strong className="text-gray-900 dark:text-white">Build streaks:</strong> Consecutive correct answers increase your streak counter!
            </li>
            <li>
              <strong className="text-gray-900 dark:text-white">Start simple:</strong> Begin with basic characters, then add dakuten and combinations as you improve.
            </li>
          </ul>
        </div>
      </div>
    </div>
    </>
  );
}
