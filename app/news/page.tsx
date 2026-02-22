import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { generatePageMetadata } from '@/lib/metadata-utils';

export const metadata: Metadata = generatePageMetadata({
  title: 'Visual Novel News & Releases',
  description: 'Latest visual novel news, new Japanese VN releases, and eroge industry updates. Stay informed about upcoming titles for your Japanese reading list.',
  path: '/news/',
});

export default function NewsPage() {
  redirect('/news/all/');
}
