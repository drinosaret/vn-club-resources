import type { Metadata } from 'next';
import { sectionMetadata } from '@/lib/news-metadata';
import { parseLang } from '@/lib/news';
import { SectionPage } from '@/components/news/pages/SectionPage';

export const revalidate = 600;

interface PageProps {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ lang?: string | string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return sectionMetadata('ja', (await params).section);
}

export default async function NewsSectionRouteJa({ params, searchParams }: PageProps) {
  const { section } = await params;
  return <SectionPage locale="ja" slug={section} lang={parseLang((await searchParams).lang)} />;
}
