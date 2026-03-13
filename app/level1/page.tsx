import type { Metadata } from 'next';
import Link from 'next/link';
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
    '@type': 'EducationalResource',
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
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-blue-100 dark:bg-blue-900/30 mb-4">
              <BookOpen className="w-10 h-10 text-blue-600 dark:text-blue-400" />
            </div>
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-3">
              Level 1 Vocabulary
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400 max-w-xl mx-auto">
              The {level1Words.length} most common Japanese words. Know these to pass the VNCR Level 1 quiz and <Link href="/join/" className="text-primary-600 dark:text-primary-400 hover:underline">join the server</Link>.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-500 mt-3">
              New to Japanese? Check out our{' '}
              <Link href="/guide/" className="text-primary-600 dark:text-primary-400 hover:underline">main guide</Link>
              {' '}to get started, or practice your kana with the{' '}
              <Link href="/quiz/" className="text-primary-600 dark:text-primary-400 hover:underline">kana quiz</Link>.
            </p>
          </div>

          {/* Word list */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-3 px-2 sm:px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-8 sm:w-10">#</th>
                  <th className="text-left py-3 px-2 sm:px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Word</th>
                  <th className="text-left py-3 px-2 sm:px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Reading</th>
                  <th className="text-left py-3 px-2 sm:px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Meaning</th>
                </tr>
              </thead>
              <tbody>
                {level1Words.map((word, idx) => (
                  <tr
                    key={idx}
                    className="border-b border-gray-100 dark:border-gray-800 last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
                  >
                    <td className="py-3 px-2 sm:px-4 text-sm text-gray-400 dark:text-gray-500 tabular-nums">{idx + 1}</td>
                    <td className="py-3 px-2 sm:px-4 text-base sm:text-lg font-medium text-gray-900 dark:text-white whitespace-nowrap">{word.kanji}</td>
                    <td className="py-3 px-2 sm:px-4 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">{word.reading}</td>
                    <td className="py-3 px-2 sm:px-4 text-sm text-gray-600 dark:text-gray-300">{word.english}</td>
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
