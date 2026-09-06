import Link from '@/components/Link';
import SearchBar from '@/components/SearchBar';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Page Not Found',
  description: 'The page you requested could not be found.',
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl items-center px-4 py-16">
      <div className="panel w-full p-6 sm:p-8">
        <p className="op-code">404</p>
        <h1 className="sec-title mt-3">Page Not Found</h1>
        <p className="sec-sub">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="mt-6">
          <SearchBar className="w-full" />
        </div>
        <div className="op-ways mt-6">
          <Link href="/" className="choice">
            <span className="flex-1">Go Home</span>
          </Link>
          <Link href="/browse/" className="choice">
            <span className="flex-1">Browse VNs</span>
          </Link>
          <Link href="/guide/" className="choice">
            <span className="flex-1">Getting Started</span>
          </Link>
          <Link href="/stats/" className="choice">
            <span className="flex-1">Stats</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
