import type { Metadata } from 'next';
import { dayMetadata } from '@/lib/news-metadata';
import { isValidDate } from '@/lib/news';
import { DayPage, dayHasItems, dayLabelFor } from '@/components/news/pages/DayPage';

export const revalidate = 3600;

interface PageProps {
  params: Promise<{ section: string; date: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { section, date } = await params;
  const label = dayLabelFor('ja', section);
  if (!label || !isValidDate(date)) return { title: 'Not Found' };
  // An empty archive day is reachable from its neighbours but not worth indexing.
  return dayMetadata('ja', section, date, label, { noIndex: !(await dayHasItems(section, date)) });
}

export default async function NewsDayRouteJa({ params }: PageProps) {
  const { section, date } = await params;
  return <DayPage locale="ja" slug={section} date={date} />;
}
