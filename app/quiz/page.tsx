import type { Metadata } from 'next';
import Link from '@/components/Link';
import { QuizGame } from '@/components/quiz';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

export const metadata: Metadata = generatePageMetadata({
  title: 'Kana Quiz: Practice Hiragana & Katakana',
  description: 'Practice hiragana and katakana recognition with our interactive quiz. Build reading speed for Japanese visual novels with instant feedback and streak tracking.',
  path: '/quiz/',
});

// JSON-LD for educational quiz
const quizJsonLd = [
  {
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
    url: `${SITE_URL}/quiz/`,
  },
  generateBreadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Kana Quiz', path: '/quiz/' },
  ]),
];

export default function QuizPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(quizJsonLd) }}
      />
      <div className="min-h-[80vh] px-4 py-12">
        <div className="mx-auto max-w-5xl">
          {/* Header */}
          <div className="mb-10 text-center">
            <h1 className="sec-title">Kana Quiz</h1>
            <p className="sec-sub mx-auto max-w-xl">
              Practice hiragana and katakana recognition. Type the romaji reading for each character.
            </p>
          </div>

          {/* Quiz Game */}
          <QuizGame />

          {/* Tips */}
          <div className="panel mt-8 p-5 pt-7">
            <h2 className="nameplate dg-plate">Tips</h2>
            <ul className="space-y-2 text-sm text-[color:var(--nezu)]">
              <li>
                <strong className="font-medium text-[color:var(--ink)]">Multiple romanizations:</strong> Both &quot;shi&quot; and &quot;si&quot; are accepted for し, &quot;chi&quot; and &quot;ti&quot; for ち, etc.
              </li>
              <li>
                <strong className="font-medium text-[color:var(--ink)]">Press Enter:</strong> Submit your answer quickly by pressing Enter.
              </li>
              <li>
                <strong className="font-medium text-[color:var(--ink)]">Build streaks:</strong> Consecutive correct answers increase your streak counter!
              </li>
              <li>
                <strong className="font-medium text-[color:var(--ink)]">Start simple:</strong> Begin with basic characters, then add dakuten and combinations as you improve.
              </li>
            </ul>
          </div>

          {/* Level 1 link */}
          <p className="mt-4 rounded-xs border border-[color:var(--rule)] p-5 text-sm text-[color:var(--text-secondary)]">
            Looking to join the Discord server? Study the{' '}
            <Link href="/level1/" className="text-[color:var(--ai)] underline underline-offset-2">
              100 most common Japanese words
            </Link>{' '}
            for the VNCR Level 1 quiz.
          </p>
        </div>
      </div>
    </>
  );
}
