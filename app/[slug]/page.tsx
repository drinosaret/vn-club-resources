import { getContentBySlug, getContentBySlugAsync, getAllContent, extractFirstImage } from '@/lib/mdx';
import { notFound } from 'next/navigation';
import { TableOfContents } from '@/components/TableOfContents';
import { PageNavigation } from '@/components/PageNavigation';
import { PrevNextNavigation } from '@/components/PrevNextNavigation';
import { CalendarPlus, History, Pencil } from 'lucide-react';
import { ResourceMarkdownRenderer } from '@/components/ResourceMarkdownRenderer';
import { RelativeTime } from '@/components/RelativeTime';
import type { Metadata } from 'next';
import { safeJsonLdStringify } from '@/lib/metadata-utils';

export const dynamic = 'force-static';
export const dynamicParams = false;

export async function generateStaticParams() {
  const guides = getAllContent('guides');
  return guides.map((guide) => ({
    slug: guide.slug,
  }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const guide = getContentBySlug('guides', slug);

  if (!guide) {
    return {
      title: 'Guide Not Found',
    };
  }

  const description = guide.description || `Learn how to ${guide.title.toLowerCase()} with our comprehensive guide.`;
  const url = `https://vnclub.org/${slug}`;
  const heroImage = extractFirstImage(guide.content) || '/assets/hikaru-icon2.webp';

  return {
    title: guide.title,
    description,
    openGraph: {
      type: 'article',
      title: guide.title,
      description,
      url,
      siteName: 'VN Club',
      publishedTime: guide.date,
      modifiedTime: guide.updated || guide.date,
      authors: ['VN Club Resurrection'],
      images: [
        {
          url: heroImage,
          alt: guide.title,
        },
      ],
    },
    twitter: {
      card: 'summary',
      title: guide.title,
      description,
      images: [heroImage],
    },
    alternates: {
      canonical: url,
    },
  };
}

// FAQ schema for the main guide page (targets featured snippets)
const mainGuideFAQ = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'Can you learn Japanese from visual novels?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes! Visual novels are one of the best media for learning Japanese. They provide extensive reading practice with thousands of lines of native Japanese text, full voice acting for listening comprehension, and visual context to help understand situations. Unlike textbooks, VNs are real Japanese media written by native speakers.',
      },
    },
    {
      '@type': 'Question',
      name: 'What tools do I need to read Japanese visual novels?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'You need three essential tools: a text hooker (Textractor or Agent) to extract text from the game, a dictionary tool (JL or Yomitan) for looking up words, and Anki for saving and reviewing new vocabulary. Our guides walk you through setting up each tool step by step.',
      },
    },
    {
      '@type': 'Question',
      name: 'What is the best visual novel for beginners learning Japanese?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Good beginner visual novels include titles with simple vocabulary and full voice acting. Popular choices include slice-of-life VNs with everyday Japanese. Check our Browse page to filter VNs by difficulty and find one that matches your level.',
      },
    },
    {
      '@type': 'Question',
      name: 'How long does it take to read a visual novel in Japanese?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'As a beginner, expect to spend significantly more time than native readers. A 10-hour VN might take 40-80 hours. Speed improves rapidly with practice. After reading a few VNs, most learners see dramatic improvement in reading speed and comprehension.',
      },
    },
  ],
};

// JSON-LD structured data for guides
function generateJsonLd(guide: NonNullable<ReturnType<typeof getContentBySlug>>, slug: string) {
  const heroImage = extractFirstImage(guide.content);
  const imageUrl = heroImage
    ? `https://vnclub.org${heroImage}`
    : 'https://vnclub.org/assets/hikaru-icon2.webp';

  const schemas: Record<string, unknown>[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: guide.title,
      description: guide.description || `Learn how to ${guide.title.toLowerCase()} with our comprehensive guide.`,
      url: `https://vnclub.org/${slug}`,
      datePublished: guide.date,
      dateModified: guide.updated || guide.date,
      author: {
        '@type': 'Organization',
        name: 'VN Club Resurrection',
        url: 'https://vnclub.org',
      },
      publisher: {
        '@type': 'Organization',
        name: 'VN Club',
        url: 'https://vnclub.org',
        logo: {
          '@type': 'ImageObject',
          url: 'https://vnclub.org/assets/hikaru-icon2.webp',
        },
      },
      mainEntityOfPage: {
        '@type': 'WebPage',
        '@id': `https://vnclub.org/${slug}`,
      },
      image: imageUrl,
      articleSection: 'Guide',
      inLanguage: 'en-US',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Home',
          item: 'https://vnclub.org',
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Guides',
          item: 'https://vnclub.org/guides',
        },
        {
          '@type': 'ListItem',
          position: 3,
          name: guide.title,
          item: `https://vnclub.org/${slug}`,
        },
      ],
    },
  ];

  // Add FAQ schema to the main guide page for featured snippets
  if (slug === 'guide') {
    schemas.push(mainGuideFAQ);
  }

  return schemas;
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const guide = await getContentBySlugAsync('guides', slug);

  if (!guide) {
    notFound();
  }

  const jsonLd = generateJsonLd(guide, slug);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <div className="container mx-auto px-4 py-12">
        <div className="flex gap-6 max-w-[1600px] mx-auto">
          {/* Left Sidebar - Page Navigation */}
          <aside className="hidden lg:block w-56 flex-shrink-0">
            <PageNavigation currentSlug={slug} />
          </aside>

          {/* Main Content */}
          <article className="flex-1 min-w-0 max-w-4xl">
            <div className="text-gray-800 dark:text-gray-200">
              <ResourceMarkdownRenderer content={guide.content} />
            </div>

            <div className="mt-12 pt-6 border-t border-gray-200 dark:border-gray-800">
              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-6 sm:gap-8 text-sm text-gray-600 dark:text-gray-300">
                <div className="flex flex-wrap items-center gap-6 sm:gap-8">
                  {guide.date && (
                    <div className="flex items-center gap-3">
                      <CalendarPlus className="h-5 w-5 text-indigo-500" aria-hidden="true" />
                      <div className="flex flex-col">
                        <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Created</span>
                        <RelativeTime
                          dateString={guide.date}
                          className="text-base font-medium text-gray-900 dark:text-gray-100"
                        />
                      </div>
                    </div>
                  )}
                  {guide.updated && (
                    <div className="flex items-center gap-3">
                      <History className="h-5 w-5 text-indigo-500" aria-hidden="true" />
                      <div className="flex flex-col">
                        <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Last updated</span>
                        <RelativeTime
                          dateString={guide.updated}
                          className="text-base font-medium text-gray-900 dark:text-gray-100"
                        />
                      </div>
                    </div>
                  )}
                </div>
                <a
                  href={`https://github.com/drinosaret/vn-club-resources/edit/main/content/guides/${slug}.mdx`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 sm:ml-auto px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:border-indigo-300 dark:hover:border-indigo-600 text-gray-700 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  <span className="font-medium">Edit on GitHub</span>
                </a>
              </div>
            </div>

            {/* Previous/Next Navigation */}
            <PrevNextNavigation currentSlug={slug} />
          </article>

          {/* Right Sidebar - Table of Contents */}
          <aside className="hidden xl:block w-64 flex-shrink-0">
            <TableOfContents content={guide.content} />
          </aside>
        </div>
      </div>
    </>
  );
}
