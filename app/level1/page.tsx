import type { Metadata } from 'next';
import Link from '@/components/Link';
import { BookOpen } from 'lucide-react';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';
import { level1Words } from '@/lib/level1-words';

export const metadata: Metadata = generatePageMetadata({
  title: 'VNCR Level 1: 100 Most Common Japanese Words',
  description: 'The 100 most common Japanese words you need to know to pass the VNCR Level 1 quiz. Study kanji, readings, and meanings to join the VN Club Discord server.',
  path: '/level1/',
});

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    name: 'VNCR Level 1: 100 Most Common Japanese Words',
    description: 'The 100 most common Japanese words required to pass the VNCR Level 1 vocabulary quiz.',
    learningResourceType: 'Vocabulary List',
    educationalLevel: 'Beginner',
    url: `${SITE_URL}/level1/`,
    about: { '@type': 'Language', name: 'Japanese' },
  },
  generateBreadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Level 1', path: '/level1/' },
  ]),
];

export default function Level1Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <div className="min-h-[80vh] px-4 py-12">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-xs border border-[color:var(--rule)] mb-4">
              <BookOpen className="w-10 h-10 text-[color:var(--ai)]" aria-hidden="true" />
            </div>
            <h1 className="font-display text-4xl font-bold text-[color:var(--ink)] mb-3">
              Level 1 Vocabulary
            </h1>
            <p className="text-lg text-[color:var(--nezu)] max-w-xl mx-auto">
              The {level1Words.length} most common Japanese words. Know these to pass the VNCR Level 1 quiz and <Link href="/join/" className="text-[color:var(--ai)] hover:underline">join the server</Link>.
            </p>
            <p className="text-sm text-[color:var(--nezu)] mt-3">
              New to Japanese? Check out our{' '}
              <Link href="/guide/" className="text-[color:var(--ai)] hover:underline">main guide</Link>
              {' '}to get started, or practice your kana with the{' '}
              <Link href="/quiz/" className="text-[color:var(--ai)] hover:underline">kana quiz</Link>.
            </p>
          </div>

          {/* Word list */}
          <div className="rounded-xs border border-[color:var(--rule)] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[color:var(--rule)]">
                  <th className="text-left py-3 px-2 sm:px-4 font-mono text-xs font-medium text-[color:var(--nezu)] uppercase tracking-wider w-8 sm:w-10">#</th>
                  <th className="text-left py-3 px-2 sm:px-4 font-mono text-xs font-medium text-[color:var(--nezu)] uppercase tracking-wider whitespace-nowrap">Word</th>
                  <th className="text-left py-3 px-2 sm:px-4 font-mono text-xs font-medium text-[color:var(--nezu)] uppercase tracking-wider whitespace-nowrap">Reading</th>
                  <th className="text-left py-3 px-2 sm:px-4 font-mono text-xs font-medium text-[color:var(--nezu)] uppercase tracking-wider">Meaning</th>
                </tr>
              </thead>
              <tbody>
                {level1Words.map((word, idx) => (
                  <tr
                    key={idx}
                    className="border-b border-[color:var(--rule)] last:border-b-0 hover:bg-[color:var(--surface-inset)] transition-colors"
                  >
                    <td className="py-3 px-2 sm:px-4 font-mono text-sm text-[color:var(--text-faint)] tabular-nums">{idx + 1}</td>
                    <td className="py-3 px-2 sm:px-4 font-jp text-base sm:text-lg font-medium text-[color:var(--ink)] whitespace-nowrap">{word.kanji}</td>
                    <td className="py-3 px-2 sm:px-4 font-jp text-sm text-[color:var(--nezu)] whitespace-nowrap">{word.reading}</td>
                    <td className="py-3 px-2 sm:px-4 text-sm text-[color:var(--text-secondary)]">{word.english}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
