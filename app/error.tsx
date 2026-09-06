'use client';

import { useEffect } from 'react';
import Link from '@/components/Link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Error is already handled by Next.js error boundary
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl items-center px-4 py-16">
      <div className="panel w-full p-6 sm:p-8">
        <p className="op-code">!</p>
        <h1 className="sec-title mt-3">Something went wrong</h1>
        <p className="sec-sub">
          The page failed to load properly. Try refreshing or go back to the home page.
        </p>
        <div className="op-ways mt-6">
          <button onClick={() => reset()} className="choice w-full text-left">
            <span className="flex-1">Try again</span>
          </button>
          <Link href="/" className="choice">
            <span className="flex-1">Go Home</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
