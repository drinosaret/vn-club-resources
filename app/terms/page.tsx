import type { Metadata } from 'next';
import { generatePageMetadata, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

export const metadata: Metadata = generatePageMetadata({
  title: 'Terms of Use',
  description:
    'VN Club terms of use. How shared layouts work, content ownership, acceptable use, and liability for this free community site.',
  path: '/terms/',
});

const jsonLd = [
  generateBreadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Terms of Use', path: '/terms/' },
  ]),
];

export default function TermsPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Terms of Use
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
          Last updated: April 9, 2026
        </p>

        <div className="prose dark:prose-invert max-w-none prose-headings:text-xl prose-headings:font-semibold prose-headings:mt-8 prose-headings:mb-3 prose-p:text-gray-600 dark:prose-p:text-gray-300 prose-p:leading-relaxed prose-li:text-gray-600 dark:prose-li:text-gray-300">
          <p>
            VN Club (vnclub.org) is a free, open source site for learning Japanese through visual
            novels. By using it, you agree to these terms.
          </p>

          <h2>Content on the site</h2>
          <p>
            Visual novel data (titles, descriptions, tags, cover images, character info) comes from{' '}
            <a href="https://vndb.org" target="_blank" rel="noopener noreferrer">
              VNDB
            </a>
            {' '}and belongs to its respective creators and rights holders. Language difficulty
            data, reading statistics, vocabulary data, and example sentences come from{' '}
            <a href="https://jiten.moe" target="_blank" rel="noopener noreferrer">
              Jiten.moe
            </a>
            . Kanji details and compound words come from{' '}
            <a href="https://kanjiapi.dev" target="_blank" rel="noopener noreferrer">
              KanjiAPI
            </a>
            . Dictionary data comes from{' '}
            <a href="https://jisho.org" target="_blank" rel="noopener noreferrer">
              Jisho.org
            </a>
            {' '}and bilingual sentences from{' '}
            <a href="https://tatoeba.org" target="_blank" rel="noopener noreferrer">
              Tatoeba
            </a>
            . We display third-party data under their respective usage terms and don&apos;t claim
            ownership of any of it.
          </p>
          <p>
            The site itself, including guides and original writing, is a community project licensed
            under the{' '}
            <a
              href="https://www.gnu.org/licenses/agpl-3.0.en.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              GNU Affero General Public License (AGPL)
            </a>
            . Source code is available on{' '}
            <a
              href="https://github.com/drinosaret/vn-club-resources"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            .
          </p>

          <h2>Mature content</h2>
          <p>
            Some visual novel cover images on this site may contain mature or suggestive content.
            These images are blurred by default and require a deliberate click to reveal. Browse at
            your own discretion.
          </p>

          <h2>Privacy</h2>
          <p>
            Your use of the site is also subject to our{' '}
            <a href="/privacy/">Privacy Policy</a>.
          </p>

          <h2>Shared layouts</h2>
          <p>
            When you share a tier list or 3x3, we store it and make it available at its
            public link so others can view it. That&apos;s all we do with it. You keep
            ownership of whatever is yours in it.
          </p>
          <p>
            We can remove shared layouts at any time, for any reason, and they may be deleted during
            maintenance without notice. This isn&apos;t permanent storage. Don&apos;t put anything
            offensive or illegal in your labels or custom text.
          </p>

          <h2>Acceptable use</h2>
          <p>
            Don&apos;t scrape the site aggressively, spam the sharing system, use the site for
            anything illegal, or try to break things. We can block your access if we think
            you&apos;re misusing the site.
          </p>

          <h2>Copyright</h2>
          <p>
            If you believe something on VN Club infringes your copyright, contact us at{' '}
            <a href="mailto:contact@vnclub.org">contact@vnclub.org</a> with what&apos;s being
            infringed and where it is on the site.
          </p>

          <h2>Contributions</h2>
          <p>
            Contributions to VN Club (via pull requests, issues, or other means) are subject to the
            same{' '}
            <a
              href="https://www.gnu.org/licenses/agpl-3.0.en.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              AGPL license
            </a>{' '}
            as the rest of the project.
          </p>

          <h2>Warranty disclaimer</h2>
          <p>
            The site is provided &quot;as is&quot; and &quot;as available,&quot; without warranties
            of any kind, express or implied, including merchantability, fitness for a particular
            purpose, and non-infringement. VN data may be outdated. Features may break. This is a
            hobby project.
          </p>

          <h2>Limitation of liability</h2>
          <p>
            VN Club and its contributors are not liable for any indirect, incidental, special, or
            consequential damages from your use of the site. Total liability for any claim is $0.
            The service is free.
          </p>

          <h2>Governing law</h2>
          <p>These terms are governed by the laws of the Netherlands.</p>

          <h2>Changes</h2>
          <p>
            If these terms change, the date at the top updates. Continued use means you accept the
            current version.
          </p>
        </div>
      </div>
    </>
  );
}
