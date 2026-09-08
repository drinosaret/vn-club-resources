import type { Metadata } from 'next';
import { dayMetadata } from '@/lib/news-metadata';
import { isValidDate } from '@/lib/news';
import { DayPage, dayHasItems, dayLabelFor } from '@/components/news/pages/DayPage';

// A past day does not change; the current one is refreshed at the section pages' rate.
export const revalidate = 3600;

interface PageProps {
  params: Promise<{ section: string; date: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { section, date } = await params;
  const label = dayLabelFor('en', section);
  if (!label || !isValidDate(date)) return { title: 'Not Found' };
  // An empty archive day is reachable from its neighbours but not worth indexing.
  return dayMetadata('en', section, date, label, { noIndex: !(await dayHasItems(section, date)) });
}

export default async function NewsDayRoute({ params }: PageProps) {
  const { section, date } = await params;
  return <DayPage locale="en" slug={section} date={date} />;
}
